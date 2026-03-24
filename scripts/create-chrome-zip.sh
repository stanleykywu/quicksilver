#!/bin/bash
set -e

EXT_NAME="quicksilver"
OUT_ZIP="$EXT_NAME.zip"

zip -r "$OUT_ZIP" \
  manifest.json \
  background.js \
  offscreen.js \
  offscreen.html \
  popup.js \
  popup.html \
  processor.js \
  pkg \
  LICENSE.md \
  assets/icon*.png