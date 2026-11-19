#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARSERS_DIR="${1:-/tmp/kotatsu/kotatsu-parsers-redo}"
JAVA_HOME="${JAVA_HOME:-$(cd "$ROOT/tools/jdk-17.0.21+9" && pwd -W 2>/dev/null || echo "$ROOT/tools/jdk-17.0.21+9")}"
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

echo "== parsers: $PARSERS_DIR"
if [ ! -f "$PARSERS_DIR/build/libs/kotatsu-parsers-1.0.jar" ]; then
  (cd "$PARSERS_DIR" && ./gradlew jar --console=plain)
fi
cp "$PARSERS_DIR/build/libs/kotatsu-parsers-1.0.jar" "$ROOT/server/libs/kotatsu-parsers.jar"

echo "== desktop app"
(cd "$ROOT/server" && ./gradlew fatJar --console=plain)

echo "== dist"
mkdir -p "$ROOT/dist"
cp "$ROOT/server/build/libs/kotatsu-desktop.jar" "$ROOT/dist/kotatsu-desktop.jar"
rm -rf "$ROOT/dist/web"
cp -r "$ROOT/web" "$ROOT/dist/web"
ls -lh "$ROOT/dist"
