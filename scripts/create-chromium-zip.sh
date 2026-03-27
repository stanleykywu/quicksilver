#!/bin/bash
set -e

EXT_NAME="quicksilver-chromium-extension"
OUT_ZIP="$EXT_NAME.zip"

zip -r "$OUT_ZIP" \
  chromium/manifest.json \
  chromium/*.js \
  chromium/*.html \
  chromium/pkg \
  chromium/LICENSE.md \
  chromium/assets/icon*.png