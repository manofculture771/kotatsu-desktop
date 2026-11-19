# Kotatsu Desktop (Windows, no emulator)

Kotatsu-Redo is an Android app. Its **source engine** — `kotatsu-parsers-redo`, 1,000+ parsers, pure Kotlin/JVM — is not. This project runs that engine on the laptop and puts a reader UI in front of it.

```
Kotatsu-Redo (Android UI, Kotlin/Compose)   ← not used
kotatsu-parsers-redo (sources, JVM library) ← compiled and reused as-is
        │
        ▼
kotatsu-desktop: JDK HttpServer + web UI in Brave
```

## Run

Double-click **Kotatsu Desktop** on the Desktop (or `Start Kotatsu.bat`). It starts the local server and opens a standalone Brave app window — no tabs, no address bar. `Stop Kotatsu.bat` closes it.

Nothing installs, nothing needs admin, no emulator, no Android runtime. A second double-click just brings the window back instead of starting another copy.

## What works

- Source catalogue (all parsers the Android app ships, including broken/NSFW flagged ones)
- Browse / search / sort / genre filters per source
- Manga details, chapter list, reading progress
- Reader: vertical webtoon strip and single-page mode, width control, keyboard navigation
- Library and history in the browser profile (localStorage)
- Images proxied through the same parser, so referer, cookies, user-agent and image descrambling behave as in the app

## Layout

```
server/           Kotlin app: MangaLoaderContext implementation + HTTP API
  src/main/kotlin/kotatsu/Loader.kt   context, cookies, bitmap, JS (Node)
  src/main/kotlin/kotatsu/Main.kt     routes, image proxy, static files
  src/main/kotlin/kotatsu/Json.kt     model → JSON
  libs/kotatsu-parsers.jar            built from Kotatsu-Redo/kotatsu-parsers-redo
web/              index.html, style.css, app.js (no build step)
dist/             runnable jar + web assets
tools/            portable Temurin JDK 17 (the build toolchain)
data/             runtime cache (JS scratch)
```

## Rebuild

```bash
# 1. parsers (once, or after pulling the parser repo)
cd kotatsu-parsers-redo
JAVA_HOME=... ./gradlew jar
cp build/libs/kotatsu-parsers-1.0.jar <this>/server/libs/kotatsu-parsers.jar

# 2. desktop app
cd server
JAVA_HOME=... ./gradlew fatJar
mkdir -p ../dist && cp build/libs/kotatsu-desktop.jar ../dist/
rm -rf ../dist/web && cp -r ../web ../dist/web
```

## Sources

Only sources that passed a live test are listed: catalogue → first title → chapters → first page → first image. The list lives in `data/enabled-sources.json` (149 of 500 English/Arabic/multi-language sources at the last run).

Re-test and regenerate:

```bash
python3 scripts/test_sources.py    # catalogue pass, appends data/source-tests.jsonl
python3 scripts/retry_failed.py    # second try for TLS/slow sources
python3 scripts/deep_test.py       # details, chapters, pages, image
python3 scripts/make_whitelist.py  # writes data/enabled-sources.json
```

Delete that file to show every parser again.

## Notes

- Parser sources are community-maintained scrapers; a source can be down, geo-blocked or Cloudflare-protected at any moment. That is true of the Android app too.
- `MangaLoaderContext.evaluateJs` runs scripts in the Node.js already installed on the machine; parsers that rely on DOM APIs may still fail.
- The parsers are GPL-3.0, from https://github.com/Kotatsu-Redo/kotatsu-parsers-redo. This wrapper is a personal desktop build of the same engine.
- No accounts, no telemetry, no external service: everything goes from this machine to the source site directly.
