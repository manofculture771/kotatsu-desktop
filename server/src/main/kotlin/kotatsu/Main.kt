package kotatsu

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import org.koitharu.kotatsu.parsers.model.ContentRating
import org.koitharu.kotatsu.parsers.model.Manga
import org.koitharu.kotatsu.parsers.model.MangaChapter
import org.koitharu.kotatsu.parsers.model.MangaListFilter
import org.koitharu.kotatsu.parsers.model.MangaPage
import org.koitharu.kotatsu.parsers.model.MangaSource
import org.koitharu.kotatsu.parsers.model.MangaState
import org.koitharu.kotatsu.parsers.model.MangaTag
import org.koitharu.kotatsu.parsers.model.SortOrder
import java.awt.Desktop
import java.io.File
import java.net.InetSocketAddress
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking

private class ApiException(val status: Int, override val message: String) : RuntimeException(message)

private val BUILD_ID: Long = System.currentTimeMillis()

private object ImageStats {
    val requested = java.util.concurrent.atomic.AtomicLong()
    val served = java.util.concurrent.atomic.AtomicLong()
    val failed = java.util.concurrent.atomic.AtomicLong()
    private val errors = java.util.concurrent.ConcurrentLinkedQueue<String>()

    fun note(message: String?) {
        if (message.isNullOrBlank()) return
        errors.add(message.take(200))
        while (errors.size > 20) errors.poll()
    }

    fun recent(): List<String> = errors.toList()
}

fun main(args: Array<String>) {
    System.setProperty("java.awt.headless", "true")
    val root = File(System.getProperty("user.dir"))
    val webDir = File(args.valueOfOrNull("--web") ?: "web").absoluteFile
    val dataDir = File(args.valueOfOrNull("--data") ?: "data").absoluteFile.apply { mkdirs() }
    val quiet = args.contains("--no-open")
    val preferredPort = args.valueOfOrNull("--port")?.toIntOrNull() ?: 8787

    val loader = DesktopLoader(dataDir)
    val parsers = Parsers(loader)
    loader.parserResolver = parsers::parser

    // A second double-click is a request to open the tab, not to start a second library.
    if (isKotatsuRunning(preferredPort)) {
        println("Kotatsu Desktop already running on port $preferredPort")
        if (!quiet) openBrowser("http://127.0.0.1:$preferredPort/")
        return
    }

    val api = Api(loader, parsers, webDir, dataDir)
    var server: HttpServer? = null
    var port = preferredPort
    while (server == null && port < preferredPort + 30) {
        server = runCatching {
            HttpServer.create(InetSocketAddress("127.0.0.1", port), 0).also { srv ->
                srv.executor = Executors.newFixedThreadPool(32)
                srv.createContext("/") { exchange -> api.handle(exchange) }
                srv.start()
            }
        }.getOrNull()
        if (server == null) port++
    }
    if (server == null) {
        System.err.println("Kotatsu Desktop: no free port in $preferredPort..${preferredPort + 29}")
        kotlin.system.exitProcess(1)
    }
    val running = server

    val url = "http://127.0.0.1:$port/"
    println("Kotatsu Desktop")
    println("  sources : ${parsers.sources.size}")
    println("  web     : $webDir")
    println("  data    : $dataDir")
    println("  url     : $url")
    System.out.flush()

    if (!quiet) openBrowser(url)
    Runtime.getRuntime().addShutdownHook(Thread { running.stop(0) })
}

private fun openBrowser(url: String) {
    runCatching {
        if (System.getProperty("os.name").lowercase(Locale.ROOT).contains("win")) {
            ProcessBuilder("rundll32", "url.dll,FileProtocolHandler", url).start()
        } else {
            Desktop.getDesktop().browse(URI(url))
        }
    }
}

private fun isKotatsuRunning(port: Int): Boolean = runCatching {
    val connection = URI("http://127.0.0.1:$port/api/health").toURL().openConnection() as java.net.HttpURLConnection
    connection.connectTimeout = 600
    connection.readTimeout = 900
    val body = connection.inputStream.use { it.readBytes() }.decodeToString()
    connection.disconnect()
    body.contains("\"ok\":true")
}.getOrDefault(false)

