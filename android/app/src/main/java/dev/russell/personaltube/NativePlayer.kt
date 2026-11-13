package dev.russell.personaltube

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.TextUtils
import android.util.TypedValue
import android.view.ContextThemeWrapper
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.TextView
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * The phone's video player: what YouTube ReVanced adds to YouTube, in PersonalTube's look. It plays streams found by
 * NewPipeExtractor (or a downloaded file) in Media3, so there are no ads and it keeps playing in the background, in
 * picture in picture and with the screen off; it skips SponsorBlock segments as set in Settings; and it has a
 * quality and speed menu, a sound-only mode, double-tap to seek and swipes for brightness and volume.
 *
 * The page asks for it through the JS bridge in MainActivity (PTNative.play) and hears back through
 * window.ptNative('ended' | 'error', ...). Like the web player it reports to the server every 15 seconds where it is
 * and how long it played, marks the video watched at 90%, and on the end hands over to the page's stop screen.
 */
@UnstableApi
@SuppressLint("ViewConstructor", "ClickableViewAccessibility", "SetTextI18n")
class NativePlayer(private val act: MainActivity) {
    class Seg(val s: Double, val e: Double, val act: String, val name: String, val color: Int) { var done = false }

    private val exo = Players.get(act)
    private val prefs = act.getSharedPreferences("player", Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newCachedThreadPool()
    private val accent = Color.parseColor("#3FCFB9")

    // read by the page from the bridge's thread
    @Volatile var pos = 0.0; private set
    @Volatile var dur = 0.0; private set
    @Volatile var playing = false; private set

    var vid: String? = null; private set
    private var gen = 0                // bumped per video, so late answers about an earlier one are dropped
    private var title = ""; private var channel = ""; private var thumb = ""
    private var speed = 1f
    private var maxHeight = 720
    var audioOnly = false; private set
    private var info: StreamInfo? = null
    private var height = 0             // of the picture playing; -1 for a downloaded file
    private var retried = false
    private var segs = listOf<Seg>()
    private var played = 0.0; private var lastTick = 0L; private var lastSent = 0L; private var marked = false
    private var today: String? = null

    // ---- views

    private fun dp(n: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, n.toFloat(), act.resources.displayMetrics).toInt()
    private fun pill(bg: Int, stroke: Boolean = false) = GradientDrawable().apply {
        cornerRadius = dp(18).toFloat(); setColor(bg); if (stroke) setStroke(dp(1), Color.argb(64, 255, 255, 255))
    }

    val view = FrameLayout(act).apply { setBackgroundColor(Color.BLACK) }
    private val surface = PlayerView(act).apply {
        useController = false
        setShutterBackgroundColor(Color.BLACK)
        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        player = exo
    }
    private val art = ImageView(act).apply { scaleType = ImageView.ScaleType.FIT_CENTER; visibility = View.GONE }
    private val spinner = ProgressBar(act).apply { isIndeterminate = true; indeterminateTintList = android.content.res.ColorStateList.valueOf(accent) }
    private val touch = View(act)
    private val controls = FrameLayout(act).apply { setBackgroundColor(Color.argb(110, 0, 0, 0)); visibility = View.GONE }
    private val titleView = TextView(act).apply {
        setTextColor(Color.WHITE); textSize = 15f; typeface = Typeface.DEFAULT_BOLD; maxLines = 1
        ellipsize = TextUtils.TruncateAt.END; visibility = View.GONE
    }
    private fun icon(res: Int, size: Int = 44, onTap: (View) -> Unit) = ImageButton(act).apply {
        setImageResource(res); background = null; scaleType = ImageView.ScaleType.FIT_CENTER
        val p = dp(size / 5); setPadding(p, p, p, p)
        layoutParams = LinearLayout.LayoutParams(dp(size), dp(size))
        setOnClickListener { onTap(it); poke() }
    }
    private val playBtn = icon(R.drawable.pt_pause, 64) { if (exo.isPlaying) exo.pause() else { if (exo.playbackState == Player.STATE_ENDED) exo.seekTo(0); exo.play() } }
    private val audioBtn = icon(R.drawable.pt_audio) { switchAudio(!audioOnly) }
    private val fullBtn = icon(R.drawable.pt_full) { act.setFullscreen(!act.full) }
    private val timeView = TextView(act).apply { setTextColor(Color.WHITE); textSize = 12f; typeface = Typeface.MONOSPACE }
    private val bar = SegBar(act, accent) { seekTo(it); poke() }
    private val skipBtn = TextView(act).apply {
        setTextColor(Color.WHITE); textSize = 14f; typeface = Typeface.DEFAULT_BOLD
        setPadding(dp(16), dp(8), dp(16), dp(8)); background = pill(Color.argb(217, 15, 15, 15), true); visibility = View.GONE
        setOnClickListener { (tag as? Seg)?.let { seekTo(it.e) }; visibility = View.GONE }
    }
    private val noteText = TextView(act).apply { setTextColor(Color.WHITE); textSize = 13f }
    private val noteUndo = TextView(act).apply { setTextColor(accent); textSize = 13f; typeface = Typeface.DEFAULT_BOLD; text = "Undo"; setPadding(dp(16), 0, 0, 0) }
    private val note = LinearLayout(act).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; visibility = View.GONE
        setPadding(dp(16), dp(8), dp(16), dp(8)); background = pill(Color.argb(230, 15, 15, 15))
        addView(noteText); addView(noteUndo)
    }
    private val flash = TextView(act).apply {
        setTextColor(Color.WHITE); textSize = 15f; typeface = Typeface.DEFAULT_BOLD; visibility = View.GONE
        setPadding(dp(16), dp(10), dp(16), dp(10)); background = pill(Color.argb(170, 0, 0, 0))
    }

