import { exec } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

// Helper to create a fake DB with Apple Mail schema
function setupFakeDb(filePath: string) {
    const db = new DatabaseSync(filePath);

    // Create Minimal Schema
    db.exec(`
    CREATE TABLE messages (
      ROWID INTEGER PRIMARY KEY,
      date_sent INTEGER,
      subject INTEGER,
      sender INTEGER,
      read INTEGER DEFAULT 1,
      deleted INTEGER DEFAULT 0,
      flags INTEGER DEFAULT 0,
      flag_color INTEGER,
      remote_id INTEGER,
      document_id TEXT,
      mailbox INTEGER
    );
    CREATE TABLE subjects (
        ROWID INTEGER PRIMARY KEY,
        subject TEXT
    );
    CREATE TABLE addresses (
        ROWID INTEGER PRIMARY KEY,
        address TEXT,
        comment TEXT
    );
    CREATE TABLE recipients (
        message INTEGER,
        address INTEGER
    );
    CREATE TABLE attachments (
        message INTEGER,
        name TEXT
    );
    CREATE TABLE mailboxes (
        ROWID INTEGER PRIMARY KEY,
        display_name TEXT
    );
    CREATE TABLE labels (
        message_id INTEGER,
        mailbox_id INTEGER
    );
  `);

    // Insert Data
    // 1. "Invoice from Amazon" (Unread, Recent)
    const now = Math.floor(Date.now() / 1000);

    db.prepare("INSERT INTO subjects (ROWID, subject) VALUES (1, 'Your Invoice from Amazon')").run();
    db.prepare("INSERT INTO addresses (ROWID, address, comment) VALUES (1, 'no-reply@amazon.com', 'Amazon')").run();
    db.prepare("INSERT INTO addresses (ROWID, address, comment) VALUES (3, 'billing@example.com', 'Billing')").run();
    db.prepare("INSERT INTO mailboxes (ROWID, display_name) VALUES (10, 'Inbox')").run();
    db.prepare("INSERT INTO mailboxes (ROWID, display_name) VALUES (11, 'deleted messages')").run();
    db.prepare('INSERT INTO messages (ROWID, date_sent, subject, sender, read, deleted, flags, flag_color, remote_id, mailbox) VALUES (100, ?, 1, 1, 0, 0, 4, 1, 8559239795323845908, 10)').run(now);
    db.prepare('INSERT INTO recipients (message, address) VALUES (100, 3)').run();

    // 2. "Hello Mom" (Read, Old, Attachment)
    const old = now - (30 * 86400); // 30 days ago
    db.prepare("INSERT INTO subjects (ROWID, subject) VALUES (2, 'Hello Mom')").run();
    db.prepare("INSERT INTO addresses (ROWID, address, comment) VALUES (2, 'mom@example.com', 'Mom')").run();
    db.prepare('INSERT INTO messages (ROWID, date_sent, subject, sender, read, deleted, mailbox) VALUES (101, ?, 2, 2, 1, 0, 11)').run(old);
    db.prepare("INSERT INTO attachments (message, name) VALUES (101, 'photo.jpg')").run();

    // 3. "Spam" (Deleted)
    db.prepare("INSERT INTO subjects (ROWID, subject) VALUES (3, 'Win a prize')").run();
    db.prepare('INSERT INTO messages (ROWID, date_sent, subject, sender, read, deleted, mailbox) VALUES (102, ?, 3, 2, 0, 1, 10)').run(now);

    // 4. Long subject for width-formatting test
    db.prepare("INSERT INTO subjects (ROWID, subject) VALUES (4, 'Very long subject that should be truncated to fit in terminal width without breaking the table layout or wrapping lines unexpectedly')").run();
    db.prepare('INSERT INTO messages (ROWID, date_sent, subject, sender, read, deleted, mailbox) VALUES (103, ?, 4, 1, 1, 0, 11)').run(now);
    db.prepare('INSERT INTO labels (message_id, mailbox_id) VALUES (103, 10)').run();

    db.close();
}

