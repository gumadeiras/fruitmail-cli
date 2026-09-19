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
- **🔍 Full search:** Search by subject, sender, recipient, date range, attachments, and more
- **🎯 Exact inspection:** Read stable message metadata, reply state, headers, body, and flag state as JSON
- **🚩 Explicit flags:** Set or clear one Mail flag color without changing read, junk, or mailbox state

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

 # Inspect one exact message as stable JSON
 fruitmail inspect 94695 --json

 # Set or clear only that message's colored flag
 fruitmail set-flag 94695 purple --json
 fruitmail set-flag 94695 none --json

 # Count colored flags without returning message content
 fruitmail flag-counts --json
 
 # Database stats
 fruitmail stats
 ```

`inspect <id> --json` returns these stable keys: `id`, `messageId`,
`subject`, `sender`, `recipients`, `dateReceived`, `mailbox`, `body`,
`headers`, `wasRepliedTo`, and `flagIndex`. Missing Mail properties use an
empty string, empty array, `false`, or `-1` as appropriate.

`set-flag <id> <color> --json` accepts `red`, `orange`, `yellow`, `green`,
`blue`, `purple`, `gray`, or `none`. It returns `ok`, `id`, `color`,
`flagIndex`, and `changed`. `none` clears the flag. Repeating an operation is
safe and returns `changed: false` when Mail already has the requested state.
Flag changes use Mail.app's AppleScript interface. They never move, copy,
archive, delete, mark read, or mark junk.

`flag-counts --json` reads Mail's indexed flagged bit, then asks Mail.app only
for the color of each flagged message. It returns total and flagged message
counts, counts for all seven colors, and an `unresolved` count. It never returns
message identity or content.

## 📊 Performance

| Method | Time for 130k emails |
|--------|---------------------|
| AppleScript (full iteration) | 8+ minutes |
| SQLite (this tool) | **~50ms** |

## 🏗️ Technical Details

- **Database:** `~/Library/Mail/V{9,10,11}/MailData/Envelope Index`
- **Query method:** SQLite (read-only) + AppleScript (body content)
- **Safety:** Read-only mode prevents modification; optional `--copy` mode available

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
