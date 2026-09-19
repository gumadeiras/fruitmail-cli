<img src="assets/fruitmail.jpg" alt="Fruitmail" width="280" />

# Fruitmail

Fast SQLite-based search for Apple Mail.app with full body content support.

![macOS](https://img.shields.io/badge/macOS-10.15+-black?style=flat-square&logo=apple)
![Shell](https://img.shields.io/badge/Shell-Bash-black?style=flat-square&logo=gnu-bash)

Requires Node.js 22.13 or newer for npm installs.

## ✨ Features

- **⚡ Fast:** Direct read-only SQLite access (zero-copy default)
- **🔒 Safe:** Uses read-only mode by default, or copies DB with `--copy` flag
- **📧 Body content:** Read full email bodies via AppleScript (fast for a few emails)
- **📂 Local reads:** Read many messages straight from Mail's on-disk store, without Mail.app
- **🔍 Full search:** Search by subject, sender, recipient, date range, attachments, and more
- **🎯 Exact inspection:** Read stable message metadata, reply state, headers, body, and flag state as JSON
- **🚩 Explicit flags:** Set or clear one Mail flag color without changing read, junk, or mailbox state, optionally only when the message still carries an expected Message-ID

## 📦 Installation
 
 **Using Homebrew:**
 ```bash
 brew tap gumadeiras/tap
 brew install fruitmail
 ```

 **Using npm:**
 ```bash
 npm install -g fruitmail
 ```
 
 **Using Bash (Zero dependency):**
 ```bash
 curl -sSL https://raw.githubusercontent.com/gumadeiras/fruitmail-cli/master/fruitmail | bash
 ```
 
 ## 🚀 Usage
 
 ```bash
 # Complex search
 fruitmail search --subject "invoice" --days 30 --unread

 # Page through results
 fruitmail search --subject "invoice" --limit 20 --offset 20
 
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

 # Read many local messages with bounded bodies
 fruitmail read 94695 94696 --max-body-chars 12000 --json

 # Read message state from the index without message content or Mail.app
 fruitmail status 94695 94696 --json

 # Change only the flag, with optional atomic preconditions
 fruitmail set-flag 94695 purple \
   --expect-message-id id@example.com \
   --expect-flag-index -1 \
   --json

 # Count colored flags without returning message content
 fruitmail flag-counts --inbox --json
 
 # Database stats
 fruitmail stats
 ```

`inspect` and `read` return stable JSON fields: `id`, `messageId`, `subject`,
`sender`, `recipients`, `dateReceived`, `mailbox`, `body`, `headers`,
`wasRepliedTo`, `flagIndex`, and `indexMessageId`. The index identifier is a
decimal string so its 64-bit integer value stays exact, or `null` when the
index does not provide it. `inspect` gets message content from Mail.app and
the index identifier from the Envelope Index. `read` uses the local store,
preserves request order, and returns an error object (`{ "id": <id>, "error":
"..." }`) for each unavailable message. Use `--max-body-chars` to bound each
returned body.

`status` reads no message content and does not use Mail.app. Its JSON results
preserve request order and contain `id`, `flagIndex`, `wasRepliedTo`, `inInbox`,
and `indexMessageId`, or an error object for a missing message.

`set-flag` accepts any Mail flag color or `none`. Its optional Message-ID and
flag-index preconditions are checked atomically with the change. It changes no
other message state. `flag-counts` returns total, flagged, per-color, and
unresolved counts without returning message identity or content.

## 📊 Performance

| Method | Time for 130k emails |
|--------|---------------------|
| AppleScript (full iteration) | 8+ minutes |
| SQLite (this tool) | **~50ms** |

## 🏗️ Technical Details

- **Database:** `~/Library/Mail/V{9,10,11}/MailData/Envelope Index`
- **Query method:** SQLite (read-only) + `.emlx` files (`read`) + AppleScript (`body`, `inspect`, `set-flag`)
- **Message files:** `~/Library/Mail/V*/<account>/<mailbox>.mbox/<store>/Data/<digits>/Messages/<row id>.emlx`
- **Database safety:** SQLite access is read-only by default; optional `--copy` mode available

## 🛠️ Scripts

- `./scripts/committer "message" path...`: stage only the listed paths and create a commit
- `./scripts/release check 1.1.1`: verify synced release versions and run the release test gates
- `./scripts/release run 1.1.1`: bump versions, run tests, package artifacts, tag, push, wait for the release workflow, publish npm, and update Homebrew

Release CI publishes to npm with trusted publishing.

## 🔗 ClawHub

Available as a skill on [ClawHub](https://clawhub.ai/gumadeiras/apple-mail-search-safe) for [OpenClaw](https://github.com/openclaw/openclaw) users. Install with:

```bash
clawhub install apple-mail-search-safe
```

## 📝 License

MIT