describe('Integration: Search CLI', () => {
    const tempDb = path.join(__dirname, 'test.db');
    let tempBinDir = '';
    const binPath = path.resolve(__dirname, '../bin/fruitmail');

    beforeAll(() => {
        process.env.FORCE_COLOR = '0'; // Disable chalk colors
        try { fs.unlinkSync(tempDb); } catch { }
        setupFakeDb(tempDb);

        tempBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fruitmail-test-bin-'));
        const osascriptPath = path.join(tempBinDir, 'osascript');
        fs.writeFileSync(osascriptPath, `#!/usr/bin/env bash
payload="$*"
if [[ "$payload" != *"-e"* ]]; then
  payload="$(cat)"
fi
case "$payload" in
  *"return (isFlagged as text)"*) printf 'true|0' ;;
  *"makeInspectionJson"*) printf '%s' '{"messageId":"invoice@example.com","subject":"Your Invoice from Amazon","sender":"no-reply@amazon.com","recipients":["billing@example.com"],"dateReceived":"Friday, September 18, 2026 at 10:00:00 AM","mailbox":"Inbox","body":"Mock Body","headers":"Message-ID: <invoice@example.com>","wasRepliedTo":false,"flagIndex":-1}' ;;
  *"set targetFlagIndex to 0"*) printf 'red|0|true' ;;
  *"set targetFlagIndex to 1"*) printf 'orange|1|true' ;;
  *"set targetFlagIndex to 2"*) printf 'yellow|2|true' ;;
  *"set targetFlagIndex to 3"*) printf 'green|3|true' ;;
  *"set targetFlagIndex to 4"*) printf 'blue|4|true' ;;
  *"set targetFlagIndex to 5"*) printf 'purple|5|true' ;;
  *"set targetFlagIndex to 6"*) printf 'gray|6|true' ;;
  *"set targetFlagIndex to -1"*) printf 'none|-1|false' ;;
  *"return content of foundMsg"*|*"return content of msg"*) printf 'Mock Body' ;;
  *"open foundMsg"*|*"open msg"*) printf 'OK' ;;
  *) printf '__FRUITMAIL_NOT_FOUND__' ;;
esac
`);
        fs.chmodSync(osascriptPath, 0o755);

        const openPath = path.join(tempBinDir, 'open');
        fs.writeFileSync(openPath, `#!/usr/bin/env bash
exit 0
`);
        fs.chmodSync(openPath, 0o755);
    });

    afterAll(() => {
        try { fs.unlinkSync(tempDb); } catch { }
        if (tempBinDir) {
            try { fs.rmSync(tempBinDir, { recursive: true, force: true }); } catch { }
        }
    });

    const cliEnv = () => ({
        ...process.env,
        FORCE_COLOR: '0',
        PATH: tempBinDir ? `${tempBinDir}${path.delimiter}${process.env.PATH}` : process.env.PATH
    });

    const runCommand = (command: string, rejectOnError = true): Promise<string> => {
        return new Promise((resolve, reject) => {
            exec(command, { env: cliEnv() }, (err, stdout, stderr) => {
                if (stderr) console.log('CLI STDERR:', stderr);
                if (err && rejectOnError) return reject(stderr || err.message);
                resolve(stdout.trim());
            });
        });
    };

    const runCli = (args: string): Promise<string> => {
        return runCommand(`node ${binPath} --db "${tempDb}" ${args}`);
    };

    const runShellCli = (args: string): Promise<string> => {
        const shellPath = path.resolve(__dirname, '../fruitmail');
        return runCommand(`${shellPath} --db "${tempDb}" ${args}`);
    };

    const runCliJsonFailure = async (args: string): Promise<unknown> => {
        return JSON.parse(await runCommand(`node ${binPath} --db "${tempDb}" ${args}`, false));
    };

    const parseJson = async (args: string) => JSON.parse(await runCli(args));
    const parseShellJson = async (args: string) => JSON.parse(await runShellCli(args));

    it('should find unread emails', async () => {
        const out = await runCli('search --unread --days 3650 --json');
        const json = JSON.parse(out);
        expect(json).toHaveLength(1);
        expect(json[0].subject).toBe('Your Invoice from Amazon');
    });

    it('should support offset with limit', async () => {
        const out = await runCli('-n 1 -o 2 search --days 3650 --json');
        const json = JSON.parse(out);
        expect(json).toHaveLength(1);
        expect(json[0].id).toBe(101);
        expect(json[0].subject).toBe('Hello Mom');
    });

    it('should return empty array when offset is beyond results', async () => {
        const out = await runCli('-n 10 -o 10 search --days 3650 --json');
        expect(out).toBe('[]');
    });

    it('should apply offset to shortcut commands too', async () => {
        const out = await runCli('-o 1 unread --json');
        expect(out).toBe('[]');
    });

    it('should reject invalid offset values', async () => {
        await expect(runCliJsonFailure('--offset 2x search --days 3650 --json')).resolves.toEqual({
            error: 'Invalid --offset: expected a non-negative integer'
        });
    });

    it('should reject invalid limit values', async () => {
        await expect(runCliJsonFailure('--limit 2x search --days 3650 --json')).resolves.toEqual({
            error: 'Invalid --limit: expected a non-negative integer'
        });
    });

    it('should find emails by subject phrase', async () => {
        const json = await parseJson('search --subject "invoice" --days 3650 --json');
        expect(json).toHaveLength(1);
        expect(json[0].sender).toContain('amazon.com');
        expect(json[0].mailbox).toBe('Inbox');
    });

    it('scopes All Inboxes across primary mailboxes and label membership', async () => {
        const json = await parseJson('search --inbox --days 3650 --json');
        expect(json.map((row: any) => row.id).sort()).toEqual([100, 103]);
    });

    it.each([
        ['subject shortcut', 'subject invoice --json', ['Your Invoice from Amazon']],
        ['sender shortcut', 'sender mom --json', ['Hello Mom']],
        ['recipient shortcut', 'to billing --json', ['Your Invoice from Amazon']],
        ['recent shortcut', 'recent 7 --json', ['Very long subject that should be truncated to fit in terminal width without breaking the table layout or wrapping lines unexpectedly', 'Your Invoice from Amazon']],
        ['sender flag', 'search --sender mom --days 3650 --json', ['Hello Mom']],
        ['sender name flag', 'search --from-name Mom --days 3650 --json', ['Hello Mom']],
        ['recipient flag', 'search --to billing --days 3650 --json', ['Your Invoice from Amazon']],
        ['read flag', 'search --read --days 3650 --json', ['Very long subject that should be truncated to fit in terminal width without breaking the table layout or wrapping lines unexpectedly', 'Hello Mom']],
        ['attachment type flag', 'search --attachment-type jpg --days 3650 --json', ['Hello Mom']]
    ])('routes %s', async (_name, args, subjects) => {
        const json = await parseJson(args);
        const actualSubjects = json.map((row: any) => row.subject).sort();
        expect(actualSubjects).toEqual([...subjects].sort());
    });

    it('should support csv, quiet empty output, body JSON, open, and copy mode', async () => {
        await expect(runCli('search --subject invoice --days 3650 --csv')).resolves.toContain('id,date,sender,subject,mailbox');
        await expect(runCli('search --subject missing --quiet')).resolves.toBe('');
        await expect(runCli('body 100 --json')).resolves.toBe(JSON.stringify({ id: '100', body: 'Mock Body' }, null, 2));
        await expect(runCli('open 100')).resolves.toBe('');
        await expect(parseJson('--copy search --subject invoice --days 3650 --json')).resolves.toHaveLength(1);
    });

    it('inspects one exact message with stable JSON fields', async () => {
        await expect(parseJson('inspect 100 --json')).resolves.toEqual({
            id: 100,
            messageId: 'invoice@example.com',
            subject: 'Your Invoice from Amazon',
            sender: 'no-reply@amazon.com',
            recipients: ['billing@example.com'],
            dateReceived: 'Friday, September 18, 2026 at 10:00:00 AM',
            mailbox: 'Inbox',
            body: 'Mock Body',
            headers: 'Message-ID: <invoice@example.com>',
            wasRepliedTo: false,
            flagIndex: -1
        });
    });

    it.each([
        ['red', 0], ['orange', 1], ['yellow', 2], ['green', 3],
        ['blue', 4], ['purple', 5], ['gray', 6], ['none', -1]
    ])('sets the %s flag with JSON output', async (color, flagIndex) => {
        const result = await parseJson(`set-flag 100 ${color} --json`);
        expect(result).toEqual({ id: 100, ok: true, color, flagIndex, changed: color !== 'none' });
    });

    it('rejects invalid inspect and set-flag inputs as JSON', async () => {
        await expect(runCliJsonFailure('inspect not-a-number --json')).resolves.toEqual({ error: 'Invalid message ID' });
        await expect(runCliJsonFailure('set-flag 100 chartreuse --json')).resolves.toEqual({
            error: 'Invalid flag color: expected red, orange, yellow, green, blue, purple, gray, none'
        });
        await expect(runCliJsonFailure('set-flag 999 red --json')).resolves.toEqual({ error: 'Message not found' });
    });

    it('counts all colored flags without exposing message content', async () => {
        await expect(parseJson('flag-counts --json')).resolves.toEqual({
            totalMessages: 3,
            flaggedMessages: 1,
            colors: { red: 1, orange: 0, yellow: 0, green: 0, blue: 0, purple: 0, gray: 0 },
            unresolved: 0
        });
    });

    it('scopes flag counts to All Inboxes', async () => {
        await expect(parseJson('flag-counts --inbox --json')).resolves.toEqual({
            totalMessages: 2,
            flaggedMessages: 1,
            colors: { red: 1, orange: 0, yellow: 0, green: 0, blue: 0, purple: 0, gray: 0 },
            unresolved: 0
        });
    });

    it('should run raw queries in the Bash CLI', async () => {
        await expect(runShellCli('query "SELECT COUNT(*) AS total FROM messages;" --json')).resolves.toBe('[{"total":4}]');
    });

    it.each([
        ['subject shortcut', 'subject invoice --json', ['Your Invoice from Amazon']],
        ['from alias', 'from mom --json', ['Hello Mom']],
        ['sender name shortcut', 'from-name Mom --json', ['Hello Mom']],
        ['recipient shortcut', 'to billing --json', ['Your Invoice from Amazon']],
        ['unread shortcut', 'unread --json', ['Your Invoice from Amazon']],
        ['recent shortcut', 'recent 7 --json', ['Very long subject that should be truncated to fit in terminal width without breaking the table layout or wrapping lines unexpectedly', 'Your Invoice from Amazon']],
        ['attachments command', 'attachments --json', ['Hello Mom']],
        ['attachment type command', 'attachment-type jpg --json', ['Hello Mom']]
    ])('routes Bash CLI %s', async (_name, args, subjects) => {
        const json = await parseShellJson(args);
        expect(json.map((row: any) => row.subject).sort()).toEqual([...subjects].sort());
    });

    it('should expose Bash CLI help and stats', async () => {
        await expect(runShellCli('--help')).resolves.toContain('fruitmail search --subject "invoice"');
        await expect(runShellCli('stats')).resolves.toMatch(/Total messages:\s+4/);
    });

    it('should route Bash CLI body and open commands through AppleScript', async () => {
        const body = await parseShellJson('body 100 --json');
        expect(body).toEqual({ id: 100, body: 'Mock Body' });
        await expect(runShellCli('open 100')).resolves.toBe('');
    });

    it('should let the Bash CLI pass subject flags to search', async () => {
        const out = await runShellCli('search --subject "invoice" --days 3650 --json');
        const json = JSON.parse(out);
        expect(json).toHaveLength(1);
        expect(json[0].subject).toBe('Your Invoice from Amazon');
    });

    it('should keep accepting Bash CLI global flags after shortcut commands', async () => {
        const out = await runShellCli('sender "mom" --json');
        const json = JSON.parse(out);
        expect(json).toHaveLength(1);
        expect(json[0].subject).toBe('Hello Mom');
    });

    it('should apply offset in the Bash CLI search path', async () => {
        const out = await runShellCli('-n 1 -o 2 search --days 3650 --json');
        const json = JSON.parse(out);
        expect(json).toHaveLength(1);
        expect(json[0].id).toBe(101);
        expect(json[0].subject).toBe('Hello Mom');
    });

    it('should apply offset in Bash CLI attachment result lists', async () => {
        const out = await runShellCli('-o 1 attachments --json');
        expect(out).toBe('');
    });

    it('should ignore deleted emails', async () => {
        const out = await runCli('search --subject "prize" --days 3650 --json');
        // "Win a prize" is deleted=1
        expect(out).toBe('[]');
    });

    it('should search with unified flags (--has-attachment)', async () => {
        const out = await runCli('search --has-attachment --days 3650 --json');
        const json = JSON.parse(out);
        expect(json).toHaveLength(1);
        expect(json[0].subject).toBe('Hello Mom');
    });

    it('should show friendly mailbox names', async () => {
        const out = await runCli('search --subject "Hello Mom" --days 3650 --json');
        const json = JSON.parse(out);
        expect(json).toHaveLength(1);
        expect(json[0].mailbox).toBe('Trash');
    });

    it('should keep table lines within default terminal width', async () => {
        const out = await runCli('search --subject "Very long subject" --days 3650');
        const lines = out.split('\n').filter(line => line.length > 0);
        const maxLength = Math.max(...lines.map(line => line.length));
        expect(maxLength).toBeLessThanOrEqual(120);
    });

    it('should show stats', async () => {
        const out = await runCli('stats');
        expect(out).toMatch(/Total messages:\s+4/);
        expect(out).toMatch(/Deleted:\s+1/);
        expect(out).toMatch(/Unread:\s+1/);
    });
});
