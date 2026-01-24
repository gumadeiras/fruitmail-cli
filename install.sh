#!/usr/bin/env bash
set -e

REPO_URL="https://github.com/gumadeiras/apple-mail-search-cli.git"
INSTALL_DIR="${HOME}/.local/bin"
BIN_NAME="mail-search"

echo "📦 Installing apple-mail-search-cli..."

# Create bin dir
mkdir -p "${INSTALL_DIR}"

# Clone repo
TEMP_DIR=$(mktemp -d)
git clone --quiet --depth 1 "${REPO_URL}" "${TEMP_DIR}/apple-mail-search-cli"

# Install script (Copy instead of Link)
rm -f "${INSTALL_DIR}/${BIN_NAME}"
cp "${TEMP_DIR}/apple-mail-search-cli/mail-search" "${INSTALL_DIR}/${BIN_NAME}"
chmod +x "${INSTALL_DIR}/${BIN_NAME}"

# Cleanup
rm -rf "${TEMP_DIR}"

# PATH check - add to both bashrc and zshrc if they exist
if [[ ":${PATH}:" != *":${INSTALL_DIR}:"* ]]; then
    echo "⚠️  Adding ${INSTALL_DIR} to PATH..."
    for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
        if [ -f "$rc" ]; then
            if ! grep -q "${INSTALL_DIR}" "$rc" 2>/dev/null; then
                echo "export PATH=\"${INSTALL_DIR}:\$PATH\"" >> "$rc"
            fi
        fi
    done
fi

echo "✅ Installed! Run: mail-search"
