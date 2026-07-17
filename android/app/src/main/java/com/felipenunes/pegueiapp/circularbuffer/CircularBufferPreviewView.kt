package com.felipenunes.pegueiapp.circularbuffer

import android.content.Context
import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView

/**
 * Bridges a plain Android TextureView's SurfaceTexture to
 * [CameraEncoderController], which owns the actual Camera2 session. The
 * view itself has no camera logic -- it just hands its surface over.
 *
 * Sizing follows Google's own Camera2Basic sample's `AutoFitTextureView`
 * pattern: rather than feeding the camera's native (landscape) buffer into
 * a full-screen portrait view and correcting the mismatch with a content
 * Matrix (fragile -- see DECISIONS.md "Camera preview transform" for the
 * failed attempts), the view's own *measured* box is constrained to the
 * buffer's rotated aspect ratio via [setAspectRatio], and the buffer is
 * requested at its native (unswapped) size in [CameraEncoderController].
 * For a portrait-locked app with a back camera at the common 90° sensor
 * orientation, Camera2Basic's reference `configureTransform` applies no
 * Matrix at all in this configuration -- confirmed on-device here too.
 */
class CircularBufferPreviewView(context: Context) : TextureView(context), TextureView.SurfaceTextureListener {

    var isActive: Boolean = true

    private var ratioWidth = 0
    private var ratioHeight = 0

    init {
        surfaceTextureListener = this
    }

    /**
     * @param width relative horizontal size (e.g. the camera buffer's
     *   height, since the buffer is landscape and this view is portrait)
     * @param height relative vertical size (e.g. the camera buffer's width)
     */
    fun setAspectRatio(width: Int, height: Int) {
        require(width >= 0 && height >= 0) { "Size cannot be negative." }
        ratioWidth = width
        ratioHeight = height
        requestLayout()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        val width = MeasureSpec.getSize(widthMeasureSpec)
        val height = MeasureSpec.getSize(heightMeasureSpec)
        if (ratioWidth == 0 || ratioHeight == 0) {
            setMeasuredDimension(width, height)
        } else if (width < height * ratioWidth / ratioHeight) {
            setMeasuredDimension(width, width * ratioHeight / ratioWidth)
        } else {
            setMeasuredDimension(height * ratioWidth / ratioHeight, height)
        }
    }

    override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
        if (!isActive) return
        CameraEncoderController.attachPreviewSurface(this, surface, Surface(surface), width, height)
    }

    override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) = Unit

    override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
        CameraEncoderController.detachPreviewSurface()
        return true
    }

    override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit
}
