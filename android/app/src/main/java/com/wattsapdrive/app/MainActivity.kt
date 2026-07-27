package com.wattsapdrive.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.documentfile.provider.DocumentFile
import com.wattsapdrive.app.databinding.ActivityMainBinding
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private val prefs by lazy { getSharedPreferences("wsd", Context.MODE_PRIVATE) }
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val http = OkHttpClient.Builder()
        .connectTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.MINUTES)
        .readTimeout(10, TimeUnit.MINUTES)
        .build()

    private val openFiles = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val cb = filePathCallback
        filePathCallback = null
        if (cb == null) return@registerForActivityResult
        if (result.resultCode != Activity.RESULT_OK) {
            cb.onReceiveValue(null)
            return@registerForActivityResult
        }
        val data = result.data
        val uris = mutableListOf<Uri>()
        data?.clipData?.let { clip ->
            for (i in 0 until clip.itemCount) uris += clip.getItemAt(i).uri
        }
        data?.data?.let { if (uris.none { u -> u == it }) uris += it }
        cb.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }

    private val openFolderTree = registerForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri ->
        if (uri == null) {
            runOnUiThread {
                Toast.makeText(this, "Папку не обрано", Toast.LENGTH_SHORT).show()
            }
            return@registerForActivityResult
        }
        try {
            contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        } catch (_: SecurityException) { /* some providers deny persist */ }
        startFolderUpload(uri)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.Theme_WattSapDrive)
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val settings = binding.webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.cacheMode = WebSettings.LOAD_NO_CACHE
        settings.setSupportMultipleWindows(false)
        settings.userAgentString = settings.userAgentString + " WattSapDriveApp/0.3.2"
        WebView.setWebContentsDebuggingEnabled(true)
        binding.webView.clearCache(true)
        binding.webView.clearHistory()
        binding.webView.addJavascriptInterface(AndroidBridge(), "WattSapAndroid")

        binding.webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                val multi = params?.mode == FileChooserParams.MODE_OPEN_MULTIPLE
                // На Android webkitdirectory часто приходить як multi — даємо вибір
                if (multi) {
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("Що вивантажити?")
                        .setItems(arrayOf("Кілька файлів", "Цілу папку")) { _, which ->
                            if (which == 1) {
                                filePathCallback?.onReceiveValue(null)
                                filePathCallback = null
                                pickFolderTree()
                            } else {
                                launchFilePicker(params, multi = true)
                            }
                        }
                        .setOnCancelListener {
                            filePathCallback?.onReceiveValue(null)
                            filePathCallback = null
                        }
                        .show()
                    return true
                }
                launchFilePicker(params, multi = false)
                return true
            }
        }

        binding.webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                binding.setupPanel.visibility = View.GONE
                binding.webView.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                // drop stale service worker / caches that keep old UI
                val cssH = ((view?.height ?: 0) / resources.displayMetrics.density).toInt()
                val cssW = ((view?.width ?: 0) / resources.displayMetrics.density).toInt()
                view?.evaluateJavascript(
                    """
                    (async function(){
                      try {
                        if (navigator.serviceWorker) {
                          const regs = await navigator.serviceWorker.getRegistrations();
                          for (const r of regs) await r.unregister();
                        }
                        if (window.caches) {
                          const keys = await caches.keys();
                          for (const k of keys) await caches.delete(k);
                        }
                      } catch (e) {}
                      try {
                        window.__WS_NATIVE_H = $cssH;
                        window.__WS_NATIVE_W = $cssW;
                        if (typeof fitAppDisk === 'function') fitAppDisk();
                      } catch (e) {}
                    })();
                    """.trimIndent(),
                    null
                )
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    showSetup("Не вдалося відкрити сервер. Перевір адресу / що бот запущений.")
                }
            }
        }

        binding.webView.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            try {
                val req = android.app.DownloadManager.Request(Uri.parse(url))
                req.setMimeType(mimeType)
                req.addRequestHeader("User-Agent", binding.webView.settings.userAgentString)
                req.setNotificationVisibility(
                    android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                )
                val name = Regex("filename\\*?=(?:UTF-8''|\"?)([^\";]+)", RegexOption.IGNORE_CASE)
                    .find(contentDisposition ?: "")
                    ?.groupValues?.getOrNull(1)
                    ?.trim('"')
                    ?: "download.bin"
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                val dm = getSystemService(DOWNLOAD_SERVICE) as android.app.DownloadManager
                dm.enqueue(req)
                Toast.makeText(this, "Завантаження: $name", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "Download: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }

        binding.serverUrl.setText(serverBase())
        binding.btnOpen.setOnClickListener { openPath("/") }
        binding.btnPair.setOnClickListener { openPath("/pair") }
        binding.btnHome.setOnClickListener { openPath("/") }
        binding.btnPairBar.setOnClickListener { openPath("/pair") }

        binding.webView.viewTreeObserver.addOnGlobalLayoutListener {
            pushWebViewSize()
        }
        binding.btnReload.setOnClickListener {
            binding.webView.reload()
            binding.webView.postDelayed({ pushWebViewSize() }, 300)
        }
        binding.btnServer.setOnClickListener { showSetup(null) }

        if (prefs.getBoolean("configured", false)) {
            openPath("/")
        } else {
            showSetup(null)
        }
    }

    private fun launchFilePicker(params: WebChromeClient.FileChooserParams?, multi: Boolean) {
        val intent = params?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multi)
        try {
            openFiles.launch(Intent.createChooser(intent, "Обери файли"))
        } catch (_: ActivityNotFoundException) {
            filePathCallback?.onReceiveValue(null)
            filePathCallback = null
            Toast.makeText(this, "Немає файлового менеджера", Toast.LENGTH_LONG).show()
        }
    }

    private fun pickFolderTree() {
        try {
            openFolderTree.launch(null)
        } catch (e: Exception) {
            Toast.makeText(this, "Не вдалося відкрити вибір папки: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    inner class AndroidBridge {
        @JavascriptInterface
        fun pickFolderForUpload() {
            runOnUiThread { pickFolderTree() }
        }
    }

    private fun startFolderUpload(treeUri: Uri) {
        val root = DocumentFile.fromTreeUri(this, treeUri)
        if (root == null || !root.isDirectory) {
            Toast.makeText(this, "Некоректна папка", Toast.LENGTH_LONG).show()
            return
        }
        val rootName = root.name ?: "folder"
        Toast.makeText(this, "Сканую «$rootName»…", Toast.LENGTH_SHORT).show()

        thread {
            val files = mutableListOf<Pair<DocumentFile, String>>()
            fun walk(dir: DocumentFile, prefix: String) {
                for (child in dir.listFiles()) {
                    val name = child.name ?: continue
                    if (name.startsWith(".")) continue
                    val path = if (prefix.isEmpty()) name else "$prefix/$name"
                    if (child.isDirectory) walk(child, path)
                    else if (child.isFile && (child.length() >= 0)) files += child to path
                }
            }
            walk(root, rootName)

            if (files.isEmpty()) {
                runOnUiThread {
                    Toast.makeText(this, "У папці немає файлів", Toast.LENGTH_LONG).show()
                }
                return@thread
            }

            runOnUiThread {
                Toast.makeText(this, "Знайдено ${files.size} файлів · заливаю…", Toast.LENGTH_SHORT).show()
            }

            binding.webView.post {
                binding.webView.evaluateJavascript(
                    "(function(){try{return localStorage.getItem('ws_token')||''}catch(e){return ''}})()"
                ) { tokenRaw ->
                    val token = tokenRaw.trim().trim('"').replace("\\\"", "\"")
                        .let { if (it == "null") "" else it }
                    thread { uploadCollected(files, token) }
                }
            }
        }
    }

    private fun uploadCollected(files: List<Pair<DocumentFile, String>>, token: String) {
        val base = serverBase()
        var ok = 0
        var fail = 0
        val rootFolder = files.firstOrNull()?.second?.substringBefore('/') ?: ""
        runOnUiThread {
            binding.webView.evaluateJavascript(
                "try{wsNativeProgress(0,${files.size},'старт')}catch(e){}",
                null
            )
        }
        for ((i, pair) in files.withIndex()) {
            val (doc, relPath) = pair
            val size = doc.length()
            val short = relPath.substringAfterLast('/')
            runOnUiThread {
                binding.webView.evaluateJavascript(
                    "try{wsNativeProgress(${i},${files.size},${org.json.JSONObject.quote(short)})}catch(e){}",
                    null
                )
            }
            // sequential: API дозволяє один upload за раз
            var attempt = 0
            var success = false
            while (attempt < 8 && !success) {
                attempt++
                try {
                    val body = object : RequestBody() {
                        override fun contentType() = "application/octet-stream".toMediaType()
                        override fun contentLength() = size
                        override fun writeTo(sink: BufferedSink) {
                            contentResolver.openInputStream(doc.uri)?.use { input ->
                                sink.writeAll(input.source())
                            } ?: throw IllegalStateException("cannot open ${doc.uri}")
                        }
                    }
                    val reqBuilder = Request.Builder()
                        .url("$base/api/upload")
                        .post(body)
                        .header("x-file-name", relPath)
                        .header("Content-Type", "application/octet-stream")
                    if (token.isNotBlank()) reqBuilder.header("Authorization", "Bearer $token")
                    http.newCall(reqBuilder.build()).execute().use { resp ->
                        if (resp.code == 409) {
                            Thread.sleep(1200L * attempt)
                            return@use
                        }
                        if (!resp.isSuccessful) {
                            throw IllegalStateException("HTTP ${resp.code}: ${resp.body?.string()?.take(120)}")
                        }
                        success = true
                        ok++
                    }
                } catch (e: Exception) {
                    if (attempt >= 8) {
                        fail++
                        runOnUiThread {
                            Toast.makeText(this, "Помилка: ${e.message}", Toast.LENGTH_LONG).show()
                        }
                    } else {
                        Thread.sleep(800L * attempt)
                    }
                }
            }
            runOnUiThread {
                binding.webView.evaluateJavascript(
                    "try{wsNativeProgress(${i + 1},${files.size},${org.json.JSONObject.quote(short)})}catch(e){}",
                    null
                )
            }
        }
        runOnUiThread {
            Toast.makeText(this, "Готово · ок $ok · помилок $fail", Toast.LENGTH_LONG).show()
            val folderJs = org.json.JSONObject.quote(rootFolder)
            binding.webView.evaluateJavascript(
                "try{wsNativeDone($ok,$fail,$folderJs)}catch(e){try{loadDrive()}catch(x){}}",
                null
            )
        }
    }

    private fun serverBase(): String {
        val raw = prefs.getString("base", "http://127.0.0.1:3000") ?: "http://127.0.0.1:3000"
        return raw.trim().trimEnd('/')
    }

    private fun saveServer() {
        var url = binding.serverUrl.text?.toString()?.trim().orEmpty()
        if (url.isEmpty()) url = "http://127.0.0.1:3000"
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "http://$url"
        }
        url = url.trimEnd('/')
        prefs.edit()
            .putString("base", url)
            .putBoolean("configured", true)
            .apply()
        binding.serverUrl.setText(url)
    }

    private fun openPath(path: String) {
        saveServer()
        val target = serverBase() + if (path.startsWith("/")) path else "/$path"
        val bust = if (target.contains("?")) "&" else "?"
        binding.setupPanel.visibility = View.GONE
        binding.webView.visibility = View.VISIBLE
        binding.webView.loadUrl(target + bust + "app=1&_=" + System.currentTimeMillis())
    }

    private fun showSetup(message: String?) {
        binding.webView.visibility = View.GONE
        binding.setupPanel.visibility = View.VISIBLE
        binding.serverUrl.setText(serverBase())
        if (!message.isNullOrBlank()) {
            Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (binding.webView.visibility == View.VISIBLE && binding.webView.canGoBack()) {
            binding.webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }
    private fun pushWebViewSize() {
        val v = binding.webView
        if (v.width <= 0 || v.height <= 0) return
        val d = resources.displayMetrics.density
        val cssH = (v.height / d).toInt()
        val cssW = (v.width / d).toInt()
        v.evaluateJavascript(
            "(function(){window.__WS_NATIVE_H=" + cssH + ";window.__WS_NATIVE_W=" + cssW +
                ";if(typeof fitAppDisk==='function')fitAppDisk();})();",
            null
        )
    }


}
