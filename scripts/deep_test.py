#!/usr/bin/env python3
"""For sources whose catalogue answered, open the first title, its first chapter and first image."""
import json
import os
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(__file__))
from test_sources import BASE, OUT, fetch  # noqa: E402

DEEP = os.path.join(os.path.dirname(__file__), "..", "data", "source-deep.jsonl")
WORKERS = 8


def latest_rows(path):
    latest = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                try:
                    row = json.loads(line)
                    latest[row["name"]] = row
                except Exception:
                    pass
    return latest


def deep(source):
    name = source["name"]
    started = time.time()
    q = urllib.parse.quote(name)
    status, body, seconds, error = fetch(f"/api/sources/{q}/list?page=1")
    items = []
    if status == 200:
        try:
            items = json.loads(body).get("items") or []
        except Exception:
            pass
    if not items:
        status, body, seconds2, error = fetch(f"/api/sources/{q}/list?q=one%20piece")
        seconds += seconds2
        if status == 200:
            try:
                items = json.loads(body).get("items") or []
            except Exception:
                pass
    if not items:
        return {"name": name, "ok": False, "stage": "catalogue", "seconds": round(time.time() - started, 2),
                "error": error or "no items"}

    manga = items[0]
    params = urllib.parse.urlencode({"u": manga["url"], "id": manga.get("id", 0), "t": manga.get("title", "")})
    status, body, seconds2, error = fetch(f"/api/sources/{q}/manga?{params}")
    seconds += seconds2
    if status != 200:
        return {"name": name, "ok": False, "stage": "details", "seconds": round(time.time() - started, 2),
                "error": error or f"http {status}"}
    detail = json.loads(body).get("manga") or {}
    chapters = detail.get("chapters") or []
    if not chapters:
        return {"name": name, "ok": False, "stage": "chapters", "seconds": round(time.time() - started, 2),
                "error": "no chapters"}

    chapter = chapters[0]
    params = urllib.parse.urlencode({
        "u": chapter["url"], "id": chapter.get("id", 0), "t": chapter.get("title") or "",
        "n": chapter.get("number") or 0,
    })
    status, body, seconds2, error = fetch(f"/api/sources/{q}/pages?{params}")
    seconds += seconds2
    if status != 200:
        return {"name": name, "ok": False, "stage": "pages", "seconds": round(time.time() - started, 2),
                "error": error or f"http {status}"}
    pages = json.loads(body).get("pages") or []
    if not pages:
        return {"name": name, "ok": False, "stage": "pages", "seconds": round(time.time() - started, 2),
                "error": "no pages"}

    image_ok = False
    image_size = 0
    image_error = None
    params = urllib.parse.urlencode({"s": name, "p": pages[0]["url"]})
    status, body, seconds2, error = fetch(f"/api/img?{params}", timeout=25)
    seconds += seconds2
    if status == 200 and len(body) > 1000:
        image_ok = True
        image_size = len(body)
    else:
        image_error = error or f"http {status} / {len(body)} bytes"

    return {
        "name": name,
        "ok": image_ok,
        "stage": "image" if not image_ok else "done",
        "chapters": len(chapters),
        "pages": len(pages),
        "image_bytes": image_size,
        "seconds": round(time.time() - started, 2),
        "error": image_error,
        "title": manga.get("title", ""),
    }


def main():
    rows = latest_rows(OUT)
    targets = [row for row in rows.values() if row["ok"]]
    print(f"deep-testing {len(targets)} catalogue-ok sources", flush=True)
    ok = 0
    with open(DEEP, "a", encoding="utf-8") as handle:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(deep, row): row for row in targets}
            for index, future in enumerate(as_completed(futures), 1):
                result = future.result()
                handle.write(json.dumps(result, ensure_ascii=False) + "\n")
                handle.flush()
                if result["ok"]:
                    ok += 1
                state = "OK  " if result["ok"] else "FAIL"
                extra = (
                    f'{result.get("chapters", 0)}ch {result.get("pages", 0)}p '
                    f'{result.get("image_bytes", 0)}B'
                    if result["ok"] else f'{result["stage"]}: {result.get("error") or ""}'
                )
                print(f'[{index}/{len(targets)}] {state} {result["name"]:<26} {extra[:90]}', flush=True)
    print(f"deep finished ok={ok}/{len(targets)}", flush=True)


if __name__ == "__main__":
    main()