    init {
        val top = LinearLayout(act).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), dp(4), dp(4), 0)
            addView(titleView, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
            addView(audioBtn)
            addView(icon(R.drawable.pt_pip) { act.enterPip() })
            addView(icon(R.drawable.pt_tune) { menu(it) })
        }
        val middle = LinearLayout(act).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            addView(icon(R.drawable.pt_back10, 52) { seekTo(pos - 10) })
            addView(View(act), LinearLayout.LayoutParams(dp(32), 1))
            addView(playBtn)
            addView(View(act), LinearLayout.LayoutParams(dp(32), 1))
            addView(icon(R.drawable.pt_fwd10, 52) { seekTo(pos + 10) })
        }
        val bottom = LinearLayout(act).apply {
            orientation = LinearLayout.VERTICAL
            addView(LinearLayout(act).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), 0, dp(4), 0)
                addView(timeView, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
                addView(fullBtn)
            })
            addView(bar, LinearLayout.LayoutParams(MATCH_PARENT, dp(24)))
        }
        controls.addView(top, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.TOP))
        controls.addView(middle, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.CENTER))
        controls.addView(bottom, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.BOTTOM))
        view.addView(surface, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        view.addView(art, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        view.addView(spinner, FrameLayout.LayoutParams(dp(48), dp(48), Gravity.CENTER))
        view.addView(touch, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        view.addView(controls, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        view.addView(skipBtn, FrameLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT, Gravity.BOTTOM or Gravity.END).apply { setMargins(0, 0, dp(12), dp(56)) })
        view.addView(note, FrameLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = dp(12) })
        view.addView(flash, FrameLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT, Gravity.CENTER))
        bar.onDrag = { t -> if (t != null) timeView.text = "${fmt(t)} / ${fmt(dur)}" }
        gestures()
    }

    // ---- the page's commands

    fun play(j: JSONObject) {
        if (vid != null) stop()
        gen++
        vid = j.getString("vid"); title = j.optString("title"); channel = j.optString("channel"); thumb = j.optString("thumb")
        speed = j.optDouble("speed", 1.0).toFloat()
        maxHeight = prefs.getString("quality", "720")!!.toInt()
        audioOnly = prefs.getBoolean("audio_only", false)
        info = null; retried = false; segs = emptyList(); bar.segs = segs; marked = false; today = null
        played = 0.0; lastTick = SystemClock.elapsedRealtime(); lastSent = lastTick
        pos = j.optDouble("start", 0.0); dur = 0.0; playing = false
        titleView.text = title
        audioBtn.setImageResource(if (audioOnly) R.drawable.pt_video else R.drawable.pt_audio)
        art.setImageDrawable(null); art.visibility = View.VISIBLE
        spinner.visibility = View.VISIBLE; skipBtn.visibility = View.GONE; note.visibility = View.GONE
        act.showPlayer(true)
        loadArt()
        load(pos, fresh = false)
        sponsorLoad()
        showControls()
        main.removeCallbacks(tick); main.post(tick)
    }

    /** The page left the video: keep what was played, then stop. */
    fun stop() {
        if (vid == null) return
        report()
        close()
    }

    fun pause() = exo.pause()
    fun resume() = exo.play()
    fun seekTo(sec: Double) {
        val d = if (dur > 0) dur else Double.MAX_VALUE
        exo.seekTo((max(0.0, min(sec, d - 0.5)) * 1000).toLong())
        pos = exo.currentPosition / 1000.0
    }

    fun prefsJson(): String = JSONObject().put("pip", prefs.getBoolean("pip", true)).put("gestures", prefs.getBoolean("gestures", true))
        .put("audio_only", prefs.getBoolean("audio_only", false)).put("quality", prefs.getString("quality", "720")).toString()

    fun setPref(k: String, v: String) {
        val e = prefs.edit()
        if (k == "quality") e.putString(k, v) else e.putBoolean(k, v == "true")
        e.apply()
        act.updatePip()
    }

    val pipWanted get() = prefs.getBoolean("pip", true) && vid != null && exo.isPlaying && !audioOnly

    /** Picture in picture: the bare picture, no controls. */
    fun pipMode(on: Boolean) {
        if (on) { controls.visibility = View.GONE; skipBtn.visibility = View.GONE; note.visibility = View.GONE }
        titleView.visibility = if (act.full && !on) View.VISIBLE else View.GONE
    }

    fun fullChanged() {
        titleView.visibility = if (act.full) View.VISIBLE else View.GONE
        fullBtn.setImageResource(if (act.full) R.drawable.pt_full_exit else R.drawable.pt_full)
    }

    fun release() {
        exo.removeListener(listener)
        surface.player = null
        main.removeCallbacks(tick)
    }

    // ---- loading

    private fun item(): MediaItem = MediaItem.Builder().setMediaId(vid!!).setMediaMetadata(
        MediaMetadata.Builder().setTitle(title).setArtist(channel).setArtworkUri(thumb.takeIf { it.isNotEmpty() }?.let(Uri::parse)).build()
    ).build()

    private fun load(at: Double, fresh: Boolean) {
        val v = vid ?: return
        val g = gen
        spinner.visibility = View.VISIBLE
        Downloads.file(v)?.let { f ->
            height = -1
            set(Sources.file(act, f, item()), at)
            return
        }
        val it = item()
        val (h, a) = maxHeight to audioOnly
        io.execute {
            try {
                val i = Extractor.info(v, fresh)
                val (src, ht) = Sources.build(i, h, a, it)
                main.post { if (g == gen) { info = i; height = ht; set(src, at) } }
            } catch (e: Throwable) {
                main.post { if (g == gen) fail(e.message ?: e.javaClass.simpleName) }
            }
        }
    }

    private fun set(src: MediaSource, at: Double) {
        exo.setMediaSource(src, (at * 1000).toLong())
        exo.playbackParameters = PlaybackParameters(speed)
        exo.prepare()
        exo.playWhenReady = true
        art.visibility = if (audioOnly) View.VISIBLE else art.visibility
        act.startSession()
    }

    private fun loadArt() {
        val (g, u) = gen to thumb
        if (u.isEmpty()) return
        io.execute {
            val bm = runCatching { URL(u).openStream().use { BitmapFactory.decodeStream(it) } }.getOrNull() ?: return@execute
            main.post { if (g == gen) art.setImageBitmap(bm) }
        }
    }

    private fun switchAudio(on: Boolean) {
        if (vid == null || height == -1) return
        audioOnly = on
        audioBtn.setImageResource(if (on) R.drawable.pt_video else R.drawable.pt_audio)
        art.visibility = View.VISIBLE
        load(pos, fresh = false)
        note(if (on) "Sound only" else "Picture and sound")
        act.updatePip()
    }

    private val listener = object : Player.Listener {
        override fun onPlaybackStateChanged(state: Int) {
            if (vid == null) return
            spinner.visibility = if (state == Player.STATE_BUFFERING) View.VISIBLE else View.GONE
            if (state == Player.STATE_ENDED) ended()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            playing = isPlaying
            playBtn.setImageResource(if (isPlaying) R.drawable.pt_pause else R.drawable.pt_play)
            if (!isPlaying && vid != null) showControls() else poke()
            act.updatePip()
        }

        override fun onRenderedFirstFrame() {
            if (!audioOnly) art.visibility = View.GONE
        }

        override fun onPlayerError(error: PlaybackException) {
            if (vid == null) return
            if (!retried && height != -1) {  // the stream addresses may have run out: ask YouTube again, once
                retried = true
                load(pos, fresh = true)
                return
            }
            fail(error.message ?: "the video would not play")
        }
    }

    init { exo.addListener(listener) }  // here, after `listener` is set

    // ---- while it plays

    private val tick = object : Runnable {
        override fun run() {
            if (vid == null) return
            val now = SystemClock.elapsedRealtime()
            if (playing) played += min((now - lastTick) / 1000.0, 10.0)
            lastTick = now
            playing = exo.isPlaying
            pos = exo.currentPosition / 1000.0
            if (exo.duration > 0) dur = exo.duration / 1000.0
            if (!bar.dragging) {
                bar.set(pos, exo.bufferedPosition / 1000.0, dur)
                timeView.text = "${fmt(pos)} / ${fmt(dur)}" + if (speed != 1f) "  ·  ${trim(speed)}×" else ""
            }
            if (dur > 0 && pos >= dur * 0.9) markWatched()
            if (now - lastSent >= 15_000 && played > 0) report()
            sponsor()
            main.postDelayed(this, 250)
        }
    }

    private fun sponsor() {
        val g = segs.firstOrNull { pos >= it.s && pos < it.e - 0.5 }
        if (g != null && g.act == "skip" && !g.done) {
            g.done = true
            seekTo(g.e)
            note("Skipped: ${g.name}") { seekTo(g.s) }
            return
        }
        val ask = g?.takeIf { it.act == "ask" }
        if (skipBtn.tag !== ask) {
            skipBtn.tag = ask
            skipBtn.text = ask?.let { "Skip ${it.name.lowercase()}  ›" } ?: ""
            skipBtn.visibility = if (ask != null && !act.inPip) View.VISIBLE else View.GONE
        }
    }

    private fun sponsorLoad() {
        val (g, v) = gen to vid!!
        io.execute {
            val r = Server.get("/api/sponsor/$v") ?: return@execute
            val list = runCatching {
                val a = JSONObject(r).getJSONArray("segs")
                (0 until a.length()).map { k ->
                    val o = a.getJSONObject(k)
                    Seg(o.getDouble("s"), o.getDouble("e"), o.getString("act"), o.getString("name"),
                        runCatching { Color.parseColor(o.getString("color")) }.getOrDefault(accent))
                }
            }.getOrDefault(emptyList())
            main.post { if (g == gen) { segs = list; bar.segs = list; bar.invalidate() } }
        }
    }

    private fun markWatched() {
        if (marked) return
        marked = true
        val v = vid ?: return
        io.execute { Server.post("/api/watched/$v", """{"watched": true}""") }
    }

    private fun report(after: ((String?) -> Unit)? = null) {
        val v = vid ?: return
        val body = JSONObject().put("pos", pos).put("dur", dur).put("played", played).toString()
        played = 0.0
        lastSent = SystemClock.elapsedRealtime()
        io.execute {
            val r = Server.post("/api/progress/$v", body)
            if (r != null) today = r
            if (after != null) main.post { after(r ?: today) }
        }
    }

    private fun ended() {
        markWatched()
        val g = gen
        report { t -> if (g == gen) { close(); act.js("ptNative('ended', ${t ?: "null"})") } }
    }

    private fun fail(why: String) {
        close()
        act.js("ptNative('error', ${JSONObject.quote(why)})")
    }

    private fun close() {
        gen++
        vid = null
        playing = false
        main.removeCallbacks(tick)
        exo.stop()
        exo.clearMediaItems()
        controls.visibility = View.GONE
        act.showPlayer(false)
    }

    // ---- controls, notes, gestures

    private val hide = Runnable { if (exo.isPlaying) controls.visibility = View.GONE }

    private fun showControls() {
        if (act.inPip) return
        controls.visibility = View.VISIBLE
        poke()
    }

    /** Keep the controls up three more seconds from now. */
    private fun poke() {
        main.removeCallbacks(hide)
        main.postDelayed(hide, 3000)
    }

    private val noteGone = Runnable { note.visibility = View.GONE }
    private fun note(text: String, undo: (() -> Unit)? = null) {
        noteText.text = text
        noteUndo.visibility = if (undo != null) View.VISIBLE else View.GONE
        noteUndo.setOnClickListener { undo?.invoke(); note.visibility = View.GONE }
        note.visibility = if (act.inPip) View.GONE else View.VISIBLE
        main.removeCallbacks(noteGone)
        main.postDelayed(noteGone, if (undo != null) 6000 else 2500)
    }

    private val flashGone = Runnable { flash.visibility = View.GONE }
    private fun flash(text: String) {
        flash.text = text
        flash.visibility = View.VISIBLE
        main.removeCallbacks(flashGone)
        main.postDelayed(flashGone, 700)
    }

    private fun gestures() {
        val audio = act.getSystemService(AudioManager::class.java)
        var swipe = 0          // 0 not yet decided, 1 brightness, 2 volume, -1 neither
        var startLevel = 0f
        val detector = GestureDetector(act, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent): Boolean { swipe = 0; return true }

            override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
                if (controls.visibility == View.VISIBLE) { controls.visibility = View.GONE } else showControls()
                return true
            }

            override fun onDoubleTap(e: MotionEvent): Boolean {
                if (!prefs.getBoolean("gestures", true)) return false
                val w = touch.width
                when {
                    e.x < w / 3f -> { seekTo(pos - 10); flash("−10 s") }
                    e.x > w * 2 / 3f -> { seekTo(pos + 10); flash("+10 s") }
                    else -> if (exo.isPlaying) exo.pause() else exo.play()
                }
                return true
            }

            override fun onScroll(e1: MotionEvent?, e2: MotionEvent, dx: Float, dy: Float): Boolean {
                if (e1 == null || !prefs.getBoolean("gestures", true)) return false
                val tx = e2.x - e1.x; val ty = e2.y - e1.y
                if (swipe == 0) {
                    if (abs(ty) < dp(16) && abs(tx) < dp(16)) return false
                    swipe = if (abs(ty) <= abs(tx)) -1 else if (e1.x < touch.width / 2f) 1 else 2
                    startLevel = if (swipe == 1) {
                        act.window.attributes.screenBrightness.takeIf { it >= 0 } ?: 0.5f
                    } else {
                        audio.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                    }
                }
                val level = (startLevel - ty / (touch.height * 0.8f)).coerceIn(0f, 1f)
                when (swipe) {
                    1 -> {
                        act.window.attributes = act.window.attributes.apply { screenBrightness = max(level, 0.01f) }
                        flash("Brightness ${(level * 100).toInt()}%")
                    }
                    2 -> {
                        val maxV = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                        audio.setStreamVolume(AudioManager.STREAM_MUSIC, (level * maxV + 0.5f).toInt(), 0)
                        flash("Volume ${(level * 100).toInt()}%")
                    }
                }
                return swipe > 0
            }
        })
        touch.setOnTouchListener { v, e ->
            if (e.actionMasked == MotionEvent.ACTION_DOWN) v.parent.requestDisallowInterceptTouchEvent(true)
            detector.onTouchEvent(e)
        }
    }

    private fun menu(anchor: View) {
        val m = PopupMenu(ContextThemeWrapper(act, android.R.style.Theme_DeviceDefault), anchor)
        val i = info
        val q = m.menu.addSubMenu("Quality: " + when { height == -1 -> "downloaded file"; audioOnly -> "sound only"; height > 0 -> "${height}p"; else -> "…" })
        if (height == -1) {
            q.add("This plays the downloaded file").isEnabled = false
        } else {
            Extractor.videos(i ?: return).map { it.height }.distinct().forEach { h ->
                q.add("${h}p").apply { isCheckable = true; isChecked = !audioOnly && h == height }.setOnMenuItemClickListener {
                    maxHeight = h; audioOnly = false
                    audioBtn.setImageResource(R.drawable.pt_audio)
                    load(pos, fresh = false); true
                }
            }
            q.add("Sound only").apply { isCheckable = true; isChecked = audioOnly }.setOnMenuItemClickListener { switchAudio(true); true }
        }
        val s = m.menu.addSubMenu("Speed: ${trim(speed)}×")
        listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f, 2.5f, 3f).forEach { r ->
            s.add(if (r == 1f) "Normal" else "${trim(r)}×").apply { isCheckable = true; isChecked = r == speed }.setOnMenuItemClickListener {
                speed = r; exo.playbackParameters = PlaybackParameters(r); true
            }
        }
        m.show()
    }

    private fun trim(f: Float) = if (f == f.toInt().toFloat()) f.toInt().toString() else f.toString()

    private fun fmt(s: Double): String {
        val t = max(0, s.toInt()); val h = t / 3600; val m = t % 3600 / 60; val sec = t % 60
        return if (h > 0) "%d:%02d:%02d".format(h, m, sec) else "%d:%02d".format(m, sec)
    }
}

