#!/usr/bin/env bash
set -euo pipefail

SOURCE="$1"
OUTPUT="$2"
test -s "$SOURCE/build/darwin/create-universal-app.ts"
test -s "$SOURCE/build/darwin/verify-macho.ts"
test -s "$SOURCE/build/node_modules/vscode-universal-bundler/package.json"
test -s "$SOURCE/build/node_modules/minimatch/package.json"
tar -czf "$OUTPUT" -C "$SOURCE" build product.json package.json
