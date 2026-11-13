package dev.russell.personaltube

import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.AudioTrackType
import org.schabi.newpipe.extractor.stream.DeliveryMethod
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamType
import org.schabi.newpipe.extractor.stream.VideoStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Finds the streams of a YouTube video with NewPipeExtractor, the library the NewPipe app uses. The extractor talks
 * to YouTube through [Net]; stream addresses last about six hours, so answers are kept for a few.
 */
object Extractor {
    private const val KEEP_MS = 4 * 3600_000L
    private val cache = ConcurrentHashMap<String, Pair<Long, StreamInfo>>()

    @Volatile private var ready = false

    private fun init() {
        if (ready) return
        synchronized(this) {
            if (!ready) { NewPipe.init(Net); ready = true }
        }
    }

    /** Blocking: call off the main thread. */
    fun info(vid: String, fresh: Boolean = false): StreamInfo {
        init()
        val now = System.currentTimeMillis()
        cache[vid]?.let { (t, i) -> if (!fresh && now - t < KEEP_MS) return i }
        val i = StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=$vid")
        if (i.streamType == StreamType.LIVE_STREAM || i.streamType == StreamType.AUDIO_LIVE_STREAM) {
            throw IllegalStateException("live streams play in YouTube's player")
        }
        cache[vid] = now to i
        return i
    }

    private fun usable(s: org.schabi.newpipe.extractor.stream.Stream) = s.isUrl && s.deliveryMethod == DeliveryMethod.PROGRESSIVE_HTTP

    /** Picture-only streams this phone can play, tallest first; H.264 first among equals (every phone decodes it). */
    fun videos(i: StreamInfo, mp4Only: Boolean = false): List<VideoStream> = i.videoOnlyStreams
        .filter { usable(it) && it.height > 0 }
        .filter { val c = it.codec.orEmpty(); c.startsWith("avc1") || (!mp4Only && (c.startsWith("vp9") || c.startsWith("vp09"))) }
        .sortedWith(compareByDescending<VideoStream> { it.height }.thenByDescending { it.fps }.thenBy { if (it.codec.orEmpty().startsWith("avc1")) 0 else 1 })

    /** The tallest picture stream not over `maxHeight` (or the shortest there is). */
    fun video(i: StreamInfo, maxHeight: Int, mp4Only: Boolean = false): VideoStream? {
        val all = videos(i, mp4Only)
        return all.firstOrNull { it.height <= maxHeight } ?: all.lastOrNull()
    }

    /** The video's own sound (not a dubbed track), AAC first for files, best bitrate. */
    fun audio(i: StreamInfo, aacOnly: Boolean = false): AudioStream? = i.audioStreams
        .filter { usable(it) && (!aacOnly || it.codec.orEmpty().startsWith("mp4a")) }
        .sortedWith(compareBy<AudioStream> { if (it.audioTrackType == null || it.audioTrackType == AudioTrackType.ORIGINAL) 0 else 1 }
            .thenBy { if (it.codec.orEmpty().startsWith("mp4a")) 0 else 1 }
            .thenByDescending { it.averageBitrate })
        .firstOrNull()

    /** A stream with picture and sound in one file (YouTube still offers 360p this way for most videos). */
    fun muxed(i: StreamInfo): VideoStream? = i.videoStreams.filter { usable(it) && it.codec.orEmpty().let { c -> c.isEmpty() || c.startsWith("avc1") } }
        .maxByOrNull { it.height }
}

/** The HTTP client for the extractor and for downloads. */
object Net : Downloader() {
    const val UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0"
    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()

    override fun execute(request: Request): Response {
        val body = request.dataToSend()?.toRequestBody()
        val b = okhttp3.Request.Builder().method(request.httpMethod(), body).url(request.url()).header("User-Agent", UA)
        request.headers().forEach { (k, vs) -> b.removeHeader(k); vs.forEach { b.addHeader(k, it) } }
        client.newCall(b.build()).execute().use { r ->
            if (r.code == 429) throw ReCaptchaException("YouTube asks this phone to prove it is not a bot", request.url())
            return Response(r.code, r.message, r.headers.toMultimap(), r.body?.string(), r.request.url.toString())
        }
    }
}
