---
name: apple-mail-search
description: "Search and inspect Apple Mail on macOS, read message content and state, open messages, count flags, or safely change a message flag."
homepage: https://clawdhub.com/gumadeiras/apple-mail-search-safe
repository: https://github.com/gumadeiras/fruitmail-cli
metadata: {"clawdbot":{"emoji":"📧","requires":{"bins":["fruitmail"]},"install":[{"id":"node","kind":"node","package":"fruitmail","bins":["fruitmail"],"label":"Install fruitmail CLI (npm)"}]}}
---

# Fruitmail (Fast & Safe)

Fast SQLite-based search for Apple Mail.app with full body content support.

## Installation

Requires Node.js 22.13 or newer for npm installs.

```bash
npm install -g fruitmail
```

## Usage

```bash
# Complex search
fruitmail search --subject "invoice" --days 30 --unread

# Search by sender
fruitmail sender "@amazon.com"

# List unread emails
fruitmail unread

# Read full email body (supports --json)
fruitmail body 94695

# Open in Mail.app
fruitmail open 94695

# Inspect one exact message through Mail.app
fruitmail inspect 94695 --json

# Read local messages without Mail.app
fruitmail read 94695 94696 --max-body-chars 12000 --json

# Read message state without content or Mail.app
fruitmail status 94695 94696 --json

# Change one flag with identity and state preconditions
fruitmail set-flag 94695 purple \
  --expect-message-id id@example.com \
  --expect-flag-index -1 \
  --json

# Count colored flags without returning message content
fruitmail flag-counts --inbox --json

# Database stats
fruitmail stats
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Complex search with filters |
| `sender <query>` | Search by sender email |
| `unread` | List unread emails |
| `body <id>` | Read full email body (AppleScript) |
| `open <id>` | Open email in Mail.app |
| `inspect <id>` | Return exact message details as JSON |
| `read <id...>` | Read local messages without Mail.app |
| `status <id...>` | Return index-only message state as JSON |
| `set-flag <id> <color>` | Set or clear one message flag |
| `flag-counts` | Count colored flags without message content |
| `stats` | Database statistics |

## Search Options

```
--subject <text>   Search subject lines
--days <n>         Last N days
--unread           Only unread emails
--limit <n>        Max results (default: 20)
--offset <n>       Skip first N results (default: 0)
--json             Output as JSON
--copy             Copy DB before query (safest mode)
```

## Examples

```bash
# Find bank statements from last month
fruitmail search --subject "statement" --days 30

# Get unread emails as JSON
fruitmail unread --json | jq '.[] | .subject'

# Find emails from Amazon
fruitmail sender "@amazon.com" --limit 50

# Page through search results
fruitmail search --subject "invoice" --limit 20 --offset 20
```

## Performance

| Method | Time for 130k emails |
|--------|---------------------|
| AppleScript (full iteration) | 8+ minutes |
| SQLite (this tool) | **~50ms** |

## Technical Details

- **Database:** `~/Library/Mail/V{9,10,11}/MailData/Envelope Index`
- **Query method:** SQLite + local `.emlx` files + AppleScript for Mail.app actions
- **Database safety:** SQLite access is read-only by default; optional `--copy` mode available

## Notes

- **macOS only** — queries Apple Mail.app's local database
- Search, status, local reads, and counts use read-only database access
- `set-flag` changes only the selected Mail flag; it does not move, delete, or mark a message read
- Fruitmail does not compose or send mail
- **To send emails:** Use the `himalaya` skill (IMAP/SMTP)

## Source

https://github.com/gumadeiras/fruitmail-cli
