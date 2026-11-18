package dev.russell.personaltube

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.IBinder
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * The phone's downloads. The server (server.py, through NATIVE) asks for them and lists the finished files; this
 * fetches them one at a time: H.264 picture and AAC sound in pieces, joined into one .mp4 with MediaMuxer. Files are
 * <dir>/<vid>.mp4, beside the <vid>.json the server wrote; work in progress lives in <dir>/.part.
 */
object Downloads {
    class Job(@Volatile var state: String = "queued", @Volatile var frac: Double = 0.0, @Volatile var error: String? = null) {
        @Volatile var cancel = false
    }

    private const val CHUNK = 4L shl 20  // YouTube slows down long single requests; 4 MiB pieces are not slowed
    lateinit var dir: File
    private lateinit var app: Context
    val jobs = ConcurrentHashMap<String, Job>()
    private val worker = Executors.newSingleThreadExecutor()

    fun init(ctx: Context) {
        app = ctx.applicationContext
        dir = File(app.getExternalFilesDir(null) ?: app.filesDir, "downloads").apply { mkdirs() }
        // pieces of downloads that were under way when the app was last killed (not when only the screen was reopened)
        if (jobs.isEmpty()) File(dir, ".part").listFiles()?.forEach { it.delete() }
    }

    fun file(vid: String) = File(dir, "$vid.mp4").takeIf { it.isFile }

    fun start(vid: String, quality: Int) {
        val old = jobs[vid]
        if (old != null && old.state != "error" && !old.cancel) return
        val job = Job()
        jobs[vid] = job
        DownloadService.update(app)
        worker.execute {
            if (job.cancel) { jobs.remove(vid, job); DownloadService.update(app); return@execute }
            job.state = "running"
            DownloadService.update(app)
            try {
                fetch(vid, quality, job)
                jobs.remove(vid, job)
            } catch (e: Throwable) {
                if (job.cancel) jobs.remove(vid, job)
                else { job.state = "error"; job.error = (e.message ?: e.javaClass.simpleName).take(300) }
            } finally {
                File(dir, ".part").listFiles()?.filter { it.name.startsWith(vid) }?.forEach { it.delete() }
                DownloadService.update(app)
            }
        }
    }

    fun cancel(vid: String) {
        jobs[vid]?.let { it.cancel = true; if (it.state != "running") jobs.remove(vid) }
        DownloadService.update(app)
    }

    fun json(): String = JSONObject().apply {
        jobs.forEach { (vid, j) ->
            put(vid, JSONObject().put("state", j.state).put("frac", j.frac).apply { j.error?.let { put("error", it) } })
        }
    }.toString()

    private class Status(val code: Int) : IOException("YouTube answered $code for the stream")

    private fun fetch(vid: String, quality: Int, job: Job) {
        try {
            fetch(vid, quality, job, Extractor.info(vid))
        } catch (e: IOException) {  // the stream addresses may have run out (the player retries the same way): once more, with new ones
            if (job.cancel) throw e
            fetch(vid, quality, job, Extractor.info(vid, fresh = true))
        }
    }

    private fun fetch(vid: String, quality: Int, job: Job, i: org.schabi.newpipe.extractor.stream.StreamInfo) {
        val part = File(dir, ".part").apply { mkdirs() }
        val out = File(part, "$vid.mp4")
        val video = Extractor.video(i, quality, mp4Only = true)
        val audio = Extractor.audio(i, aacOnly = true)
        val height: Int
        if (video != null && audio != null) {
            val v = File(part, "$vid.v"); val a = File(part, "$vid.a")
            val vLen = video.itagItem?.contentLength ?: -1
            val aLen = audio.itagItem?.contentLength ?: -1
            val share = if (vLen > 0 && aLen > 0) vLen.toDouble() / (vLen + aLen) else 0.85
            get(video.content, v, job) { job.frac = it * share }
            get(audio.content, a, job) { job.frac = share + it * (1 - share) }
            mux(v, a, out)
            height = video.height
        } else {
            val m = Extractor.muxed(i) ?: throw IOException("YouTube offered no stream that makes an .mp4")
            get(m.content, out, job) { job.frac = it }
            height = m.height
        }
        if (job.cancel) throw IOException("cancelled")
        if (!out.renameTo(File(dir, "$vid.mp4"))) throw IOException("could not move the finished file into place")
        val meta = File(dir, "$vid.json")
        val o = runCatching { JSONObject(meta.readText()) }.getOrElse { JSONObject() }
        meta.writeText(o.put("height", height).put("ts", System.currentTimeMillis() / 1000.0).toString())
    }

