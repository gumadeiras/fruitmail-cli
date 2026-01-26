import Database from 'better-sqlite3';
import { exec } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

// Helper to create a fake DB with Apple Mail schema
function setupFakeDb(filePath: string) {
    const db = new Database(filePath);

    // Create Minimal Schema
    db.exec(`
    CREATE TABLE messages (
      ROWID INTEGER PRIMARY KEY,
      date_sent INTEGER,
      subject INTEGER,
      sender INTEGER,
      read INTEGER DEFAULT 1,
      deleted INTEGER DEFAULT 0,
      document_id TEXT
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
  `);

    // Insert Data
    // 1. "Invoice from Amazon" (Unread, Recent)
    const now = Math.floor(Date.now() / 1000);

    db.prepare("INSERT INTO subjects (ROWID, subject) VALUES (1, 'Your Invoice from Amazon')").run();
    db.prepare("INSERT INTO addresses (ROWID, address, comment) VALUES (1, 'no-reply@amazon.com', 'Amazon')").run();
    db.prepare('INSERT INTO messages (ROWID, date_sent, subject, sender, read, deleted) VALUES (100, ?, 1, 1, 0, 0)').run(now);

    // 2. "Hello Mom" (Read, Old, Attachment)
    const old = now - (30 * 86400); // 30 days ago
    db.prepare("INSERT INTO subjects (ROWID, subject) VALUES (2, 'Hello Mom')").run();
    db.prepare("INSERT INTO addresses (ROWID, address, comment) VALUES (2, 'mom@example.com', 'Mom')").run();
    db.prepare('INSERT INTO messages (ROWID, date_sent, subject, sender, read, deleted) VALUES (101, ?, 2, 2, 1, 0)').run(old);
    db.prepare("INSERT INTO attachments (message, name) VALUES (101, 'photo.jpg')").run();

    // 3. "Spam" (Deleted)
    db.prepare("INSERT INTO subjects (ROWID, subject) VALUES (3, 'Win a prize')").run();
    db.prepare('INSERT INTO messages (ROWID, date_sent, subject, sender, read, deleted) VALUES (102, ?, 3, 2, 0, 1)').run(now);

    db.close();
}

describe('Integration: Search CLI', () => {
    const tempDb = path.join(__dirname, 'test.db');
    // Use compiled JS for integration test or ts-node if available. 
    // We'll trust that we can run the logic by importing main modules or simplified execution.
    // Actually, simplest is to run the bin via child_process using the temp DB.

    const binPath = path.resolve(__dirname, '../bin/fruitmail');

    beforeAll(() => {
        process.env.FORCE_COLOR = '0'; // Disable chalk colors
        setupFakeDb(tempDb);
        // Verify DB content directly
        exec(`sqlite3 "${tempDb}" "SELECT COUNT(*) FROM messages m JOIN subjects s ON m.subject = s.ROWID;"`, (err, stdout) => {
            console.log('DIRECT JOIN COUNT:', stdout);
        });
    });

    afterAll(() => {
        try { fs.unlinkSync(tempDb); } catch { }
    });

    const runCli = (args: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            exec(`node ${binPath} --db "${tempDb}" ${args}`, {
                env: { ...process.env, FORCE_COLOR: '0' }
            }, (err, stdout, stderr) => {
                if (stderr) console.log('CLI STDERR:', stderr);
                if (err) return reject(stderr || err.message);
                resolve(stdout.trim());
            });
        });
    };

    it('should find unread emails', async () => {
        const out = await runCli('search --unread --days 3650 --json');
        const json = JSON.parse(out);
        expect(json).toHaveLength(1);
        expect(json[0].subject).toBe('Your Invoice from Amazon');
    });

    it('should find emails by subject phrase', async () => {
        const out = await runCli('search --subject "invoice" --days 3650 --json');
        const json = JSON.parse(out);
        expect(json).toHaveLength(1);
        expect(json[0].sender).toContain('amazon.com');
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

    it('should show stats', async () => {
        const out = await runCli('stats');
        expect(out).toMatch(/Total messages:\s+3/);
        expect(out).toMatch(/Deleted:\s+1/);
        expect(out).toMatch(/Unread:\s+1/);
    });
});
