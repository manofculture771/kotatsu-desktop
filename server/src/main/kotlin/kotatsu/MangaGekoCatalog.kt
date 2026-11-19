package kotatsu

import okhttp3.Request
import org.json.JSONObject
import org.jsoup.Jsoup
import org.koitharu.kotatsu.parsers.MangaParser
import org.koitharu.kotatsu.parsers.model.Manga
import org.koitharu.kotatsu.parsers.model.MangaSource

/**
 * MangaGeko renders its catalogue in the browser from /browse-comics/data/, so the stock parser's
 * WebView script cannot run here. The endpoint returns JSON whose results_html holds the same cards.
 */
object MangaGekoCatalog {

    fun list(loader: DesktopLoader, parser: MangaParser, page: Int, order: String, genres: Set<String>): List<Manga> {
        val params = buildList {
            add("page=$page")
            add(
                "filter=" + when (order) {
                    "POPULARITY" -> "views"
                    "NEWEST" -> "New"
                    else -> "Updated"
                },
            )
            genres.firstOrNull()?.let { add("include_genres=${encode(it)}") }
        }
        val base = "https://${parser.domain}"
        val url = "$base/browse-comics/data/?${params.joinToString("&")}"
        val request = Request.Builder()
            .url(url)
            .tag(MangaSource::class.java, parser.source)
            .header("Accept", "application/json")
            .header("Referer", "$base/browse-comics/")
            .build()
        val body = loader.httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("MangaGeko catalogue: HTTP ${response.code}")
            response.body.string()
        }
        val html = JSONObject(body).optString("results_html")
        val document = Jsoup.parse(html, "$base/")
        return document.select("article.comic-card").mapNotNull { card ->
            val link = card.selectFirst("h3.comic-card__title a") ?: return@mapNotNull null
            val href = link.attr("href").ifBlank { return@mapNotNull null }
            val cover = card.selectFirst("div.comic-card__cover img")?.attr("src")?.takeIf { it.isNotBlank() }
            Manga(
                id = href.hashCode().toLong(),
                title = link.text().trim(),
                altTitles = emptySet(),
                url = href,
                publicUrl = if (href.startsWith("http")) href else "$base$href",
                rating = -1f,
                contentRating = null,
                coverUrl = cover,
                tags = emptySet(),
                state = null,
                authors = emptySet(),
                source = parser.source,
            )
        }
    }
}
