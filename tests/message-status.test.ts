import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readMessageStatuses } from '../src/message-status';
import { SQLiteDatabase } from '../src/sqlite';

describe('message status', () => {
    let directory: string;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fruitmail-status-'));
    });

    afterEach(() => {
        fs.rmSync(directory, { recursive: true, force: true });
    });

    it('returns a null index identifier when the schema has no message_id column', () => {
        const databasePath = path.join(directory, 'Envelope Index');
        const setup = new DatabaseSync(databasePath);
        setup.exec(`
            CREATE TABLE messages (
                ROWID INTEGER PRIMARY KEY,
                flags INTEGER NOT NULL,
                deleted INTEGER NOT NULL,
                mailbox INTEGER
            );
            CREATE TABLE mailboxes (
                ROWID INTEGER PRIMARY KEY,
                display_name TEXT
            );
            INSERT INTO mailboxes (ROWID, display_name) VALUES (10, 'Inbox');
            INSERT INTO messages (ROWID, flags, deleted, mailbox) VALUES (42, 4, 0, 10);
        `);
        setup.close();

        const db = new SQLiteDatabase(databasePath, { readonly: true, fileMustExist: true });
        try {
            expect(readMessageStatuses(db, [42])).toEqual([{
                id: 42,
                flagIndex: -1,
                wasRepliedTo: true,
                inInbox: true,
                indexMessageId: null
            }]);
        } finally {
            db.close();
        }
    });
});
