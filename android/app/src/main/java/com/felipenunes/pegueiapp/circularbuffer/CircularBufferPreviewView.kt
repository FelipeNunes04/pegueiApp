package com.felipenunes.pegueiapp.circularbuffer

import android.content.Context
import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView

/**
 * Bridges a plain Android TextureView's SurfaceTexture to
 * [CameraEncoderController], which owns the actual Camera2 session. The
 * view itself has no camera logic -- it just hands its surface over.
 */
class CircularBufferPreviewView(context: Context) : TextureView(context), TextureView.SurfaceTextureListener {

    var isActive: Boolean = true

    init {
        surfaceTextureListener = this
    }

    override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
        if (!isActive) return
        CameraEncoderController.attachPreviewSurface(Surface(surface), width, height)
    }

    override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) = Unit

    override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
        CameraEncoderController.detachPreviewSurface()
        return true
    }

    override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit
}
