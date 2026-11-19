#!/usr/bin/env python3
"""Probe every English / Arabic / multi-language source once and record what answers.

Writes one JSON line per source to data/source-tests.jsonl so a long run survives a stop.
A source passes if its catalogue returns items, or (for search-only sources) a common query does.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "http://127.0.0.1:8787"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "source-tests.jsonl")
KEEP_LOCALES = {"en", "ar", ""}
TIMEOUT = 18
WORKERS = 10
QUERY = "one piece"


def fetch(path, timeout=TIMEOUT):
    started = time.time()
    try:
        with urllib.request.urlopen(BASE + path, timeout=timeout) as response:
            body = response.read()
            return response.status, body, time.time() - started, None
    except urllib.error.HTTPError as error:
        try:
            body = error.read()
        except Exception:
            body = b""
        return error.code, body, time.time() - started, body[:160].decode("utf-8", "replace")
    except Exception as error:  # timeouts, resets
        return 0, b"", time.time() - started, str(error)[:160]


def test(source):
    name = source["name"]
    status, body, seconds, error = fetch(f"/api/sources/{urllib.parse.quote(name)}/list?page=1")
    items = 0
    if status == 200:
        try:
            items = len(json.loads(body).get("items") or [])
        except Exception:
            items = 0
    mode = "browse"
    if items == 0:
        mode = "search"
        status, body, seconds2, error = fetch(
            f"/api/sources/{urllib.parse.quote(name)}/list?q={urllib.parse.quote(QUERY)}"
        )
        seconds += seconds2
        if status == 200:
            try:
                items = len(json.loads(body).get("items") or [])
            except Exception:
                items = 0
    return {
        "name": name,
        "title": source["title"],
        "locale": source["locale"],
        "ok": items > 0,
        "items": items,
        "mode": mode,
        "seconds": round(seconds, 2),
        "http": status,
        "error": error,
        "tested": int(time.time()),
    }


def main():
    with urllib.request.urlopen(BASE + "/api/sources?all=1", timeout=20) as response:
        sources = json.load(response)["sources"]
    targets = [s for s in sources if s["locale"].lower() in KEEP_LOCALES]
    done = set()
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as handle:
            for line in handle:
                try:
                    done.add(json.loads(line)["name"])
                except Exception:
                    pass
    todo = [s for s in targets if s["name"] not in done]
    print(f"targets={len(targets)} done={len(done)} todo={len(todo)}", flush=True)

    ok = 0
    failed = 0
    with open(OUT, "a", encoding="utf-8") as handle:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(test, s): s for s in todo}
            for index, future in enumerate(as_completed(futures), 1):
                result = future.result()
                handle.write(json.dumps(result, ensure_ascii=False) + "\n")
                handle.flush()
                if result["ok"]:
                    ok += 1
                else:
                    failed += 1
                state = "OK " if result["ok"] else "FAIL"
                extra = f'{result["items"]} items' if result["ok"] else (result["error"] or f'http {result["http"]}')
                print(
                    f'[{index}/{len(todo)}] {state} {result["name"]:<28} {result["locale"]:<3} '
                    f'{result["seconds"]:>5.1f}s {extra[:90]}',
                    flush=True,
                )
    print(f"finished ok={ok} failed={failed} total={len(targets)}", flush=True)


if __name__ == "__main__":
    main()
