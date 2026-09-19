# Changelog

## Unreleased

## 1.2.1 - 2026-09-19

### Features

- Added `inspect <id> --json` for exact, stable message metadata, body, headers, reply state, and flag state. `dateReceived` is ISO 8601 from Mail's index.
- Added `read <id...> --json` to read many messages from Mail's on-disk store without Mail.app, with the same keys as `inspect`.
- Added `set-flag <id> <color> --json` to set or clear one Mail flag through AppleScript with idempotent results, the previous flag index, and no other message changes. `--expect-message-id` refuses the change when the message no longer carries that Message-ID, and `--expect-flag-index` refuses it when the message's current flag differs from the expected index; both checks run inside the same AppleScript call as the change.
- Added `read --max-body-chars <n>` to bound each returned body.
- Added `flag-counts --json` for a content-free mailbox-wide count of existing colored flags, read from the index without Mail.app.

### Changes

- `body`, `open`, `inspect`, and `set-flag` resolve a numeric ID directly by Mail's message ID instead of scanning every mailbox, so lookups take a fraction of the time. `inspect` and `set-flag` no longer fall back to subject or sender matches.

### Fixes

- Terminating `fruitmail` while Mail.app is still working now also stops the AppleScript it started, so Mail is not left busy.
- Large message bodies no longer fail `inspect` or `body` with an output limit error.
- `read` parses each `.emlx` file as a stream and discards attachment content without buffering it, so a message with large attachments no longer holds the whole file and every attachment in memory.

## 1.2.0 - 2026-05-23

### Features

- Added `--offset` / `-o` to paginate search results based on PR #1. Thanks to @JakubPecenka.

### Changes

- npm installs now require Node.js 22.13 or newer.
- Renamed the published npm and Homebrew package to `fruitmail`.
- Documented the local release wrapper and normalized release workflow naming.

### Fixes

- Fixed pnpm global installs by removing the native SQLite runtime binding (#2). Thanks to @Mytakeon for reporting this.
- Fixed the standalone Bash CLI so `fruitmail search --subject ...` and other search flags are accepted (#3). Thanks to @Mytakeon for reporting this.

## 1.1.2 - 2026-05-14

### Fixes

- Fixed `fruitmail -V` to report the package version instead of a stale hardcoded version.
- Fixed npm, git, and Homebrew installs to run the same built CLI entrypoint.

## 1.1.1 - 2026-03-30

Initial release.

### Features

- Added SQLite-backed Apple Mail search with full body content support.
- Added a unified Node and Bash CLI for Fruitmail.
- Added an install script that copies the executable and updates shell startup files.
- Added release automation scripts.

### Changes

- Updated README installation guidance, ClawHub links, and repository links after the rename.
- Improved table output and Mail lookup behavior.

### Fixes

- Fixed ClawHub links and wording in the README.
