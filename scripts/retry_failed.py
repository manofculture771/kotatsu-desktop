#!/usr/bin/env python3
"""Second pass over sources that failed: a handful only failed on TLS or a slow first try."""
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(__file__))
from test_sources import OUT, WORKERS, test  # noqa: E402


def main():
    latest = {}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as handle:
            for line in handle:
                try:
                    row = json.loads(line)
                except Exception:
                    continue
                latest[row["name"]] = row
    targets = [row for row in latest.values() if not row["ok"]]
    print(f"retrying {len(targets)} failed sources", flush=True)
    ok = 0
    with open(OUT, "a", encoding="utf-8") as handle:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {
                pool.submit(
                    test,
                    {"name": row["name"], "title": row["title"], "locale": row["locale"]},
                ): row
                for row in targets
            }
            for index, future in enumerate(as_completed(futures), 1):
                result = future.result()
                handle.write(json.dumps(result, ensure_ascii=False) + "\n")
                handle.flush()
                if result["ok"]:
                    ok += 1
                state = "OK " if result["ok"] else "FAIL"
                extra = f'{result["items"]} items' if result["ok"] else (result["error"] or f'http {result["http"]}')
                print(
                    f'[{index}/{len(targets)}] {state} {result["name"]:<28} {result["locale"]:<3} '
                    f'{result["seconds"]:>5.1f}s {extra[:80]}',
                    flush=True,
                )
    print(f"retry finished, recovered={ok}/{len(targets)}", flush=True)


if __name__ == "__main__":
    main()
