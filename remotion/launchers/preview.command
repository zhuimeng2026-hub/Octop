#!/bin/sh
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer with npm is required. Install it from https://nodejs.org/"
  exit 1
fi
OCTOP_PROJECT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd) || exit 1
cd "$(dirname "$0")/renderer" || exit 1
node launch.mjs --project "$OCTOP_PROJECT_DIR" "$@"
