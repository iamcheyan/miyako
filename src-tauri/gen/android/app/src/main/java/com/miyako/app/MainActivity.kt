package com.miyako.app

import android.os.Bundle
import android.graphics.Color
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.ViewCompat

class MainActivity : TauriActivity() {
  private var webViewRef: WebView? = null
  private var statusTopCss = 24f
  private var tappableBottomCss = 0f

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    showStatusBar()
  }

  override fun onWebViewCreate(webView: WebView) {
    webViewRef = webView
    webView.addJavascriptInterface(StatusBarInterface(), "StatusBarAndroid")
    installInsetsBridge(webView)
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      showStatusBar()
    }
  }

  inner class StatusBarInterface {
    @JavascriptInterface
    fun setVisible(visible: Boolean) {
      runOnUiThread {
        showStatusBar()
      }
    }

    @JavascriptInterface
    fun getTopInset(): Float {
      return statusTopCss
    }

    @JavascriptInterface
    fun getBottomInset(): Float {
      return tappableBottomCss
    }
  }

  private fun showStatusBar() {
    window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
      window.isNavigationBarContrastEnforced = false
    }
    
    WindowInsetsControllerCompat(window, window.decorView).apply {
      show(WindowInsetsCompat.Type.systemBars())
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_DEFAULT
    }

    @Suppress("DEPRECATION")
    window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
  }

  private fun installInsetsBridge(webView: WebView) {
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      val density = webView.resources.displayMetrics.density
      statusTopCss = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top / density
      tappableBottomCss =
        insets.getInsets(WindowInsetsCompat.Type.tappableElement()).bottom / density

      val js =
        """
        (function () {
          var root = document.documentElement;
          var app = document.querySelector('.app');
          var top = '${statusTopCss}px';
          var bottom = '${tappableBottomCss}px';
          root.style.setProperty('--android-native-insets', '1');
          root.style.setProperty('--system-top-inset', top);
          root.style.setProperty('--system-bottom-inset', bottom);
          root.style.setProperty('--android-nav-height', '0px');
          if (app) {
            app.style.setProperty('--android-native-insets', '1');
            app.style.setProperty('--system-top-inset', top);
            app.style.setProperty('--system-bottom-inset', bottom);
            app.style.setProperty('--android-nav-height', '0px');
          }
        })();
        """.trimIndent()

      webView.post {
        webView.evaluateJavascript(js, null)
      }

      insets
    }
    ViewCompat.requestApplyInsets(webView)
  }
}
