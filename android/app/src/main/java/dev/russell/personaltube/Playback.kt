package dev.russell.personaltube

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.dash.DashMediaSource
import androidx.media3.exoplayer.dash.manifest.DashManifestParser
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.MergingMediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import org.schabi.newpipe.extractor.services.youtube.YoutubeParsingHelper
import org.schabi.newpipe.extractor.services.youtube.dashmanifestcreators.YoutubeProgressiveDashManifestCreator
import org.schabi.newpipe.extractor.stream.Stream
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.io.ByteArrayInputStream
import java.io.File
import java.util.concurrent.atomic.AtomicLong

/** The one ExoPlayer of the app, shared by the player on screen and the media session (lock screen, notification). */
@UnstableApi
object Players {
    private var exo: ExoPlayer? = null

    fun get(ctx: Context): ExoPlayer = exo ?: ExoPlayer.Builder(ctx.applicationContext)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
        .setHandleAudioBecomingNoisy(true)   // headphones out: pause
        .setWakeMode(C.WAKE_MODE_NETWORK)    // keep streaming with the screen off
        .setSeekBackIncrementMs(10_000).setSeekForwardIncrementMs(10_000)
        .build().also { exo = it }
}

/**
 * Keeps playback going with the screen off or the app in the background, with controls in the notification and on
 * the lock screen. Media3 puts it in the foreground while something plays and takes it out when playback stops.
 */
@UnstableApi
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        session = MediaSession.Builder(this, Players.get(this)).setSessionActivity(open).build().also { addSession(it) }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = session

    override fun onTaskRemoved(rootIntent: Intent?) {  // swiped away from recents: stop, as the app is gone
        Players.get(this).pause()
        stopSelf()
    }

    override fun onDestroy() {
        session?.release()
        session = null
        super.onDestroy()
    }
}

/**
 * Media sources for YouTube's streams, built the way the NewPipe app builds them so YouTube neither throttles nor
 * refuses them: each picture-only or sound-only stream becomes a one-stream DASH manifest (so the player asks for it
 * piece by piece), and every request to googlevideo carries `rn` (a request counter) and `range` in the address, as
 * a POST, with the user agent of the client the stream address was made for.
 */
@UnstableApi
object Sources {
    private val rn = AtomicLong(1)
    private val visionUa by lazy { runCatching { YoutubeParsingHelper.getVisionOsUserAgent(null) }.getOrDefault(Net.UA) }

    private fun http(rangeParam: Boolean): DataSource.Factory {
        val base = DefaultHttpDataSource.Factory().setUserAgent(Net.UA).setKeepPostFor302Redirects(true)
            .setAllowCrossProtocolRedirects(true).setConnectTimeoutMs(15_000).setReadTimeoutMs(30_000)
        return ResolvingDataSource.Factory(base) { spec -> rewrite(spec, rangeParam) }
    }

    private fun rewrite(spec: DataSpec, rangeParam: Boolean): DataSpec {
        val u = spec.uri.toString()
        if (!u.contains("/videoplayback")) return spec
        val b = spec.buildUpon()
        var url = "$u&rn=${rn.getAndIncrement()}"
        if (rangeParam && spec.length != C.LENGTH_UNSET.toLong()) {
            url += "&range=${spec.position}-${spec.position + spec.length - 1}"
            b.setPosition(0).setLength(C.LENGTH_UNSET.toLong())
        }
        val headers = HashMap(spec.httpRequestHeaders)
        headers["User-Agent"] = if (u.contains("c=VISIONOS")) visionUa else Net.UA
        return b.setUri(url).setHttpMethod(DataSpec.HTTP_METHOD_POST).setHttpBody(byteArrayOf(0x78, 0))
            .setHttpRequestHeaders(headers).build()
    }

    private fun one(s: Stream, durationSec: Long, item: MediaItem): MediaSource {
        val itag = s.itagItem
        if (itag != null) {
            runCatching {
                val mpd = YoutubeProgressiveDashManifestCreator.fromProgressiveStreamingUrl(s.content, itag, durationSec)
                val manifest = DashManifestParser().parse(Uri.parse(s.content), ByteArrayInputStream(mpd.toByteArray()))
                return DashMediaSource.Factory(http(true)).createMediaSource(manifest, item.buildUpon().setUri(s.content).build())
            }
        }
        return ProgressiveMediaSource.Factory(http(false)).createMediaSource(item.buildUpon().setUri(s.content).build())
    }

    /** What to play: picture (at most `maxHeight` tall) and sound, or sound alone. Returns the source and its height. */
    fun build(i: StreamInfo, maxHeight: Int, audioOnly: Boolean, item: MediaItem): Pair<MediaSource, Int> {
        val audio = Extractor.audio(i)
        val video = if (audioOnly) null else Extractor.video(i, maxHeight)
        if (audio != null && video != null) {
            return MergingMediaSource(true, one(video, i.duration, item), one(audio, i.duration, item)) to video.height
        }
        if (audio != null && audioOnly) return one(audio, i.duration, item) to 0
        val muxed = Extractor.muxed(i) ?: throw IllegalStateException("YouTube offered no stream this phone can play")
        return ProgressiveMediaSource.Factory(http(false)).createMediaSource(item.buildUpon().setUri(muxed.content).build()) to muxed.height
    }

    fun file(ctx: Context, f: File, item: MediaItem): MediaSource =
        ProgressiveMediaSource.Factory(DefaultDataSource.Factory(ctx)).createMediaSource(item.buildUpon().setUri(Uri.fromFile(f)).build())
}
