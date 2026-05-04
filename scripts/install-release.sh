#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-somus/resume-extract}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${VERSION:-latest}"

uname_s="$(uname -s)"
uname_m="$(uname -m)"

case "$uname_s" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *)
    echo "Unsupported OS: $uname_s" >&2
    exit 1
    ;;
esac

case "$uname_m" in
  x86_64|amd64) arch="x64" ;;
  arm64|aarch64)
    if [ "$os" = "darwin" ] || [ "$os" = "linux" ]; then
      arch="arm64"
    else
      echo "Unsupported architecture: $uname_m" >&2
      exit 1
    fi
    ;;
  *)
    echo "Unsupported architecture: $uname_m" >&2
    exit 1
    ;;
esac

asset="resume-extract-${os}-${arch}"
if [ "$os" = "windows" ]; then
  asset="${asset}.exe"
fi

if [ "$VERSION" = "latest" ]; then
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

mkdir -p "$INSTALL_DIR"
target="${INSTALL_DIR}/resume-extract"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

echo "Downloading ${url}"
curl -fL "$url" -o "$tmp"
chmod +x "$tmp"
mv "$tmp" "$target"

echo "Installed to ${target}"
echo "Ensure ${INSTALL_DIR} is on your PATH"
