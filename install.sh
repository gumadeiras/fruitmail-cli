#!/bin/bash

# Simple install script for fruitmail (Bash version)

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

# Download script
if curl -sSL https://raw.githubusercontent.com/gumadeiras/apple-mail-search-cli/master/fruitmail -o "$TARGET_FILE"; then
    chmod +x "$TARGET_FILE"
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
