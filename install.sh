#!/bin/sh
# Install sofa: curl -fsSL https://raw.githubusercontent.com/jwirzz/sofa/main/install.sh | sh
# Env: SOFA_VERSION (default: latest), SOFA_INSTALL (default: $HOME/.sofa/bin)
set -eu

REPO="jwirzz/sofa"
INSTALL_DIR="${SOFA_INSTALL:-$HOME/.sofa/bin}"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) echo "sofa: unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x86_64 ;;
  arm64 | aarch64) arch=aarch64 ;;
  *) echo "sofa: unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

asset="sofa-$os-$arch"
if [ -n "${SOFA_VERSION:-}" ]; then
  url="https://github.com/$REPO/releases/download/$SOFA_VERSION/$asset"
else
  url="https://github.com/$REPO/releases/latest/download/$asset"
fi

mkdir -p "$INSTALL_DIR"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

echo "Downloading $url"
curl -fSL --progress-bar "$url" -o "$tmp"
chmod +x "$tmp"
mv "$tmp" "$INSTALL_DIR/sofa"
trap - EXIT

echo "Installed sofa to $INSTALL_DIR/sofa"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo
    echo "Add sofa to your PATH:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac
