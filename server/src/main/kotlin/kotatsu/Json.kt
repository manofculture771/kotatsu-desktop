package kotatsu

import org.json.JSONArray
import org.json.JSONObject
import org.koitharu.kotatsu.parsers.model.ContentRating
import org.koitharu.kotatsu.parsers.model.Manga
import org.koitharu.kotatsu.parsers.model.MangaChapter
import org.koitharu.kotatsu.parsers.model.MangaListFilterCapabilities
import org.koitharu.kotatsu.parsers.model.MangaListFilterOptions
import org.koitharu.kotatsu.parsers.model.MangaPage
import org.koitharu.kotatsu.parsers.model.MangaSource
import org.koitharu.kotatsu.parsers.model.MangaTag
import org.koitharu.kotatsu.parsers.model.ParserMangaSource
import org.koitharu.kotatsu.parsers.model.SortOrder
import java.net.URLEncoder
import java.util.Locale

fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")

fun proxyImageUrl(source: String, url: String): String = "/api/img?s=$source&u=${encode(url)}"

fun languageName(tag: String): String = when (tag.lowercase(Locale.ROOT)) {
    "", "all", "multi" -> "Multi-language"
    else -> runCatching {
        Locale.forLanguageTag(tag).getDisplayLanguage(Locale.ENGLISH)
    }.getOrNull()?.takeIf { it.isNotBlank() && it != "und" } ?: tag.uppercase(Locale.ROOT)
}

fun ParserMangaSource.toJson(): JSONObject = JSONObject().apply {
    put("name", name)
    put("title", title)
    put("locale", locale)
    put("language", languageName(locale))
    put("contentType", contentType.name)
    put("broken", isBroken)
    put("nsfw", contentType == org.koitharu.kotatsu.parsers.model.ContentType.HENTAI)
}

fun MangaTag.toJson(): JSONObject = JSONObject().apply {
    put("title", title)
    put("key", key)
}

fun MangaChapter.toJson(sourceName: String): JSONObject = JSONObject().apply {
    put("id", id)
    put("title", title ?: JSONObject.NULL)
    put("number", number.toDouble())
    put("volume", volume)
    put("url", url)
    put("scanlator", scanlator ?: JSONObject.NULL)
    put("uploadDate", uploadDate)
    put("branch", branch ?: JSONObject.NULL)
    put("source", sourceName)
}

fun MangaPage.toJson(): JSONObject = JSONObject().apply {
    put("url", url)
    put("preview", preview ?: JSONObject.NULL)
}

fun Manga.toJson(): JSONObject = JSONObject().apply {
    val sourceName = source.name
    put("id", id)
    put("title", title)
    put("altTitles", JSONArray(altTitles.toList()))
    put("url", url)
    put("publicUrl", publicUrl)
    put("rating", rating.toDouble())
    put("contentRating", contentRating?.name ?: JSONObject.NULL)
    put("coverUrl", coverUrl ?: JSONObject.NULL)
    put("cover", coverUrl?.let { proxyImageUrl(sourceName, it) } ?: JSONObject.NULL)
    put("largeCoverUrl", largeCoverUrl ?: JSONObject.NULL)
    put("largeCover", largeCoverUrl?.let { proxyImageUrl(sourceName, it) } ?: JSONObject.NULL)
    put("tags", JSONArray(tags.map { it.toJson() }))
    put("state", state?.name ?: JSONObject.NULL)
    put("authors", JSONArray(authors.toList()))
    put("description", description ?: JSONObject.NULL)
    put("source", sourceName)
    put("nsfw", contentRating == ContentRating.ADULT)
    chapters?.let { list ->
        put("chapters", JSONArray(list.map { it.toJson(sourceName) }))
    }
}

fun MangaListFilterCapabilities.toJson(): JSONObject = JSONObject().apply {
    put("multipleTags", isMultipleTagsSupported)
    put("tagsExclusion", isTagsExclusionSupported)
    put("search", isSearchSupported)
    put("searchWithFilters", isSearchWithFiltersSupported)
    put("year", isYearSupported)
    put("yearRange", isYearRangeSupported)
    put("originalLocale", isOriginalLocaleSupported)
    put("author", isAuthorSearchSupported)
}

fun MangaListFilterOptions.toJson(): JSONObject = JSONObject().apply {
    put("tags", JSONArray(availableTags.sortedBy { it.title.lowercase(Locale.ROOT) }.map { it.toJson() }))
    put("states", JSONArray(availableStates.map { it.name }))
    put("contentRatings", JSONArray(availableContentRating.map { it.name }))
    put("contentTypes", JSONArray(availableContentTypes.map { it.name }))
    put("demographics", JSONArray(availableDemographics.map { it.name }))
    put("locales", JSONArray(availableLocales.map { it.toLanguageTag() }))
}

fun sortOrdersJson(orders: Collection<SortOrder>): JSONArray = JSONArray(orders.map { it.name })

fun sourceKey(source: MangaSource): String = source.name
