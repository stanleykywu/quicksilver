#!/bin/bash
set -e

usage() {
    echo "Usage: $0 <core|web|python|all>"
}

if [ "$#" -ne 1 ]; then
    usage
    exit 1
fi

TARGET="$1"

case "$TARGET" in
    core)
        echo "Building core crate..."
        cargo build --release
        ;;
    web)
        if ! command -v wasm-pack &> /dev/null
        then
            echo "wasm-pack not found, installing..."
            cargo install wasm-pack
        else
            echo "wasm-pack found, skipping installation"
        fi
        echo "Building web package..."
        wasm-pack build --release --no-typescript --target web --features web
        ;;
    python)
        echo "Building Python bindings..."
        uv sync --reinstall
        ;;
    all)
        echo "Building core crate..."
        cargo build --release 
        if ! command -v wasm-pack &> /dev/null
        then
            echo "wasm-pack not found, installing..."
            cargo install wasm-pack
        else
            echo "wasm-pack found, skipping installation"
        fi
        echo "Building web package..."
        wasm-pack build --release --no-typescript --target web --features web
        echo "Building Python bindings..."
        uv sync --reinstall
        ;;
    *)
        echo "Invalid build target: $TARGET"
        usage
        exit 1
        ;;
esac
