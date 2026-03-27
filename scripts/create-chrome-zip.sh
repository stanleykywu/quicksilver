#!/bin/bash
set -e

EXT_NAME="quicksilver"
OUT_ZIP="$EXT_NAME.zip"

zip -r "$OUT_ZIP" \
  manifest.json \
  *.js \
  *.html \
  pkg \
  LICENSE.md \
  assets/icon*.png