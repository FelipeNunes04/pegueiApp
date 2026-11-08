package com.felipenunes.pegueiapp

/**
 * Compile-time app-wide feature switches. Not user-facing settings (those live in
 * settingsStore.ts) -- these gate whole native code paths that stay in the tree but
 * shouldn't run right now, so a path can be re-enabled later with a one-line flip
 * instead of resurrecting deleted code. See DECISIONS.md.
 */
object FeatureFlags {
    /**
     * Whether the circular buffer keeps recording (via [circularbuffer.CircularBufferForegroundService])
     * while the app is backgrounded or the screen is off. Built as an off-by-default switch so
     * Android could match iOS (which has no background-capture equivalent), then re-enabled the
     * same day -- see DECISIONS.md "Background recording".
     */
    const val BACKGROUND_RECORDING_ENABLED = true
}
