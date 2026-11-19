package kotatsu

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.koitharu.kotatsu.parsers.MangaLoaderContext
import org.koitharu.kotatsu.parsers.MangaParser
import org.koitharu.kotatsu.parsers.ParsersBundle
import org.koitharu.kotatsu.parsers.bitmap.Bitmap
import org.koitharu.kotatsu.parsers.bitmap.Rect
import org.koitharu.kotatsu.parsers.config.ConfigKey
import org.koitharu.kotatsu.parsers.config.MangaSourceConfig
import org.koitharu.kotatsu.parsers.core.ParsersBundleImpl
import org.koitharu.kotatsu.parsers.model.MangaSource
import org.koitharu.kotatsu.parsers.model.ParserMangaSource
import org.koitharu.kotatsu.parsers.network.UserAgents
import org.koitharu.kotatsu.parsers.util.requireBody
import java.awt.Graphics2D
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.imageio.ImageIO

/**
 * Everything the parsers need from a host application, implemented on the desktop JVM.
 * The Android app implements the same contract in app/.../MangaLoaderContextImpl.kt.
 */
class DesktopLoader(val workDir: File) : MangaLoaderContext() {

    /** Set once the parser cache exists; every tagged request goes through it. */
    @Volatile
    var parserResolver: ((String) -> MangaParser)? = null

    override val cookieJar = MemoryCookieJar()

    override val parsers: ParsersBundle
        get() = ParsersBundleImpl

    override val httpClient: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .addInterceptor(SourceHeadersInterceptor(this))
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .trustAllCertificates()
        .build()

    @Deprecated("Provide a base url")
    override suspend fun evaluateJs(script: String): String? = evaluateJs("", script, 10_000L)

    override suspend fun evaluateJs(baseUrl: String, script: String, timeout: Long): String? {
        return NodeJs.evaluate(workDir, baseUrl, script, timeout)
    }

    override fun getConfig(source: MangaSource): MangaSourceConfig = DefaultSourceConfig

    override fun getDefaultUserAgent(): String = UserAgents.CHROME_MOBILE

    override fun redrawImageResponse(response: Response, redraw: (Bitmap) -> Bitmap): Response {
        val image = response.requireBody().byteStream().use { ImageIO.read(it) }
            ?: error("Cannot decode image")
        val result = redraw(BitmapImpl(image)) as BitmapImpl
        val bytes = result.toBytes()
        return response.newBuilder()
            .body(bytes.toResponseBody("image/png".toMediaTypeOrNull()))
            .build()
    }

    override fun createBitmap(width: Int, height: Int): Bitmap =
        BitmapImpl(BufferedImage(width.coerceAtLeast(1), height.coerceAtLeast(1), BufferedImage.TYPE_INT_ARGB))

    private val warmed = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    /**
     * Some sites answer their catalogue only after the home page has set session cookies.
     * Does that once per source, and only when a request already failed.
     */
    fun warmUp(parser: MangaParser): Boolean {
        if (!warmed.add(parser.source.name)) return false
        return runCatching {
            val request = Request.Builder()
                .url("https://${parser.domain}/")
                .tag(MangaSource::class.java, parser.source)
                .build()
            httpClient.newCall(request).execute().use { it.close() }
            true
        }.getOrDefault(false)
    }
}

/** One parser object per source, the way the app's repository holds them. */
class Parsers(private val loader: DesktopLoader) {

    private val cache = ConcurrentHashMap<String, MangaParser>()

    val sources: List<ParserMangaSource>
        get() = ParsersBundleImpl.sources

    fun source(name: String): ParserMangaSource =
        ParsersBundleImpl.findSource(name) ?: throw NoSuchElementException("Unknown source: $name")

    fun parser(name: String): MangaParser = cache.computeIfAbsent(name) {
        loader.newParserInstance(source(name))
    }
}

/**
 * Applies the parser's own headers and user agent to every request that carries a source tag,
 * then lets the parser intercept it (that is where referer tricks and image descrambling live).
 */
class SourceHeadersInterceptor(private val loader: DesktopLoader) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val source = request.tag(MangaSource::class.java) ?: return chain.proceed(request)
        val parser = loader.parserResolver?.invoke(source.name) ?: return chain.proceed(request)

        val headers = request.headers.newBuilder()
        for ((name, value) in parser.getRequestHeaders()) {
            if (headers[name] == null) headers[name] = value
        }
        if (headers["User-Agent"] == null) {
            headers["User-Agent"] = loader.getDefaultUserAgent()
        }
        if (headers["Referer"] == null) {
            headers["Referer"] = "https://${parser.domain}/"
        }
        val tagged = request.newBuilder().headers(headers.build()).build()
        return parser.intercept(object : Interceptor.Chain by chain {
            override fun request(): Request = tagged
        })
    }
}

object DefaultSourceConfig : MangaSourceConfig {
    override fun <T> get(key: ConfigKey<T>): T = key.defaultValue
}

/**
 * Many scraper sites serve an incomplete certificate chain (fine in Chrome, fatal in the JDK).
 * This is a local reader fetching public pages, so it accepts the certificate as presented.
 */
