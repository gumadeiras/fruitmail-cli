import { exec } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const ACCOUNT_UUID = 'D0BC0D42-80B6-4DB9-A259-B1FC1D3E957A';
const STORE_UUID = '30D9C098-2799-4510-9026-38C155C6FDD6';
const RECEIVED_SECONDS = Math.floor(Date.UTC(2026, 8, 18, 14, 0, 0) / 1000);
const RECEIVED_ISO = '2026-09-18T14:00:00.000Z';

function emlx(message: string): string {
    const body = message.replace(/\n/g, '\r\n');
    return `${Buffer.byteLength(body)}\n${body}<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>flags</key><integer>1</integer></dict></plist>\n`;
}

// Writes emlx files where Mail stores them: <root>/<account>/<mailbox>.mbox/<store>/Data/<digits>/Messages/<id>.emlx
function setupFakeMailStore(mailRoot: string) {
    const inbox = path.join(mailRoot, ACCOUNT_UUID, 'Inbox.mbox', STORE_UUID, 'Data');
    // Row IDs 157897 and 157898 share the digit directory 7/5/1 (157 reversed).
    const messages = path.join(inbox, '7', '5', '1', 'Messages');
    fs.mkdirSync(messages, { recursive: true });
    fs.writeFileSync(path.join(messages, '157897.emlx'), emlx([
        'From: "Person, Some" <person@example.com>',
        'To: Gustavo <gustavo@example.com>, second@example.com',
        'Cc: copy@example.com',
        'Subject: =?UTF-8?Q?Revis=C3=A3o_urgente?=',
        'Message-ID: <request@example.com>',
        'References: <first@example.com>',
        ' <second@example.com>',
        'List-Id: trainees.example',
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="b1"',
        '',
        '--b1',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'Please review by Friday. Obrigado, at=C3=A9 j=C3=A1.',
        '--b1',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>Please review by <b>Friday</b>.</p>',
        '--b1--',
        ''
    ].join('\n')));
    fs.writeFileSync(path.join(messages, '157898.partial.emlx'), emlx([
        'From: notices@example.com',
        'To: gustavo@example.com',
        'Subject: HTML only',
        'Message-ID: <html-only@example.com>',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<html><body><p>First paragraph.</p><p>Second <a href="https://tracker.example/x">link</a>.</p></body></html>',
        ''
    ].join('\n')));
}

