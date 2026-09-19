"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalMessageStore = void 0;
exports.messageDataSegments = messageDataSegments;
exports.mailboxDirectorySegments = mailboxDirectorySegments;
exports.openEmlxMessage = openEmlxMessage;
exports.parseMessageContent = parseMessageContent;
exports.readLocalMessages = readLocalMessages;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const mailparser_1 = require("mailparser");
const db_schema_js_1 = require("./db-schema.js");
function messageDataSegments(rowId) {
    const prefix = Math.floor(rowId / 1000);
    return prefix === 0 ? [] : String(prefix).split('').reverse();
}
function mailboxDirectorySegments(mailboxUrl) {
    const url = new URL(mailboxUrl);
    return url.pathname.split('/').filter(Boolean).map((segment) => `${decodeURIComponent(segment)}.mbox`);
}
class LocalMessageStore {
    mailRoot;
    listings = new Map();
    constructor(mailRoot) {
        this.mailRoot = mailRoot;
    }
    directories(directory) {
        const cached = this.listings.get(directory);
        if (cached)
            return cached;
        let names = [];
        try {
            names = node_fs_1.default.readdirSync(directory, { withFileTypes: true })
                .filter((entry) => entry.isDirectory() && entry.name !== 'MailData')
                .map((entry) => entry.name);
        }
        catch {
            names = [];
        }
        this.listings.set(directory, names);
        return names;
    }
    resolve(mailboxUrl, rowId) {
        let mailboxSegments;
        try {
            mailboxSegments = mailboxDirectorySegments(mailboxUrl);
        }
        catch {
            return undefined;
        }
        const dataSegments = messageDataSegments(rowId);
        for (const account of this.directories(this.mailRoot)) {
            const mailboxDirectory = node_path_1.default.join(this.mailRoot, account, ...mailboxSegments);
            for (const store of this.directories(mailboxDirectory)) {
                const messages = node_path_1.default.join(mailboxDirectory, store, 'Data', ...dataSegments, 'Messages');
                for (const name of [`${rowId}.emlx`, `${rowId}.partial.emlx`]) {
                    const candidate = node_path_1.default.join(messages, name);
                    if (node_fs_1.default.existsSync(candidate))
                        return candidate;
                }
            }
        }
        return undefined;
    }
}
exports.LocalMessageStore = LocalMessageStore;
/**
 * An emlx file is a decimal byte count, a newline, the RFC 822 message, then a
 * property list. The message is returned as a stream so a large message is
 * never held in memory as a whole.
 */
function openEmlxMessage(filePath) {
    const fd = node_fs_1.default.openSync(filePath, 'r');
    let prefix;
    let size;
    try {
        prefix = Buffer.alloc(32);
        const read = node_fs_1.default.readSync(fd, prefix, 0, prefix.length, 0);
        prefix = prefix.subarray(0, read);
        size = node_fs_1.default.fstatSync(fd).size;
    }
    finally {
        node_fs_1.default.closeSync(fd);
    }
    const newline = prefix.indexOf(0x0a);
    const length = newline > 0 ? Number.parseInt(prefix.subarray(0, newline).toString('ascii').trim(), 10) : NaN;
    if (!Number.isSafeInteger(length) || length < 0 || newline + 1 + length > size) {
        throw new Error('Malformed emlx file');
    }
    return node_fs_1.default.createReadStream(filePath, { start: newline + 1, end: newline + length });
}
function addressesOf(value) {
    const objects = Array.isArray(value) ? value : value ? [value] : [];
    return objects
        .flatMap((object) => object.value)
        .flatMap((entry) => entry.group ?? [entry])
        .flatMap((entry) => (entry.address ? [entry.address] : []));
}
/**
 * Parses the message while it streams. Attachment content is discarded
 * without being buffered; text parts are collected. `maxBodyChars` bounds the
 * returned body.
 */
function parseMessageContent(source, maxBodyChars = Infinity) {
    return new Promise((resolve, reject) => {
        const parser = new mailparser_1.MailParser({ skipImageLinks: true, skipTextToHtml: true });
        let headers = new Map();
        let headerLines = '';
        let body = '';
        const fail = (error) => {
            parser.destroy();
            reject(error instanceof Error ? error : new Error('Malformed message'));
        };
        parser.on('error', fail);
        parser.on('headers', (value) => {
            headers = value;
            headerLines = parser.headerLines
                .map((header) => header.line).join('\n');
        });
        parser.on('data', (data) => {
            if (data.type === 'text') {
                body = data.text ?? '';
                return;
            }
            const content = data.content;
            content.once('end', () => data.release());
            content.once('error', fail);
            content.resume();
        });
        parser.on('end', () => {
            const messageId = headers.get('message-id');
            const subject = headers.get('subject');
            const sender = headers.get('from');
            resolve({
                messageId: (typeof messageId === 'string' ? messageId : '').trim().replace(/^<|>$/g, ''),
                subject: typeof subject === 'string' ? subject : '',
                sender: sender?.text ?? '',
                recipients: [...addressesOf(headers.get('to')), ...addressesOf(headers.get('cc')), ...addressesOf(headers.get('bcc'))],
                body: body.slice(0, maxBodyChars),
                headers: headerLines
            });
        });
        if (Buffer.isBuffer(source))
            parser.end(source);
        else
            source.once('error', fail).pipe(parser);
    });
}
async function readLocalMessages(db, dbPath, ids, maxBodyChars = Infinity) {
    const mailboxColumns = (0, db_schema_js_1.getTableColumns)(db, 'mailboxes');
    const urlColumn = (0, db_schema_js_1.findColumnByAlias)(mailboxColumns, ['url']);
    if (!urlColumn)
        throw new Error('Mail database does not expose mailbox locations');
    const messageColumns = (0, db_schema_js_1.getTableColumns)(db, 'messages');
    const flaggedColumn = (0, db_schema_js_1.findColumnByAlias)(messageColumns, ['flagged']);
    const stateColumns = flaggedColumn ? `, m.${(0, db_schema_js_1.quoteIdentifier)(flaggedColumn)} as flagged` : '';
    const store = new LocalMessageStore(node_path_1.default.dirname(node_path_1.default.dirname(dbPath)));
    const rows = new Map();
    if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(', ');
        const found = db.prepare(`
            SELECT m.ROWID as id, m.flags as flags, m.deleted as deleted, m.date_received as date_received,
                   mb.${(0, db_schema_js_1.quoteIdentifier)(urlColumn)} as url${stateColumns}
            FROM messages m
            LEFT JOIN mailboxes mb ON mb.ROWID = m.mailbox
            WHERE m.ROWID IN (${placeholders})
        `).all(ids);
        for (const row of found)
            rows.set(row.id, row);
    }
    const results = [];
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
                dateReceived: (0, db_schema_js_1.unixSecondsToIso)(row.date_received),
                mailbox: row.url,
                wasRepliedTo: (Number(row.flags) & db_schema_js_1.MESSAGE_FLAG_ANSWERED) !== 0,
                flagIndex: (0, db_schema_js_1.messageFlagIndex)(row.flags, row.flagged)
            });
        }
        catch {
            results.push({ id, error: 'Unreadable local message file' });
        }
    }
    return results;
}