private fun OkHttpClient.Builder.trustAllCertificates(): OkHttpClient.Builder {
    val manager = object : javax.net.ssl.X509TrustManager {
        override fun checkClientTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String) = Unit
        override fun checkServerTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String) = Unit
        override fun getAcceptedIssuers(): Array<java.security.cert.X509Certificate> = emptyArray()
    }
    val context = javax.net.ssl.SSLContext.getInstance("TLS")
    context.init(null, arrayOf(manager), java.security.SecureRandom())
    sslSocketFactory(context.socketFactory, manager)
    hostnameVerifier { _, _ -> true }
    return this
}

class MemoryCookieJar : CookieJar {

    private val store = ConcurrentHashMap<String, MutableList<Cookie>>()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (cookies.isEmpty()) return
        val list = store.getOrPut(url.host) { mutableListOf() }
        synchronized(list) {
            for (cookie in cookies) {
                list.removeAll { it.name == cookie.name && it.path == cookie.path }
                if (cookie.expiresAt > System.currentTimeMillis()) list.add(cookie)
            }
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val list = store[url.host] ?: return emptyList()
        val now = System.currentTimeMillis()
        synchronized(list) {
            list.removeAll { it.expiresAt <= now }
            return list.filter { it.matches(url) }
        }
    }
}

class BitmapImpl(val image: BufferedImage) : Bitmap {

    override val width: Int get() = image.width
    override val height: Int get() = image.height

    override fun drawBitmap(sourceBitmap: Bitmap, src: Rect, dst: Rect) {
        val other = sourceBitmap as BitmapImpl
        val graphics: Graphics2D = image.createGraphics()
        try {
            val sub = other.image.getSubimage(
                src.left.coerceIn(0, other.image.width - 1),
                src.top.coerceIn(0, other.image.height - 1),
                src.width.coerceAtMost(other.image.width - src.left.coerceAtLeast(0)),
                src.height.coerceAtMost(other.image.height - src.top.coerceAtLeast(0)),
            )
            graphics.drawImage(sub, dst.left, dst.top, dst.width, dst.height, null)
        } finally {
            graphics.dispose()
        }
    }

    fun toBytes(): ByteArray = ByteArrayOutputStream().also { ImageIO.write(image, "png", it) }.toByteArray()
}

/** The handful of parsers that unpack obfuscated pages run their script in the Node that is already on the laptop. */
object NodeJs {

    private var runner: File? = null
    private var node: String? = null
    private var probed = false

    fun evaluate(workDir: File, baseUrl: String, script: String, timeout: Long): String? {
        val executable = executable() ?: return null
        val dir = File(workDir, "cache/js").apply { mkdirs() }
        val file = File.createTempFile("eval", ".js", dir)
        return try {
            file.writeText(script)
            val process = ProcessBuilder(
                executable,
                ensureRunner(dir).absolutePath,
                file.absolutePath,
                baseUrl,
            ).redirectErrorStream(false).start()
            val finished = process.waitFor(timeout.coerceIn(1000L, 20_000L), TimeUnit.MILLISECONDS)
            if (!finished) {
                process.destroyForcibly()
                return null
            }
            val out = process.inputStream.bufferedReader().readText().trim()
            out.ifEmpty { null }
        } catch (_: Exception) {
            null
        } finally {
            file.delete()
        }
    }

    private fun ensureRunner(dir: File): File {
        runner?.let { if (it.exists()) return it }
        val file = File(dir, "runner.js")
        file.writeText(
            """
            const fs = require('fs'), vm = require('vm');
            const src = fs.readFileSync(process.argv[2], 'utf8');
            const base = process.argv[3] || '';
            const box = {
              console,
              atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
              btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
              navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/114.0 Mobile Safari/537.36' },
              location: { href: base },
              document: {}, window: {}, self: {}, top: {},
            };
            box.window = box; box.self = box; box.top = box; box.globalThis = box;
            let out;
            try {
              out = vm.runInNewContext(src, box, { timeout: 8000 });
            } catch (e) {
              try { out = vm.runInNewContext('(function(){' + src + '})()', box, { timeout: 8000 }); }
              catch (e2) { process.stderr.write(String(e2)); process.exit(1); }
            }
            if (out !== undefined && out !== null) process.stdout.write(typeof out === 'string' ? out : JSON.stringify(out));
            """.trimIndent(),
        )
        runner = file
        return file
    }

    private fun executable(): String? {
        if (probed) return node
        probed = true
        val candidates = buildList {
            System.getenv("PATH").orEmpty().split(File.pathSeparator).forEach { dir ->
                add(File(dir, "node.exe").path)
                add(File(dir, "node").path)
            }
            add("C:/Program Files/nodejs/node.exe")
            add(System.getProperty("user.home") + "/AppData/Local/hermes/tools/node-26.12.1-win32-x64/node.exe")
        }
        node = candidates.firstOrNull { it == "node" || File(it).canExecute() }
        return node
    }
}
