package com.fpperformance.app

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.*
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private var chooser: ValueCallback<Array<Uri>>? = null
    private val START_URL = "https://www.breadfast.com/dashboard/controlRoom?showCompletedAndCancelledOrders=true"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)
        val script = assets.open("fp.user.js").bufferedReader(Charsets.UTF_8).use { it.readText() }

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true      // the script saves its data in localStorage
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        // Inject before the page's own code runs (the script hooks fetch / XHR at document-start).
        val early = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        if (early) WebViewCompat.addDocumentStartJavaScript(web, script, setOf("https://www.breadfast.com"))

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                if (r.url.host?.endsWith("breadfast.com") == true) return false
                startActivity(Intent(Intent.ACTION_VIEW, r.url)); return true
            }
            override fun onPageFinished(v: WebView, url: String) {
                // Old WebView without early injection: inject late (reload the page once if data doesn't show).
                if (!early && url.contains("breadfast.com")) v.evaluateJavascript(script, null)
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(w: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                chooser?.onReceiveValue(null); chooser = cb
                startActivityForResult(p.createIntent(), 77); return true
            }
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else finish() }
        })
        if (savedInstanceState == null) web.loadUrl(START_URL) else web.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(out: Bundle) { super.onSaveInstanceState(out); web.saveState(out) }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(req: Int, res: Int, data: Intent?) {
        super.onActivityResult(req, res, data)
        if (req == 77) { chooser?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data)); chooser = null }
    }
}
