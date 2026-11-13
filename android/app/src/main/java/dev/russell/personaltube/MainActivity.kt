package dev.russell.personaltube

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.PictureInPictureParams
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.util.Rational
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONObject
import java.io.File
import kotlin.concurrent.thread

/**
 * The app: it starts the same server the desktop runs (Python, inside this process, on 127.0.0.1:8765) from the
 * project folder that Syncthing keeps on the phone, and shows its pages in a WebView. Videos play in the app's own
 * player (NativePlayer), which sits above the page while one plays, and fills the screen in landscape or picture in
 * picture. The phone has its own state.db in app storage; the two devices exchange changes through the folder's
 * sync/ directory (sync.py). Downloads stay on the phone (Downloads).
 */
@UnstableApi
class MainActivity : Activity() {
    private val origin = "http://127.0.0.1:8765"
    private val prefs by lazy { getSharedPreferences("app", MODE_PRIVATE) }
    private lateinit var root: FrameLayout
    private var web: WebView? = null
    private var fullscreen: View? = null
    private var fullscreenDone: WebChromeClient.CustomViewCallback? = null
    private var filePick: ValueCallback<Array<Uri>>? = null
    private var native: NativePlayer? = null
    private var playerBox: AspectBox? = null
    private var controller: ListenableFuture<MediaController>? = null
    var full = false; private set
    var inPip = false; private set
    private var leftPip = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this)
        setContentView(root)
        begin()
    }

    override fun onResume() {
        super.onResume()
        web?.onResume()
        if (web == null && !starting) begin()  // back from the system's file access screen
    }

    private fun folder(): String = prefs.getString("folder", null) ?: GUESSES.firstOrNull { ok(it) } ?: GUESSES[0]

    private fun ok(path: String) = File(path, "server.py").isFile && File(path, "videos.jsonl").isFile

    private fun begin() {
        when {
            !Environment.isExternalStorageManager() -> setup(
                "PersonalTube reads its library and code from the project folder that Syncthing keeps on this phone, " +
                    "and writes this phone's changes back there. Android asks you to allow that once.",
                "Allow file access"
            ) {
                startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")))
            }
            !ok(folder()) -> chooseFolder(null)
            else -> launch()
        }
    }

    // ---- first run: file access, then the folder

    private fun dp(n: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, n.toFloat(), resources.displayMetrics).toInt()

    private fun column(): LinearLayout {
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
        }
        root.removeAllViews()
        web = null
        root.addView(col, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        return col
    }

    private fun text(col: LinearLayout, s: String, size: Float = 16f) =
        TextView(this).apply { text = s; textSize = size; setPadding(0, 0, 0, dp(16)); setTextIsSelectable(true) }.also { col.addView(it) }

    private fun button(col: LinearLayout, s: String, act: () -> Unit) =
        Button(this).apply { text = s; isAllCaps = false; setOnClickListener { act() } }.also { col.addView(it) }

    private fun setup(msg: String, label: String, act: () -> Unit) {
        val col = column()
        text(col, "PersonalTube", 24f)
        text(col, msg)
        button(col, label, act)
    }

    private fun chooseFolder(problem: String?) {
        val col = column()
        text(col, "PersonalTube", 24f)
        text(col, problem ?: "Where is the personaltube folder on this phone? It is the one Syncthing copies from your " +
            "computer, holding server.py and videos.jsonl. If it is not here yet, let Syncthing finish first.")
        val box = EditText(this).apply { setText(folder()); isSingleLine = true }
        col.addView(box)
        button(col, "Browse") { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), PICK_FOLDER) }
        button(col, "Start") {
            val path = box.text.toString().trim().trimEnd('/')
            if (ok(path)) {
                prefs.edit().putString("folder", path).apply()
                launch()
            } else {
                chooseFolder("There is no server.py and videos.jsonl in $path. Pick the personaltube folder itself, and check that Syncthing has finished copying it.")
            }
        }
    }

    // ---- the server and the page

    private fun launch() {
        val col = column()
        text(col, "Loading the library…").gravity = Gravity.CENTER
        starting = true
        val dir = folder()
        thread {
            try {
                if (!Python.isStarted()) Python.start(AndroidPlatform(applicationContext))
                Downloads.init(applicationContext)
                Python.getInstance().getModule("ptboot")
                    .callAttr("start", dir, File(filesDir, "state.db").path, Downloads.dir.path, PyHook(this))
                runOnUiThread { starting = false; show() }
            } catch (e: Throwable) {
                runOnUiThread {
                    starting = false
                    chooseFolder("The app could not start from $dir:\n\n${e.message?.takeLast(900)}")
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun show() {
        // a debug build's pages can be inspected from the desktop's chrome://inspect
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        val w = WebView(this)
        w.settings.javaScriptEnabled = true
        w.settings.domStorageEnabled = true   // theme and the current sitting's intent
        w.settings.mediaPlaybackRequiresUserGesture = true  // nothing plays without a tap
        w.webViewClient = object : WebViewClient() {
            // Only the app's own pages open here. Anything else (a link out, "Watch on YouTube") goes to the phone's browser.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame || request.url.toString().startsWith(origin)) return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                return true
            }
        }
        w.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {  // the player's fullscreen button
                fullscreen?.let { root.removeView(it) }
                fullscreen = view
                fullscreenDone = callback
                root.addView(view, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                w.visibility = View.GONE
                @Suppress("DEPRECATION")
                window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            }

            override fun onHideCustomView() {
                fullscreen?.let { root.removeView(it) }
                fullscreen = null
                fullscreenDone = null
                w.visibility = View.VISIBLE
                @Suppress("DEPRECATION")
                window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                filePick?.onReceiveValue(null)
                filePick = callback
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                    .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                return runCatching { startActivityForResult(intent, PICK_FILES) }.isSuccess.also { if (!it) filePick = null }
            }
        }
        w.addJavascriptInterface(Bridge(), "PTNative")
        native?.release()
        val np = NativePlayer(this)
        val box = AspectBox(this).apply { addView(np.view); visibility = View.GONE }
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(box, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(w, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        root.removeAllViews()
        root.addView(col, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        web = w
        native = np
        playerBox = box
        w.loadUrl("$origin/")
    }

    // ---- the player's place on screen

    /** Keeps the player 16:9 above the page, or lets it fill the screen. */
    class AspectBox(ctx: android.content.Context) : FrameLayout(ctx) {
        var fill = false
        override fun onMeasure(w: Int, h: Int) {
            if (fill) return super.onMeasure(w, h)
            val width = MeasureSpec.getSize(w)
            super.onMeasure(w, MeasureSpec.makeMeasureSpec(width * 9 / 16, MeasureSpec.EXACTLY))
        }
    }

    private fun layoutPlayer() {
        val box = playerBox ?: return
        val big = full || inPip
        box.fill = big
        box.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, if (big) 0 else ViewGroup.LayoutParams.WRAP_CONTENT, if (big) 1f else 0f)
        web?.visibility = if (big && box.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        window.insetsController?.let {
            if (big) {
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                it.hide(WindowInsets.Type.systemBars())
            } else it.show(WindowInsets.Type.systemBars())
        }
        native?.fullChanged()
    }

    fun showPlayer(on: Boolean) {
        val box = playerBox ?: return
        box.visibility = if (on) View.VISIBLE else View.GONE
        if (on) {
            window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            if (resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) full = true
        } else {
            window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            full = false
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            window.attributes = window.attributes.apply { screenBrightness = -1f }  // a swipe's brightness ends with the video
        }
        layoutPlayer()
        updatePip()
    }

    /** The fullscreen button: turns the screen to landscape and back. */
    fun setFullscreen(on: Boolean) {
        full = on
        requestedOrientation = if (on) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        layoutPlayer()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (playerBox?.visibility != View.VISIBLE || inPip) return
        val land = newConfig.orientation == Configuration.ORIENTATION_LANDSCAPE
        if (land != full && requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED) { full = land; layoutPlayer() }
    }

    private fun pipParams(): PictureInPictureParams {
        val b = PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9))
        if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(native?.pipWanted == true).setSeamlessResizeEnabled(true)
        return b.build()
    }

    fun updatePip() {
        if (web != null) runCatching { setPictureInPictureParams(pipParams()) }
    }

    fun enterPip() {
        if (playerBox?.visibility == View.VISIBLE) runCatching { enterPictureInPictureMode(pipParams()) }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT < 31 && native?.pipWanted == true) enterPip()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        inPip = isInPictureInPictureMode
        leftPip = !isInPictureInPictureMode
        native?.pipMode(inPip)
        layoutPlayer()
    }

    override fun onStop() {
        super.onStop()
        if (leftPip) native?.pause()  // the picture-in-picture window was closed
        leftPip = false
    }

    /** Connects to the playback service, so it runs (and shows its notification) while a video plays. */
    fun startSession() {
        if (controller != null) return
        controller = MediaController.Builder(this, SessionToken(this, ComponentName(this, PlaybackService::class.java))).buildAsync()
    }

    fun js(code: String) {
        runOnUiThread { web?.evaluateJavascript(code, null) }
    }

    // ---- what the page can ask of the phone (window.PTNative). Called on a background thread.

    inner class Bridge {
        @JavascriptInterface fun play(json: String) = runOnUiThread { native?.play(JSONObject(json)) }
        @JavascriptInterface fun stop() = runOnUiThread { native?.stop() }
        @JavascriptInterface fun pause() = runOnUiThread { native?.pause() }
        @JavascriptInterface fun resume() = runOnUiThread { native?.resume() }
        @JavascriptInterface fun seek(t: Double) = runOnUiThread { native?.seekTo(t) }
        @JavascriptInterface fun position(): Double = native?.pos ?: 0.0
        @JavascriptInterface fun duration(): Double = native?.dur ?: 0.0
        @JavascriptInterface fun playing(): Boolean = native?.playing ?: false
        @JavascriptInterface fun prefs(): String = native?.prefsJson() ?: "{}"
        @JavascriptInterface fun setPref(k: String, v: String) = runOnUiThread { native?.setPref(k, v) }
    }

    /** What server.py calls as NATIVE (through Chaquopy) to download on this phone. */
    class PyHook(private val act: MainActivity) {
        fun download(vid: String, quality: Int) {
            act.askNotifications()
            Downloads.start(vid, quality)
        }
        fun cancel(vid: String) = Downloads.cancel(vid)
        fun jobs(): String = Downloads.json()
    }

    fun askNotifications() {  // for the download progress notification
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            runOnUiThread { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), ASK_NOTIFY) }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == PICK_FILES) {
            val clip = data?.clipData
            val uris = when {
                resultCode != RESULT_OK -> null
                clip != null -> Array(clip.itemCount) { clip.getItemAt(it).uri }
                else -> data?.data?.let { arrayOf(it) }
            }
            filePick?.onReceiveValue(uris)
            filePick = null
        } else if (requestCode == PICK_FOLDER && resultCode == RESULT_OK) {
            // "primary:Projects/personaltube" is /storage/emulated/0/Projects/personaltube
            val id = data?.data?.let { DocumentsContract.getTreeDocumentId(it) } ?: return
            val (volume, rel) = id.split(":", limit = 2).let { it[0] to it.getOrElse(1) { "" } }
            val base = if (volume == "primary") Environment.getExternalStorageDirectory().path else "/storage/$volume"
            prefs.edit().putString("folder", "$base/$rel".trimEnd('/')).apply()
            chooseFolder(null)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val w = web
        when {
            full -> setFullscreen(false)
            fullscreen != null -> fullscreenDone?.onCustomViewHidden()
            w != null && w.canGoBack() -> w.goBack()
            else -> @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    override fun onPause() {
        super.onPause()
        web?.onPause()   // a video in the page's own (YouTube) player stops; the app's player plays on
    }

    override fun onDestroy() {
        native?.stop()
        native?.release()
        native = null
        controller?.let { MediaController.releaseFuture(it) }
        controller = null
        root.removeAllViews()
        web?.destroy()
        web = null
        super.onDestroy()
    }

    companion object {
        private const val PICK_FILES = 1
        private const val PICK_FOLDER = 2
        private const val ASK_NOTIFY = 3
        private var starting = false
        private val GUESSES = listOf("Projects/personaltube", "Sync/Projects/personaltube", "Syncthing/Projects/personaltube", "personaltube")
            .map { "${Environment.getExternalStorageDirectory().path}/$it" }
    }
}
