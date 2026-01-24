# Apple Mail Search (Fast & Safe)

Fast SQLite-based search for Apple Mail.app with full body content support.

![macOS](https://img.shields.io/badge/macOS-10.15+-black?style=flat-square&logo=apple)
![Shell](https://img.shields.io/badge/Shell-Bash-black?style=flat-square&logo=gnu-bash)

## ✨ Features

- **⚡ Fast:** ~50ms queries via SQLite (vs 8+ minutes with pure AppleScript)
- **🔒 Safe:** Copies database to temp file before querying — won't corrupt if Mail.app is running
- **📧 Body content:** Read full email bodies via AppleScript (fast for a few emails)
- **🔍 Full search:** Search by subject, sender, recipient, date range, attachments, and more

## 📦 Installation

**One-liner:**
```bash
curl -sSL https://raw.githubusercontent.com/gumadeiras/apple-mail-search-cli/master/install.sh | bash
```

## 🚀 Usage

```bash
# Search by subject
mail-search subject "invoice"

# Search by sender
mail-search sender "@amazon.com"

# Search by date range
mail-search date-range 2025-01-01 2025-01-31

# List unread emails
mail-search unread

# Find emails with PDFs
mail-search attachment-type pdf

# Read full email body
mail-search body 94695

# Open in Mail.app
mail-search open 94695

# Database stats
mail-search stats
```

## 📊 Performance

| Method | Time for 130k emails |
|--------|---------------------|
| AppleScript (full iteration) | 8+ minutes |
| SQLite (this tool) | **~50ms** |

## 🏗️ Technical Details

- **Database:** `~/Library/Mail/V{9,10,11}/MailData/Envelope Index`
- **Query method:** SQLite (metadata) + AppleScript (body content)
- **Safety:** Temp file copy prevents DB corruption

## 🔗 ClawdHub

Available as a skill on [ClawdHub](https://clawdhub.com) for [Clawdbot](https://github.com/clawdbot/clawdbot) users. Install with:

```bash
clawdhub install apple-mail-search-safe
```

## 📝 License

MIT
