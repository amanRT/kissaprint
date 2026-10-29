#!/bin/sh
# Build command for Vercel (or any Linux CI): install the one build dependency and render dist/.
# Uses a throwaway virtualenv so it works whatever pip policy the build image has.
set -eu

PY="$(command -v python3.12 || command -v python3 || command -v python)"
echo "Building with $("$PY" --version 2>&1)"

if "$PY" -m venv .buildenv >/dev/null 2>&1; then
  PY=".buildenv/bin/python"
fi
"$PY" -m pip install --quiet --disable-pip-version-check -r requirements.txt
"$PY" tools/build.py
