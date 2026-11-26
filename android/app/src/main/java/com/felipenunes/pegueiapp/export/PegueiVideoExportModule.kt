package com.felipenunes.pegueiapp.export

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.effect.TextureOverlay
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.felipenunes.pegueiapp.analytics.PegueiAnalyticsModule
import com.google.common.collect.ImmutableList
import java.io.File
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Exports a saved clip with the sponsor watermark and the species/weight
 * caption burned in, optionally center-cropped to 9:16 (Media3 Transformer).
 * The camera screen isn't on screen while exporting, and nothing here
 * touches CameraEncoderController or the circular buffer.
 */
@OptIn(markerClass = [UnstableApi::class])
class PegueiVideoExportModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "PegueiVideoExport"

    private val mainHandler = Handler(Looper.getMainLooper())
    private var active: Transformer? = null

    private data class Size(val width: Int, val height: Int)

    @ReactMethod
    fun exportVideo(options: ReadableMap, promise: Promise) {
        val inputPath = options.getString("inputPath")?.removePrefix("file://")
        val outputPath = options.getString("outputPath")?.removePrefix("file://")
        if (inputPath.isNullOrEmpty() || outputPath.isNullOrEmpty()) {
            promise.reject("E_EXPORT_ARGS", "Parâmetros de exportação inválidos.")
            return
        }
        val portrait = !options.hasKey("portrait9x16") || options.getBoolean("portrait9x16")
        val watermark = if (options.hasKey("watermark") && !options.isNull("watermark")) options.getMap("watermark") else null
        val caption = if (options.hasKey("caption") && !options.isNull("caption")) options.getMap("caption") else null

        val sourceSize = try {
            displaySize(inputPath)
        } catch (e: Exception) {
            promise.reject("E_EXPORT_NO_VIDEO", "O vídeo não tem imagem para exportar.", e)
            return
        }
        val outputSize = if (portrait) crop9x16(sourceSize) else even(sourceSize)

        val overlays = mutableListOf<TextureOverlay>()
        watermark?.let { watermarkOverlay(it, outputSize)?.let(overlays::add) }
        caption?.let { captionOverlay(it, outputSize)?.let(overlays::add) }

        val videoEffects = mutableListOf<androidx.media3.common.Effect>()
        if (portrait) {
            videoEffects.add(Presentation.createForAspectRatio(9f / 16f, Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP))
        }
        if (overlays.isNotEmpty()) videoEffects.add(OverlayEffect(ImmutableList.copyOf(overlays)))

        val output = File(outputPath)
        output.parentFile?.mkdirs()
        if (output.exists()) output.delete()

        val edited = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(File(inputPath))))
            .setEffects(Effects(emptyList(), videoEffects))
            .build()

        // Transformer must be built and started on a Looper thread; the
        // encoding itself runs on Media3's own background threads.
        mainHandler.post {
            val transformer = Transformer.Builder(reactApplicationContext)
                .setVideoMimeType(MimeTypes.VIDEO_H264)
                .setAudioMimeType(MimeTypes.AUDIO_AAC)
                .addListener(object : Transformer.Listener {
                    override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                        active = null
                        watermark?.let { trackImpression(it) }
                        val result = Arguments.createMap()
                        result.putString("path", output.absolutePath)
                        result.putInt("width", outputSize.width)
                        result.putInt("height", outputSize.height)
                        result.putDouble("durationSeconds", exportResult.durationMs / 1000.0)
                        promise.resolve(result)
                    }

                    override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                        active = null
                        output.delete()
                        promise.reject("E_EXPORT_FAILED", exportException.message ?: "A exportação falhou.", exportException)
                    }
                })
                .build()
            active = transformer
            try {
                transformer.start(edited, output.absolutePath)
            } catch (e: Exception) {
                active = null
                promise.reject("E_EXPORT_FAILED", e.message ?: "A exportação falhou.", e)
            }
        }
    }

    private fun trackImpression(watermark: ReadableMap) {
        val sponsorId = watermark.getString("sponsorId").orEmpty()
        if (sponsorId.isEmpty()) return
        PegueiAnalyticsModule.track(
            "sponsor_impression",
            mapOf("sponsor_id" to sponsorId, "posicao" to (watermark.getString("position") ?: "bottom_right")),
        )
    }

    /** Size as displayed, rotation applied. */
    private fun displaySize(path: String): Size {
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(path)
            val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toInt() ?: 0
            val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toInt() ?: 0
            val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toInt() ?: 0
            require(width > 0 && height > 0)
            return if (abs(rotation) % 180 == 90) Size(height, width) else Size(width, height)
        } finally {
            retriever.release()
        }
    }

    private fun crop9x16(size: Size): Size {
        val target = 9f / 16f
        return if (size.width.toFloat() / size.height > target) {
            even(Size((size.height * target).toInt(), size.height))
        } else {
            even(Size(size.width, (size.width / target).toInt()))
        }
    }

    private fun even(size: Size) = Size(size.width / 2 * 2, size.height / 2 * 2)

    private fun loadBitmap(path: String?): Bitmap? =
        path?.removePrefix("file://")?.takeIf { it.isNotEmpty() }?.let { BitmapFactory.decodeFile(it) }

    // Media3 anchors are in normalised device coordinates: (-1,-1) is bottom-left, (1,1) top-right.
    private fun watermarkOverlay(watermark: ReadableMap, frame: Size): TextureOverlay? {
        val source = loadBitmap(watermark.getString("imagePath")) ?: return null
        val width = max(1, (frame.width * 0.22f).toInt())
        val height = max(1, width * source.height / max(source.width, 1))
        val bitmap = Bitmap.createScaledBitmap(source, width, height, true)
        val position = watermark.getString("position") ?: "bottom_right"
        val marginX = 0.08f
        val marginY = 0.08f * frame.width / frame.height
        val right = position.endsWith("right")
        val top = position.startsWith("top")
        val x = if (right) 1f - marginX else -1f + marginX
        val y = if (top) 1f - marginY else -1f + marginY
        val settings = StaticOverlaySettings.Builder()
            .setBackgroundFrameAnchor(x, y)
            .setOverlayFrameAnchor(if (right) 1f else -1f, if (top) 1f else -1f)
            .setAlphaScale(0.9f)
            .build()
        return BitmapOverlay.createStaticBitmapOverlay(bitmap, settings)
    }

    private fun captionOverlay(caption: ReadableMap, frame: Size): TextureOverlay? {
        val bitmap = captionBitmap(caption, frame.width) ?: return null
        val marginX = 0.08f
        val marginY = 2f * (frame.width * 0.12f) / frame.height
        val settings = StaticOverlaySettings.Builder()
            .setBackgroundFrameAnchor(-1f + marginX, -1f + marginY)
            .setOverlayFrameAnchor(-1f, -1f)
            .build()
        return BitmapOverlay.createStaticBitmapOverlay(bitmap, settings)
    }

    /** The caption card: species, optional weight, optional sponsor logo slot on the right. */
    private fun captionBitmap(caption: ReadableMap, frameWidth: Int): Bitmap? {
        val species = caption.getString("species").orEmpty().trim()
        val weight = caption.getString("weight").orEmpty().trim()
        if (species.isEmpty() && weight.isEmpty()) return null
        val logo = loadBitmap(caption.getString("logoPath"))

        val scale = frameWidth / 1080f
        val padding = 28f * scale
        val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textSize = 54f * scale
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        val subtitlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(245, 166, 35)
            textSize = 40f * scale
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        val titleHeight = if (species.isEmpty()) 0f else titlePaint.fontSpacing
        val subtitleHeight = if (weight.isEmpty()) 0f else subtitlePaint.fontSpacing
        val textHeight = titleHeight + subtitleHeight
        val textWidth = max(titlePaint.measureText(species), subtitlePaint.measureText(weight))
        val logoSide = if (logo == null) 0f else textHeight
        val gap = if (logo == null) 0f else padding
        val width = min(textWidth + logoSide + gap + padding * 2, frameWidth * 0.92f).toInt()
        val height = (textHeight + padding * 2).toInt()
        if (width <= 0 || height <= 0) return null

        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val background = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(140, 0, 0, 0) }
        canvas.drawRoundRect(RectF(0f, 0f, width.toFloat(), height.toFloat()), 24f * scale, 24f * scale, background)
        var baseline = padding - titlePaint.ascent()
        if (species.isNotEmpty()) {
            canvas.drawText(species, padding, baseline, titlePaint)
            baseline += titleHeight
        } else {
            baseline = padding - subtitlePaint.ascent()
        }
        if (weight.isNotEmpty()) {
            val y = if (species.isEmpty()) baseline else padding + titleHeight - subtitlePaint.ascent()
            canvas.drawText(weight, padding, y, subtitlePaint)
        }
        logo?.let {
            val slot = RectF(width - padding - logoSide, padding, width - padding, padding + logoSide)
            val ratio = min(slot.width() / it.width, slot.height() / it.height)
            val w = it.width * ratio
            val h = it.height * ratio
            val dst = RectF(slot.centerX() - w / 2, slot.centerY() - h / 2, slot.centerX() + w / 2, slot.centerY() + h / 2)
            canvas.drawBitmap(it, null, dst, Paint(Paint.FILTER_BITMAP_FLAG))
        }
        return bitmap
    }

    override fun invalidate() {
        mainHandler.post { active?.cancel() }
        super.invalidate()
    }
}