    /** Fetches `url` into `to` in CHUNK-sized ranges, reporting the fraction done. A range that breaks off (the
     *  network dropped) is asked for again from where it stopped, a few times; a refusal is not. */
    private fun get(url: String, to: File, job: Job, progress: (Double) -> Unit) {
        RandomAccessFile(to, "rw").use { f ->
            f.setLength(0)
            var pos = 0L
            var total = -1L
            var fails = 0
            while (total < 0 || pos < total) {
                if (job.cancel) throw IOException("cancelled")
                val before = pos
                val req = okhttp3.Request.Builder().url(url).header("User-Agent", Net.UA)
                    .header("Range", "bytes=$pos-${pos + CHUNK - 1}").build()
                try {
                    Net.client.newCall(req).execute().use { r ->
                        if (r.code != 206 && r.code != 200) throw Status(r.code)
                        total = when {
                            r.code == 200 -> r.body?.contentLength() ?: -1
                            else -> r.header("Content-Range")?.substringAfter('/')?.toLongOrNull() ?: -1
                        }
                        if (r.code == 200) pos = 0  // the whole file, whatever range was asked for
                        f.seek(pos)
                        val body = r.body ?: throw IOException("empty answer from YouTube")
                        val buf = ByteArray(64 shl 10)
                        body.byteStream().use { s ->
                            while (true) {
                                if (job.cancel) throw IOException("cancelled")
                                val n = s.read(buf)
                                if (n < 0) break
                                f.write(buf, 0, n)
                                pos += n
                                if (total > 0) progress(pos.toDouble() / total)
                            }
                        }
                        if (r.code == 200) total = pos  // the whole file came at once
                    }
                } catch (e: Status) {
                    throw e
                } catch (e: IOException) {
                    if (job.cancel || ++fails > 3) throw e
                    Thread.sleep(1000L * fails)
                    continue
                }
                if (total < 0) throw IOException("YouTube did not say how long the stream is")
                if (pos == before && pos < total) throw IOException("YouTube sent nothing more of the stream")
                fails = 0
            }
        }
    }

    /** Joins a picture-only and a sound-only MP4 (fragmented, as YouTube serves them) into one plain MP4. */
    private fun mux(video: File, audio: File, out: File) {
        val sources = ArrayList<MediaExtractor>()
        var made: MediaMuxer? = null
        try {
            for (f in listOf(video, audio)) {
                val ex = MediaExtractor()
                sources += ex  // first, so that it is released if the file cannot be read
                ex.setDataSource(f.path)
                ex.selectTrack(0)
            }
            val muxer = MediaMuxer(out.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4).also { made = it }
            val formats = sources.map { it.getTrackFormat(0) }
            val tracks = formats.map { muxer.addTrack(it) }
            muxer.start()
            // room for the largest sample the streams announce (a 4K key frame can pass 4 MiB)
            val buf = ByteBuffer.allocate(formats.maxOf { if (it.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) it.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) else 0 }.coerceAtLeast(4 shl 20))
            val info = MediaCodec.BufferInfo()
            sources.forEachIndexed { k, ex ->
                while (true) {
                    val n = ex.readSampleData(buf, 0)
                    if (n < 0) break
                    info.set(0, n, ex.sampleTime, if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
                    muxer.writeSampleData(tracks[k], buf, info)
                    ex.advance()
                }
            }
            muxer.stop()
        } finally {
            sources.forEach { it.release() }
            made?.release()
        }
    }
}

/** Shows that downloads are under way, and keeps the app alive for them while it is in the background. */
class DownloadService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val n = build(this)
        if (n == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        return START_NOT_STICKY
    }

    companion object {
        private const val CHANNEL = "downloads"
        private const val ID = 7
        private var ticker: Thread? = null

        private fun active() = Downloads.jobs.values.filter { it.state == "queued" || it.state == "running" }

        @androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])  // MainActivity is marked UnstableApi
        private fun build(ctx: Context): Notification? {
            val active = active()
            if (active.isEmpty()) return null
            ctx.getSystemService(NotificationManager::class.java)
                .createNotificationChannel(NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW))
            val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE)
            val run = active.firstOrNull { it.state == "running" }
            return Notification.Builder(ctx, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(if (active.size == 1) "Downloading a video" else "Downloading ${active.size} videos")
                .setProgress(100, ((run?.frac ?: 0.0) * 100).toInt(), run == null)
                .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).build()
        }

        /** Starts the service when a download is asked for; while any run, refreshes its notification; then ends it. */
        fun update(ctx: Context) {
            synchronized(this) {
                if (ticker != null) return
                if (active().isEmpty()) return
                runCatching { ctx.startService(Intent(ctx, DownloadService::class.java)) }
                ticker = Thread {
                    val nm = ctx.getSystemService(NotificationManager::class.java)
                    while (true) {
                        Thread.sleep(2000)
                        // the last look and the stop are one step, so a download asked for meanwhile starts the service anew
                        val n = synchronized(this) {
                            build(ctx).also { if (it == null) { ticker = null; ctx.stopService(Intent(ctx, DownloadService::class.java)) } }
                        } ?: break
                        runCatching { nm.notify(ID, n) }
                    }
                }.apply { isDaemon = true; start() }
            }
        }
    }
}
