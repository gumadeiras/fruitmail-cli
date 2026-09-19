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

 # Inspect one exact message as stable JSON
 fruitmail inspect 94695 --json

 # Read many messages from the local store, without Mail.app
 fruitmail read 94695 94696 --json

 # Set or clear only that message's colored flag
 fruitmail set-flag 94695 purple --json
 fruitmail set-flag 94695 none --json
 fruitmail set-flag 94695 purple --expect-message-id id@example.com --json
 fruitmail set-flag 94695 purple --expect-flag-index -1 --json

 # Read many messages with each body cut to 12000 characters
 fruitmail read 94695 94696 --json --max-body-chars 12000

 # Count colored flags without returning message content
 fruitmail flag-counts --json
 
 # Database stats
 fruitmail stats
 ```

`inspect <id> --json` returns these stable keys: `id`, `messageId`,
`subject`, `sender`, `recipients`, `dateReceived`, `mailbox`, `body`,
`headers`, `wasRepliedTo`, and `flagIndex`. `dateReceived` is ISO 8601 from
Mail's index. Missing Mail properties use an empty string, empty array,
`false`, or `-1` as appropriate. The message is resolved by its row ID inside
Mail.app; a message that Mail no longer has under that ID is reported as
`Message not found`.

`read <id...> --json` returns one entry per requested ID with the same keys as
`inspect`, in request order, without Mail.app. It locates each message's
`.emlx` file from the index, parses the MIME content, and takes `wasRepliedTo`
and `flagIndex` from the index. An entry that cannot be read is
`{ "id": <id>, "error": "..." }`: `Message not found` when the index has no
live row, `No local message file` when Mail has not stored the message
locally, `Unreadable local message file` when the file cannot be parsed.
`body` is the text part, or text converted from HTML when the message has no
text part, so it can differ from Mail's own rendering. The file is parsed as a
stream and attachment content is discarded without being held in memory, so a
message with large attachments does not fail the read. `--max-body-chars <n>`
cuts each `body` to at most `n` characters.

`set-flag <id> <color> --json` accepts `red`, `orange`, `yellow`, `green`,
`blue`, `purple`, `gray`, or `none`. It returns `ok`, `id`, `color`,
`flagIndex`, `previousFlagIndex`, and `changed`. `none` clears the flag.
Repeating an operation is safe and returns `changed: false` when Mail already
has the requested state. With `--expect-message-id <id>`, the flag changes
only if the message Mail resolves for that row ID still carries that
Message-ID; otherwise the command fails with `Message identity mismatch` and
changes nothing. With `--expect-flag-index <n>`, the flag changes only if the
message's current flag index is `n` (`-1` when unflagged); otherwise the
command fails with `Message flag mismatch` and changes nothing. Both checks
run inside the same AppleScript call as the change, so a flag another process
sets in between is not overwritten. Flag changes use Mail.app's AppleScript
interface. They never move, copy, archive, delete, mark read, or mark junk.

`flag-counts --json` reads the flagged state and flag color from Mail's index
without Mail.app. It returns total and flagged message counts, counts for all
seven colors, and an `unresolved` count of flagged messages whose color bits
fall outside the seven colors. It never returns message identity or content.

Mail keeps the flag color in bits 39 to 41 of the index's `flags` value,
numbered like the AppleScript flag index: 0 red, 1 orange, 2 yellow, 3 green,
4 blue, 5 purple, 6 gray. `read` and `flag-counts` use those bits; the
`flag_color` column is 1 for every flagged message and carries no color.

## 📊 Performance

| Method | Time for 130k emails |
|--------|---------------------|
| AppleScript (full iteration) | 8+ minutes |
| SQLite (this tool) | **~50ms** |

## 🏗️ Technical Details

- **Database:** `~/Library/Mail/V{9,10,11}/MailData/Envelope Index`
- **Query method:** SQLite (read-only) + `.emlx` files (`read`) + AppleScript (`body`, `inspect`, `set-flag`)
- **Message files:** `~/Library/Mail/V*/<account>/<mailbox>.mbox/<store>/Data/<digits>/Messages/<row id>.emlx`
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
