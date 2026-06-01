package com.miyako.app

import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  private var statusBarVisible = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    hideStatusBar()
    
    // 添加 JavaScript 接口
    webview?.addJavascriptInterface(StatusBarInterface(), "StatusBarAndroid")
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      if (statusBarVisible) {
        showStatusBar()
      } else {
        hideStatusBar()
      }
    }
  }

  inner class StatusBarInterface {
    @JavascriptInterface
    fun setVisible(visible: Boolean) {
      statusBarVisible = visible
      runOnUiThread {
        if (visible) {
          showStatusBar()
        } else {
          hideStatusBar()
        }
      }
    }
  }

  private fun showStatusBar() {
    WindowCompat.setDecorFitsSystemWindows(window, true)
    
    WindowInsetsControllerCompat(window, window.decorView).apply {
      show(WindowInsetsCompat.Type.statusBars())
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_DEFAULT
    }

    @Suppress("DEPRECATION")
    window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
  }

  private fun hideStatusBar() {
    window.setFlags(
      WindowManager.LayoutParams.FLAG_FULLSCREEN,
      WindowManager.LayoutParams.FLAG_FULLSCREEN
    )
    WindowCompat.setDecorFitsSystemWindows(window, false)

    WindowInsetsControllerCompat(window, window.decorView).apply {
      hide(WindowInsetsCompat.Type.statusBars())
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    @Suppress("DEPRECATION")
    window.decorView.systemUiVisibility =
      View.SYSTEM_UI_FLAG_FULLSCREEN or
        View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
  }
}
