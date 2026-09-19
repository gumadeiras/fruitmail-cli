import fs from 'node:fs';
import path from 'node:path';
import { simpleParser, type AddressObject } from 'mailparser';
import { findColumnByAlias, getTableColumns, MESSAGE_FLAG_ANSWERED, quoteIdentifier, unixSecondsToIso } from './db-schema.js';

/**
 * Reads messages from Mail's on-disk store without Mail.app.
 *
 * Mail writes each message to
 * `<mail root>/<account>/<mailbox chain>.mbox/<store uuid>/Data/<digits>/Messages/<row id>.emlx`,
 * where `<digits>` are the row ID without its last three digits, least
 * significant first, and `.partial.emlx` marks a copy with attachments removed.
 * The row ID is the Envelope Index `messages.ROWID`, so the index alone locates
 * the file; mutable state comes from the index and content from the file.
 */

export interface LocalMessage {
    id: number;
    messageId: string;
    subject: string;
    sender: string;
    recipients: string[];
    dateReceived: string;
    mailbox: string;
    body: string;
    headers: string;
    wasRepliedTo: boolean;
    flagIndex: number;
}

export type LocalMessageResult = LocalMessage | { id: number; error: string };

export function messageDataSegments(rowId: number): string[] {
    const prefix = Math.floor(rowId / 1000);
    return prefix === 0 ? [] : String(prefix).split('').reverse();
}

export function mailboxDirectorySegments(mailboxUrl: string): string[] {
    const url = new URL(mailboxUrl);
    return url.pathname.split('/').filter(Boolean).map((segment) => `${decodeURIComponent(segment)}.mbox`);
}

export class LocalMessageStore {
    private readonly listings = new Map<string, string[]>();

    constructor(private readonly mailRoot: string) {}

    private directories(directory: string): string[] {
        const cached = this.listings.get(directory);
        if (cached) return cached;
        let names: string[] = [];
        try {
            names = fs.readdirSync(directory, { withFileTypes: true })
                .filter((entry) => entry.isDirectory() && entry.name !== 'MailData')
                .map((entry) => entry.name);
        } catch {
            names = [];
        }
        this.listings.set(directory, names);
        return names;
    }

    resolve(mailboxUrl: string, rowId: number): string | undefined {
        let mailboxSegments: string[];
        try {
            mailboxSegments = mailboxDirectorySegments(mailboxUrl);
        } catch {
            return undefined;
        }
        const dataSegments = messageDataSegments(rowId);
        for (const account of this.directories(this.mailRoot)) {
            const mailboxDirectory = path.join(this.mailRoot, account, ...mailboxSegments);
            for (const store of this.directories(mailboxDirectory)) {
                const messages = path.join(mailboxDirectory, store, 'Data', ...dataSegments, 'Messages');
                for (const name of [`${rowId}.emlx`, `${rowId}.partial.emlx`]) {
                    const candidate = path.join(messages, name);
                    if (fs.existsSync(candidate)) return candidate;
                }
            }
        }
        return undefined;
    }
}

/** An emlx file is a decimal byte count, a newline, the RFC 822 message, then a property list. */
export function readEmlxMessage(filePath: string): Buffer {
    const file = fs.readFileSync(filePath);
    const newline = file.indexOf(0x0a);
    const length = newline > 0 ? Number.parseInt(file.subarray(0, newline).toString('ascii').trim(), 10) : NaN;
    if (!Number.isSafeInteger(length) || length < 0 || newline + 1 + length > file.length) {
        throw new Error('Malformed emlx file');
    }
    return file.subarray(newline + 1, newline + 1 + length);
}

function addressesOf(value: AddressObject | AddressObject[] | undefined): string[] {
    const objects = Array.isArray(value) ? value : value ? [value] : [];
    return objects
        .flatMap((object) => object.value)
        .flatMap((entry) => entry.group ?? [entry])
        .flatMap((entry) => (entry.address ? [entry.address] : []));
}

export async function parseMessageContent(raw: Buffer): Promise<Pick<LocalMessage, 'messageId' | 'subject' | 'sender' | 'recipients' | 'body' | 'headers'>> {
    const parsed = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true });
    return {
        messageId: (parsed.messageId ?? '').trim().replace(/^<|>$/g, ''),
        subject: parsed.subject ?? '',
        sender: parsed.from?.text ?? '',
        recipients: [...addressesOf(parsed.to), ...addressesOf(parsed.cc), ...addressesOf(parsed.bcc)],
        body: parsed.text ?? '',
        headers: parsed.headerLines.map((header) => header.line).join('\n')
    };
}

interface IndexedRow {
    id: number;
    flags: number;
    deleted: number;
    date_received: number | null;
    url: string | null;
    flagged?: number | null;
    flagColor?: number | null;
}

export async function readLocalMessages(db: any, dbPath: string, ids: number[]): Promise<LocalMessageResult[]> {
    const mailboxColumns = getTableColumns(db, 'mailboxes');
    const urlColumn = findColumnByAlias(mailboxColumns, ['url']);
    if (!urlColumn) throw new Error('Mail database does not expose mailbox locations');
    const messageColumns = getTableColumns(db, 'messages');
    const flaggedColumn = findColumnByAlias(messageColumns, ['flagged']);
    const flagColorColumn = findColumnByAlias(messageColumns, ['flag_color']);
    const stateColumns = [
        flaggedColumn ? `, m.${quoteIdentifier(flaggedColumn)} as flagged` : '',
        flagColorColumn ? `, m.${quoteIdentifier(flagColorColumn)} as flagColor` : ''
    ].join('');

    const store = new LocalMessageStore(path.dirname(path.dirname(dbPath)));
    const rows = new Map<number, IndexedRow>();
    if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(', ');
        const found = db.prepare(`
            SELECT m.ROWID as id, m.flags as flags, m.deleted as deleted, m.date_received as date_received,
                   mb.${quoteIdentifier(urlColumn)} as url${stateColumns}
            FROM messages m
            LEFT JOIN mailboxes mb ON mb.ROWID = m.mailbox
            WHERE m.ROWID IN (${placeholders})
        `).all(ids) as IndexedRow[];
        for (const row of found) rows.set(row.id, row);
    }

    const results: LocalMessageResult[] = [];
    for (const id of ids) {
        const row = rows.get(id);
        if (!row || row.deleted !== 0 || !row.url) {
            results.push({ id, error: 'Message not found' });
            continue;
        }
        const filePath = store.resolve(row.url, id);
        if (!filePath) {
            results.push({ id, error: 'No local message file' });
            continue;
        }
        try {
            const content = await parseMessageContent(readEmlxMessage(filePath));
            const flagged = Number(row.flagged ?? 0) !== 0;
            const color = Number(row.flagColor);
            results.push({
                id,
                ...content,
                dateReceived: unixSecondsToIso(row.date_received),
                mailbox: row.url,
                wasRepliedTo: (Number(row.flags) & MESSAGE_FLAG_ANSWERED) !== 0,
                flagIndex: flagged && Number.isInteger(color) && color >= 1 && color <= 7 ? color - 1 : -1
            });
        } catch {
            results.push({ id, error: 'Unreadable local message file' });
        }
    }
    return results;
}
