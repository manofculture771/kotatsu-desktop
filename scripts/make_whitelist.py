#!/usr/bin/env python3
"""Write data/enabled-sources.json from the deepest test result per source."""
import json
import os
import time

HERE = os.path.dirname(__file__)
TESTS = os.path.join(HERE, "..", "data", "source-tests.jsonl")
DEEP = os.path.join(HERE, "..", "data", "source-deep.jsonl")
OUT = os.path.join(HERE, "..", "data", "enabled-sources.json")


def latest(path):
    rows = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                try:
                    row = json.loads(line)
                    rows[row["name"]] = row
                except Exception:
                    pass
    return rows


def main():
    tests = latest(TESTS)
    deep = latest(DEEP)
    names = sorted(name for name, row in deep.items() if row.get("ok"))
    locale = {name: tests.get(name, {}).get("locale", "") for name in names}
    payload = {
        "generated": int(time.time()),
        "count": len(names),
        "names": names,
    }
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1)
    from collections import Counter
    print(f"enabled {len(names)} sources")
    print("locales:", dict(Counter(locale.values())))
    print("sample:", names[:12])


if __name__ == "__main__":
    main()