private fun Array<String>.valueOfOrNull(key: String): String? {
    val index = indexOf(key)
    return if (index >= 0 && index + 1 < size) this[index + 1] else null
}

class Api(
    private val loader: DesktopLoader,
    private val parsers: Parsers,
    private val webDir: File,
    private val dataDir: File,
) {

    fun handle(exchange: HttpExchange) {
        try {
            val path = exchange.requestURI.path
            if (path.startsWith("/api/")) {
                handleApi(exchange, path)
            } else {
                serveStatic(exchange, path)
            }
        } catch (e: ApiException) {
            sendJson(exchange, JSONObject().put("error", e.message), e.status)
        } catch (e: Exception) {
            val message = e.message?.takeIf { it.isNotBlank() } ?: e.javaClass.simpleName
            runCatching { sendJson(exchange, JSONObject().put("error", message), 500) }
            e.printStackTrace()
        } finally {
            runCatching { exchange.close() }
        }
    }

    private fun handleApi(exchange: HttpExchange, path: String) {
        val segments = path.removePrefix("/api/").split('/').filter { it.isNotEmpty() }
        if (segments.isEmpty()) throw ApiException(404, "Not found")
        when (segments[0]) {
            "health" -> sendJson(
                exchange,
                JSONObject().put("ok", true).put("sources", parsers.sources.size).put("build", BUILD_ID),
            )
            "sources" -> {
                if (segments.size == 1) {
                    val all = exchange.query()["all"] == "1"
                    val allowed = if (all) null else enabledSourceNames()
                    val visible = if (allowed == null) {
                        parsers.sources
                    } else {
                        parsers.sources.filter { it.name in allowed }
                    }
                    val sorted = visible.sortedWith(
                        compareBy(
                            { mapOf("en" to 0, "ar" to 1, "" to 2)[it.locale] ?: 9 },
                            { it.title.lowercase(Locale.ROOT) },
                        ),
                    )
                    val array = JSONArray(sorted.map { it.toJson() })
                    sendJson(
                        exchange,
                        JSONObject()
                            .put("count", sorted.size)
                            .put("default", "MANGADEX")
                            .put("filtered", allowed != null)
                            .put("sources", array),
                    )
                } else {
                    val source = parsers.source(segments[1])
                    when (segments.getOrNull(2)) {
                        "list" -> handleList(exchange, segments[1])
                        "filters" -> handleFilters(exchange, segments[1])
                        "manga" -> handleManga(exchange, segments[1])
                        "pages" -> handlePages(exchange, segments[1])
                        else -> throw ApiException(404, "Unknown action for source ${source.name}")
                    }
                }
            }
            "img" -> handleImage(exchange)
            "img-stats" -> sendJson(
                exchange,
                JSONObject()
                    .put("requested", ImageStats.requested.get())
                    .put("served", ImageStats.served.get())
                    .put("failed", ImageStats.failed.get())
                    .put("recent", JSONArray(ImageStats.recent().map { it })),
            )
            "resolve" -> handleResolve(exchange)
            else -> throw ApiException(404, "Not found: $path")
        }
    }

    private fun handleList(exchange: HttpExchange, sourceName: String) {
        val parser = parsers.parser(sourceName)
        val params = exchange.query()
        val page = params["page"]?.toIntOrNull()?.coerceIn(1, 500) ?: 1
        val orderName = params["order"]
        val order = orderName?.let { runCatching { SortOrder.valueOf(it) }.getOrNull() }
            ?: parser.availableSortOrders.firstOrNull()
            ?: SortOrder.UPDATED
        val query = params["q"]?.trim()?.takeIf { it.isNotEmpty() }
        val tagKeys = params["tags"]?.split(',')?.filter { it.isNotBlank() }.orEmpty()
        val tags = tagKeys.mapTo(mutableSetOf()) { key ->
            MangaTag(title = key, key = key, source = parser.source)
        }
        val states = params["states"]?.split(',')?.mapNotNull { runCatching { MangaState.valueOf(it) }.getOrNull() }
            ?.toSet().orEmpty()
        val rating = params["rating"]?.split(',')
            ?.mapNotNull { runCatching { ContentRating.valueOf(it) }.getOrNull() }?.toSet().orEmpty()

        val filter = MangaListFilter(
            query = query,
            tags = tags,
            states = states,
            contentRating = rating,
        )
        // The parsers paginate by item offset, not by page number: the app calls 0 for page one.
        val pageSize = (parser as? org.koitharu.kotatsu.parsers.core.PagedMangaParser)?.pageSize ?: 0
        val offset = if (pageSize > 0) (page - 1) * pageSize else page - 1
        val items = if (sourceName == "MANGAGEKO" && query == null) {
            MangaGekoCatalog.list(loader, parser, page, order.name, tagKeys.toSet())
        } else try {
            runBlocking { parser.getList(offset, order, filter) }
        } catch (first: Exception) {
            // Sites that gate their catalogue behind a session cookie: warm it, then ask once more.
            if (loader.warmUp(parser)) runBlocking { parser.getList(offset, order, filter) } else throw first
        }
        val array = JSONArray(items.map { it.toJson() })
        sendJson(
            exchange,
            JSONObject()
                .put("source", sourceName)
                .put("page", page)
                .put("order", order.name)
                .put("items", array),
        )
    }

    private fun handleFilters(exchange: HttpExchange, sourceName: String) {
        val parser = parsers.parser(sourceName)
        val options = runBlocking { parser.getFilterOptions() }
        val json = JSONObject()
            .put("orders", sortOrdersJson(parser.availableSortOrders))
            .put("capabilities", parser.filterCapabilities.toJson())
            .put("options", options.toJson())
        sendJson(exchange, json)
    }

    private fun handleManga(exchange: HttpExchange, sourceName: String) {
        val parser = parsers.parser(sourceName)
        val params = exchange.query()
        val url = params["u"] ?: throw ApiException(400, "Missing manga url")
        val id = params["id"]?.toLongOrNull() ?: 0L
        val title = params["t"].orEmpty()
        val publicUrl = if (url.startsWith("http")) url else "https://${parser.domain}$url"
        val manga = Manga(
            id = id,
            title = title,
            altTitles = emptySet(),
            url = url,
            publicUrl = publicUrl,
            rating = 0f,
            contentRating = null,
            coverUrl = null,
            tags = emptySet(),
            state = null,
            authors = emptySet(),
            source = parser.source,
        )
        val details = runBlocking { parser.getDetails(manga) }
        sendJson(exchange, JSONObject().put("manga", details.toJson()))
    }

    private fun handlePages(exchange: HttpExchange, sourceName: String) {
        val parser = parsers.parser(sourceName)
        val params = exchange.query()
        val url = params["u"] ?: throw ApiException(400, "Missing chapter url")
        val chapter = MangaChapter(
            id = params["id"]?.toLongOrNull() ?: 0L,
            title = params["t"],
            number = params["n"]?.toFloatOrNull() ?: 0f,
            volume = 0,
            url = url,
            scanlator = null,
            uploadDate = 0L,
            branch = null,
            source = parser.source,
        )
        val pages = runBlocking { parser.getPages(chapter) }
        val array = JSONArray(pages.map { it.toJson() })
        sendJson(exchange, JSONObject().put("pages", array).put("count", pages.size))
    }

    private fun handleResolve(exchange: HttpExchange) {
        val link = exchange.query()["url"] ?: throw ApiException(400, "Missing url")
        val manga = runBlocking { loader.resolveLink(link) } ?: throw ApiException(404, "No source knows this link")
        sendJson(exchange, JSONObject().put("manga", manga.toJson()))
    }

    private fun handleImage(exchange: HttpExchange) {
        ImageStats.requested.incrementAndGet()
        try {
            serveImage(exchange)
            ImageStats.served.incrementAndGet()
        } catch (error: ApiException) {
            ImageStats.failed.incrementAndGet()
            ImageStats.note(error.message)
            throw error
        }
    }

    private fun serveImage(exchange: HttpExchange) {
        val params = exchange.query()
        val sourceName = params["s"] ?: throw ApiException(400, "Missing source")
        val parser = parsers.parser(sourceName)
        val pageUrl = params["p"]
        val rawUrl = params["u"]
        val target = when {
            pageUrl != null -> {
                val page = MangaPage(id = 0L, url = pageUrl, preview = null, source = parser.source)
                runBlocking { parser.getPageUrl(page) }
            }
            rawUrl != null -> rawUrl
            else -> throw ApiException(400, "Missing image url")
        }
        if (target.isBlank()) throw ApiException(502, "Source returned an empty image link")

        val request = Request.Builder()
            .url(target)
            .tag(MangaSource::class.java, parser.source)
            .header("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
            .build()

        val response = try {
            loader.httpClient.newCall(request).execute()
        } catch (e: Exception) {
            throw ApiException(502, "Image request failed: ${e.message}")
        }
        response.use {
            if (!it.isSuccessful) {
                throw ApiException(502, "Image request failed: HTTP ${it.code} ${it.message}")
            }
            val body = it.body
            val bytes = body.bytes()
            val type = body.contentType()?.toString() ?: "application/octet-stream"
            exchange.responseHeaders.add("Content-Type", type)
            exchange.responseHeaders.add("Cache-Control", "public, max-age=86400")
            exchange.responseHeaders.add("X-Content-Type-Options", "nosniff")
            exchange.sendResponseHeaders(200, if (bytes.isEmpty()) -1 else bytes.size.toLong())
            if (bytes.isNotEmpty()) exchange.responseBody.use { out -> out.write(bytes) }
        }
    }

    private fun serveStatic(exchange: HttpExchange, path: String) {
        val relative = if (path == "/" || path.isEmpty()) "index.html" else path.removePrefix("/")
        val file = File(webDir, relative).canonicalFile
        val root = webDir.canonicalFile
        if (!file.path.startsWith(root.path)) throw ApiException(403, "Forbidden")
        val target = if (file.isFile) file else File(root, "index.html")
        if (!target.isFile) throw ApiException(404, "Not found: $path")
        val bytes = target.readBytes()
        exchange.responseHeaders.add("Content-Type", mimeType(target.name))
        exchange.responseHeaders.add("Cache-Control", "no-cache")
        exchange.sendResponseHeaders(200, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }

    private fun enabledSourceNames(): Set<String>? {
        val file = File(dataDir, "enabled-sources.json")
        if (!file.isFile) return null
        return runCatching {
            val names = JSONObject(file.readText(Charsets.UTF_8)).getJSONArray("names")
            (0 until names.length()).mapTo(LinkedHashSet()) { names.getString(it) }
        }.getOrNull()?.takeIf { it.isNotEmpty() }
    }

    private fun sendJson(exchange: HttpExchange, json: JSONObject, status: Int = 200) {
        val bytes = json.toString().toByteArray(StandardCharsets.UTF_8)
        exchange.responseHeaders.add("Content-Type", "application/json; charset=utf-8")
        exchange.responseHeaders.add("Cache-Control", "no-store")
        exchange.sendResponseHeaders(status, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }

    private fun HttpExchange.query(): Map<String, String> {
        val raw = requestURI.rawQuery ?: return emptyMap()
        val result = LinkedHashMap<String, String>()
        for (pair in raw.split('&')) {
            if (pair.isEmpty()) continue
            val index = pair.indexOf('=')
            if (index < 0) continue
            val key = decode(pair.substring(0, index))
            val value = decode(pair.substring(index + 1))
            result[key] = value
        }
        return result
    }

    private fun decode(value: String): String = runCatching {
        URLDecoder.decode(value, StandardCharsets.UTF_8)
    }.getOrDefault(value)

    private fun mimeType(name: String): String = when (name.substringAfterLast('.', "").lowercase(Locale.ROOT)) {
        "html" -> "text/html; charset=utf-8"
        "js" -> "text/javascript; charset=utf-8"
        "css" -> "text/css; charset=utf-8"
        "json" -> "application/json; charset=utf-8"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "ico" -> "image/x-icon"
        "woff2" -> "font/woff2"
        else -> "application/octet-stream"
    }
}
