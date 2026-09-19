#!/bin/bash

set -euo pipefail

# Install the legacy standalone Bash version of fruitmail.

echo "Installing fruitmail..."

if ! command -v curl >/dev/null 2>&1; then
    echo "Error: curl is required." >&2
    exit 1
fi

TARGET_DIR="$HOME/.local/bin"
TARGET_FILE="$TARGET_DIR/fruitmail"

# Create target directory if it doesn't exist
if [ ! -d "$TARGET_DIR" ]; then
    echo "Creating $TARGET_DIR..."
    mkdir -p "$TARGET_DIR"
fi

# Download beside the target so a failed transfer cannot damage an existing install.
TEMP_FILE=$(mktemp "$TARGET_DIR/.fruitmail.XXXXXX")
cleanup() {
    rm -f "$TEMP_FILE"
}
trap cleanup EXIT INT TERM

if curl -fsSL https://raw.githubusercontent.com/gumadeiras/fruitmail-cli/main/fruitmail -o "$TEMP_FILE"; then
    chmod +x "$TEMP_FILE"
    mv "$TEMP_FILE" "$TARGET_FILE"
    trap - EXIT INT TERM
    echo "✅ Successfully installed fruitmail to $TARGET_FILE"
    
    # Check if PATH contains ~/.local/bin
    if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
        echo "⚠️  NOTE: $HOME/.local/bin is not in your PATH."
        echo "    Add it by running: echo 'export PATH=\$HOME/.local/bin:\$PATH' >> ~/.zshrc"
    fi
    
    echo "Run 'fruitmail --help' to get started."
else
    echo "❌ Download failed."
    exit 1
fi
