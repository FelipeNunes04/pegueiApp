package com.felipenunes.pegueiapp.circularbuffer

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class CircularBufferPreviewViewManager : SimpleViewManager<CircularBufferPreviewView>() {

    override fun getName(): String = "CircularBufferPreviewView"

    override fun createViewInstance(reactContext: ThemedReactContext): CircularBufferPreviewView {
        return CircularBufferPreviewView(reactContext)
    }

    @ReactProp(name = "isActive")
    fun setIsActive(view: CircularBufferPreviewView, isActive: Boolean) {
        view.isActive = isActive
    }
}