/** The seek bar: buffered part, SponsorBlock segments in their colours, and a thumb to drag. */
@SuppressLint("ViewConstructor", "ClickableViewAccessibility")
@UnstableApi
class SegBar(ctx: Context, private val accent: Int, private val onSeek: (Double) -> Unit) : View(ctx) {
    var segs = listOf<NativePlayer.Seg>()
    var dragging = false; private set
    var onDrag: ((Double?) -> Unit)? = null
    private var pos = 0.0; private var buf = 0.0; private var dur = 0.0; private var drag = 0.0
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val d = resources.displayMetrics.density
    private val pad = 12 * d

    fun set(p: Double, b: Double, total: Double) { pos = p; buf = b; dur = total; invalidate() }

    override fun onDraw(c: Canvas) {
        val w = width - 2 * pad
        val y = height / 2f
        val h = (if (dragging) 5 else 3) * d
        fun x(t: Double) = pad + (if (dur > 0) (t / dur).coerceIn(0.0, 1.0) else 0.0).toFloat() * w
        paint.color = Color.argb(77, 255, 255, 255); c.drawRect(pad, y - h / 2, pad + w, y + h / 2, paint)
        paint.color = Color.argb(128, 255, 255, 255); c.drawRect(pad, y - h / 2, x(buf), y + h / 2, paint)
        val at = if (dragging) drag else pos
        paint.color = accent; c.drawRect(pad, y - h / 2, x(at), y + h / 2, paint)
        for (g in segs) { paint.color = g.color; c.drawRect(x(g.s), y - h / 2, max(x(g.e), x(g.s) + 2 * d), y + h / 2, paint) }
        paint.color = accent; c.drawCircle(x(at), y, (if (dragging) 8 else 6) * d, paint)
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (dur <= 0) return false
        drag = ((e.x - pad) / (width - 2 * pad)).toDouble().coerceIn(0.0, 1.0) * dur
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { parent.requestDisallowInterceptTouchEvent(true); dragging = true; onDrag?.invoke(drag) }
            MotionEvent.ACTION_MOVE -> onDrag?.invoke(drag)
            MotionEvent.ACTION_UP -> { dragging = false; pos = drag; onSeek(drag); onDrag?.invoke(null) }
            MotionEvent.ACTION_CANCEL -> { dragging = false; onDrag?.invoke(null) }
        }
        invalidate()
        return true
    }
}

/** Calls to this phone's own server (server.py, on 127.0.0.1). Blocking: call off the main thread. */
object Server {
    private const val ORIGIN = "http://127.0.0.1:8765"
    private val json = "application/json".toMediaType()

    fun get(path: String): String? = call(okhttp3.Request.Builder().url(ORIGIN + path).build())
    fun post(path: String, body: String): String? = call(okhttp3.Request.Builder().url(ORIGIN + path).post(body.toRequestBody(json)).build())

    private fun call(r: okhttp3.Request): String? = runCatching {
        Net.client.newCall(r).execute().use { if (it.isSuccessful) it.body?.string() else null }
    }.getOrNull()
}