// Helper to create a fake DB with Apple Mail schema
function setupFakeDb(filePath: string) {
    const db = new DatabaseSync(filePath);

    // Create Minimal Schema
    db.exec(`
    CREATE TABLE messages (
      ROWID INTEGER PRIMARY KEY,
      date_sent INTEGER,
      date_received INTEGER,
      subject INTEGER,
      sender INTEGER,
      read INTEGER DEFAULT 1,
      deleted INTEGER DEFAULT 0,
      flags INTEGER DEFAULT 0,
      flag_color INTEGER,
      remote_id INTEGER,
      document_id TEXT,
      message_id INTEGER,
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
        display_name TEXT,
        url TEXT
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
    db.prepare("INSERT INTO mailboxes (ROWID, display_name, url) VALUES (10, 'Inbox', ?)").run(`ews://${ACCOUNT_UUID}/Inbox`);
    db.prepare("INSERT INTO mailboxes (ROWID, display_name, url) VALUES (11, 'deleted messages', ?)").run(`ews://${ACCOUNT_UUID}/Deleted%20Messages`);
    db.prepare('INSERT INTO messages (ROWID, date_sent, date_received, subject, sender, read, deleted, flags, flag_color, remote_id, mailbox) VALUES (100, ?, ?, 1, 1, 0, 0, 1099511627796, 1, 8559239795323845908, 10)').run(now, RECEIVED_SECONDS);
    db.prepare('INSERT INTO recipients (message, address) VALUES (100, 3)').run();
    db.prepare('UPDATE messages SET message_id = -4317561145929622860 WHERE ROWID = 100').run();

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

    // 5. Local-store messages: an answered multipart message and a partial (attachments removed) HTML-only message.
    const ancient = now - (4000 * 86400);
    db.prepare("INSERT INTO subjects (ROWID, subject) VALUES (5, 'Local subject')").run();
    db.prepare('INSERT INTO messages (ROWID, date_sent, date_received, subject, sender, read, deleted, flags, mailbox) VALUES (157897, ?, ?, 5, 1, 1, 0, 5, 10)').run(ancient, RECEIVED_SECONDS);
    db.prepare('UPDATE messages SET message_id = -4317561145929622861 WHERE ROWID = 157897').run();
    db.prepare('INSERT INTO messages (ROWID, date_sent, date_received, subject, sender, read, deleted, flags, mailbox) VALUES (157898, ?, ?, 5, 1, 1, 0, 3298534883345, 10)').run(ancient, RECEIVED_SECONDS);

    db.close();
}

describe('Integration: Search CLI', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fruitmail-mail-root-'));
    const tempDb = path.join(tempRoot, 'MailData', 'Envelope Index');
    let tempBinDir = '';
    const binPath = path.resolve(__dirname, '../bin/fruitmail');

    beforeAll(() => {
        process.env.FORCE_COLOR = '0'; // Disable chalk colors
        fs.mkdirSync(path.dirname(tempDb), { recursive: true });
        setupFakeDb(tempDb);
        setupFakeMailStore(tempRoot);

        tempBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fruitmail-test-bin-'));
        const osascriptPath = path.join(tempBinDir, 'osascript');
        fs.writeFileSync(osascriptPath, `#!/usr/bin/env bash
payload="$*"
if [[ "$payload" != *"-e"* ]]; then
  payload="$(cat)"
fi
case "$payload" in
  *'set expectedMessageId to "wrong@example.com"'*) printf '__FRUITMAIL_IDENTITY_MISMATCH__' ;;
  *"makeInspectionJson"*) printf '%s' '{"messageId":"invoice@example.com","subject":"Your Invoice from Amazon","sender":"no-reply@amazon.com","recipients":["billing@example.com"],"mailbox":"Inbox","body":"Mock Body","headers":"Message-ID: <invoice@example.com>","wasRepliedTo":false,"flagIndex":-1}' ;;
  *"set targetFlagIndex to 0"*) printf 'red|0|true|-1' ;;
  *"set targetFlagIndex to 1"*) printf 'orange|1|true|-1' ;;
  *"set targetFlagIndex to 2"*) printf 'yellow|2|true|-1' ;;
  *"set targetFlagIndex to 3"*) printf 'green|3|true|-1' ;;
  *"set targetFlagIndex to 4"*) printf 'blue|4|true|-1' ;;
  *"set targetFlagIndex to 5"*) printf 'purple|5|true|-1' ;;
  *"set targetFlagIndex to 6"*) printf 'gray|6|true|-1' ;;
  *"set targetFlagIndex to -1"*) printf 'none|-1|false|-1' ;;
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
        try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { }
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
            indexMessageId: '-4317561145929622860',
            messageId: 'invoice@example.com',
            subject: 'Your Invoice from Amazon',
            sender: 'no-reply@amazon.com',
            recipients: ['billing@example.com'],
            dateReceived: RECEIVED_ISO,
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
        expect(result).toEqual({ id: 100, ok: true, color, flagIndex, previousFlagIndex: -1, changed: color !== 'none' });
    });

    it('refuses to change a flag when the expected Message-ID does not match', async () => {
        await expect(runCliJsonFailure('set-flag 100 red --expect-message-id wrong@example.com --json')).resolves.toEqual({
            error: 'Message identity mismatch'
        });
        await expect(parseJson('set-flag 100 red --expect-message-id invoice@example.com --json')).resolves.toMatchObject({ ok: true, changed: true });
    });

    it('reads messages from the local store without Mail.app', async () => {
        const results = await parseJson('read 157897 157898 100 102 999 --json');
        expect(results).toHaveLength(5);
        expect(results[0]).toEqual({
            id: 157897,
            indexMessageId: '-4317561145929622861',
            messageId: 'request@example.com',
            subject: 'Revisão urgente',
            sender: '"Person, Some" <person@example.com>',
            recipients: ['gustavo@example.com', 'second@example.com', 'copy@example.com'],
            dateReceived: RECEIVED_ISO,
            mailbox: 'Inbox',
            body: 'Please review by Friday. Obrigado, até já.',
            headers: expect.stringContaining('References: <first@example.com>\r\n <second@example.com>'),
            wasRepliedTo: true,
            flagIndex: -1
        });
        expect(results[0].headers).toContain('List-Id: trainees.example');
        expect(results[1]).toMatchObject({
            id: 157898,
            messageId: 'html-only@example.com',
            subject: 'HTML only',
            body: 'First paragraph.\n\nSecond link [https://tracker.example/x].',
            wasRepliedTo: false,
            flagIndex: 6
        });
        expect(results[2]).toEqual({ id: 100, error: 'No local message file' });
        expect(results[3]).toEqual({ id: 102, error: 'Message not found' });
        expect(results[4]).toEqual({ id: 999, error: 'Message not found' });
    });

    it('rejects invalid read inputs as JSON', async () => {
        await expect(runCliJsonFailure('read 12 abc --json')).resolves.toEqual({ error: 'Invalid message ID' });
    });

    it('rejects invalid inspect and set-flag inputs as JSON', async () => {
        await expect(runCliJsonFailure('inspect not-a-number --json')).resolves.toEqual({ error: 'Invalid message ID' });
        await expect(runCliJsonFailure('set-flag 100 chartreuse --json')).resolves.toEqual({
            error: 'Invalid flag color: expected red, orange, yellow, green, blue, purple, gray, none'
        });
        await expect(runCliJsonFailure('set-flag 999 red --json')).resolves.toEqual({ error: 'Message not found' });
    });

    it('counts colored flags from the index color bits without Mail.app', async () => {
        await expect(parseJson('flag-counts --json')).resolves.toEqual({
            totalMessages: 5,
            flaggedMessages: 2,
            colors: { red: 0, orange: 0, yellow: 1, green: 0, blue: 0, purple: 0, gray: 1 },
            unresolved: 0
        });
    });

    it('scopes flag counts to All Inboxes', async () => {
        await expect(parseJson('flag-counts --inbox --json')).resolves.toEqual({
            totalMessages: 4,
            flaggedMessages: 2,
            colors: { red: 0, orange: 0, yellow: 1, green: 0, blue: 0, purple: 0, gray: 1 },
            unresolved: 0
        });
    });

    it('should run raw queries in the Bash CLI', async () => {
        await expect(runShellCli('query "SELECT COUNT(*) AS total FROM messages;" --json')).resolves.toBe('[{"total":6}]');
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
        await expect(runShellCli('stats')).resolves.toMatch(/Total messages:\s+6/);
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
        expect(out).toMatch(/Total messages:\s+6/);
        expect(out).toMatch(/Deleted:\s+1/);
        expect(out).toMatch(/Unread:\s+1/);
    });

    it('status reports flag, reply, inbox state, and the index message id without message content', async () => {
        const json = await parseJson('status 103 100 101 102 999 --json');
        expect(json).toEqual([
            { id: 103, flagIndex: -1, wasRepliedTo: false, inInbox: true, indexMessageId: null },
            { id: 100, flagIndex: 2, wasRepliedTo: true, inInbox: true, indexMessageId: '-4317561145929622860' },
            { id: 101, flagIndex: -1, wasRepliedTo: false, inInbox: false, indexMessageId: null },
            { id: 102, error: 'Message not found' },
            { id: 999, error: 'Message not found' }
        ]);
        expect(JSON.stringify(json)).not.toContain('Invoice');
        expect(await runCli('status 100')).toBe('100: flag 2, replied true, inbox true');
    });

    it('read reports the same index message id as status', async () => {
        const [read] = await parseJson('read 157897 --json');
        const [status] = await parseJson('status 157897 --json');
        expect(read.indexMessageId).toBe('-4317561145929622861');
        expect(status.indexMessageId).toBe(read.indexMessageId);
        expect(read.flagIndex).toBe(status.flagIndex);
        expect(read.wasRepliedTo).toBe(status.wasRepliedTo);
    });
});
