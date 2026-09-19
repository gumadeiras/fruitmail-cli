import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { type AddressObject, type AttachmentStream, type Headers, MailParser, type MessageText } from 'mailparser';
import { findColumnByAlias, getTableColumns, MESSAGE_FLAG_ANSWERED, messageFlagIndex, quoteIdentifier, unixSecondsToIso } from './db-schema.js';

/**
 * Reads messages from Mail's on-disk store without Mail.app.
 *
 * Mail writes each message to
 * `<mail root>/<account>/<mailbox chain>.mbox/<store uuid>/Data/<digits>/Messages/<row id>.emlx`,
 * where `<digits>` are the row ID without its last three digits, least
 * significant first, and `.partial.emlx` marks a copy with attachments removed.
 * The row ID is the Envelope Index `messages.ROWID`, so the index alone locates
 * the file; replied and flag state come from the index and content from the file.
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

/**
 * An emlx file is a decimal byte count, a newline, the RFC 822 message, then a
 * property list. The message is returned as a stream so a large message is
 * never held in memory as a whole.
 */
export function openEmlxMessage(filePath: string): Readable {
    const fd = fs.openSync(filePath, 'r');
    let prefix: Buffer;
    let size: number;
    try {
        prefix = Buffer.alloc(32);
        const read = fs.readSync(fd, prefix, 0, prefix.length, 0);
        prefix = prefix.subarray(0, read);
        size = fs.fstatSync(fd).size;
    } finally {
        fs.closeSync(fd);
    }
    const newline = prefix.indexOf(0x0a);
    const length = newline > 0 ? Number.parseInt(prefix.subarray(0, newline).toString('ascii').trim(), 10) : NaN;
    if (!Number.isSafeInteger(length) || length < 0 || newline + 1 + length > size) {
        throw new Error('Malformed emlx file');
    }
    return fs.createReadStream(filePath, { start: newline + 1, end: newline + length });
}

function addressesOf(value: unknown): string[] {
    const objects = Array.isArray(value) ? value as AddressObject[] : value ? [value as AddressObject] : [];
    return objects
        .flatMap((object) => object.value)
        .flatMap((entry) => entry.group ?? [entry])
        .flatMap((entry) => (entry.address ? [entry.address] : []));
}

export type ParsedMessageContent = Pick<LocalMessage, 'messageId' | 'subject' | 'sender' | 'recipients' | 'body' | 'headers'>;

/**
 * Parses the message while it streams. Attachment content is discarded
 * without being buffered; text parts are collected. `maxBodyChars` bounds the
 * returned body.
 */
export function parseMessageContent(source: Readable | Buffer, maxBodyChars = Infinity): Promise<ParsedMessageContent> {
    return new Promise((resolve, reject) => {
        const parser = new MailParser({ skipImageLinks: true, skipTextToHtml: true });
        let headers: Headers = new Map();
        let headerLines = '';
        let body = '';

        const fail = (error: unknown) => {
            parser.destroy();
            reject(error instanceof Error ? error : new Error('Malformed message'));
        };
        parser.on('error', fail);
        parser.on('headers', (value: Headers) => {
            headers = value;
            headerLines = (parser as unknown as { headerLines: Array<{ line: string }> }).headerLines
                .map((header) => header.line).join('\n');
        });
        parser.on('data', (data: AttachmentStream | MessageText) => {
            if (data.type === 'text') {
                body = data.text ?? '';
                return;
            }
            const content = data.content as Readable;
            content.once('end', () => data.release());
            content.once('error', fail);
            content.resume();
        });
        parser.on('end', () => {
            const messageId = headers.get('message-id');
            const subject = headers.get('subject');
            const sender = headers.get('from') as AddressObject | undefined;
            resolve({
                messageId: (typeof messageId === 'string' ? messageId : '').trim().replace(/^<|>$/g, ''),
                subject: typeof subject === 'string' ? subject : '',
                sender: sender?.text ?? '',
                recipients: [...addressesOf(headers.get('to')), ...addressesOf(headers.get('cc')), ...addressesOf(headers.get('bcc'))],
                body: body.slice(0, maxBodyChars),
                headers: headerLines
            });
        });

        if (Buffer.isBuffer(source)) parser.end(source);
        else source.once('error', fail).pipe(parser);
    });
}

interface IndexedRow {
    id: number;
    flags: number;
    deleted: number;
    date_received: number | null;
    url: string | null;
    flagged?: number | null;
}

export async function readLocalMessages(db: any, dbPath: string, ids: number[], maxBodyChars = Infinity): Promise<LocalMessageResult[]> {
    const mailboxColumns = getTableColumns(db, 'mailboxes');
    const urlColumn = findColumnByAlias(mailboxColumns, ['url']);
    if (!urlColumn) throw new Error('Mail database does not expose mailbox locations');
    const messageColumns = getTableColumns(db, 'messages');
    const flaggedColumn = findColumnByAlias(messageColumns, ['flagged']);
    const stateColumns = flaggedColumn ? `, m.${quoteIdentifier(flaggedColumn)} as flagged` : '';

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
            const content = await parseMessageContent(openEmlxMessage(filePath), maxBodyChars);
            results.push({
                id,
                ...content,
                dateReceived: unixSecondsToIso(row.date_received),
                mailbox: row.url,
                wasRepliedTo: (Number(row.flags) & MESSAGE_FLAG_ANSWERED) !== 0,
                flagIndex: messageFlagIndex(row.flags, row.flagged)
            });
        } catch {
            results.push({ id, error: 'Unreadable local message file' });
        }
    }
    return results;
}
