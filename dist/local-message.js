"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalMessageStore = void 0;
exports.messageDataSegments = messageDataSegments;
exports.mailboxDirectorySegments = mailboxDirectorySegments;
exports.readEmlxMessage = readEmlxMessage;
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
/** An emlx file is a decimal byte count, a newline, the RFC 822 message, then a property list. */
function readEmlxMessage(filePath) {
    const file = node_fs_1.default.readFileSync(filePath);
    const newline = file.indexOf(0x0a);
    const length = newline > 0 ? Number.parseInt(file.subarray(0, newline).toString('ascii').trim(), 10) : NaN;
    if (!Number.isSafeInteger(length) || length < 0 || newline + 1 + length > file.length) {
        throw new Error('Malformed emlx file');
    }
    return file.subarray(newline + 1, newline + 1 + length);
}
function addressesOf(value) {
    const objects = Array.isArray(value) ? value : value ? [value] : [];
    return objects
        .flatMap((object) => object.value)
        .flatMap((entry) => entry.group ?? [entry])
        .flatMap((entry) => (entry.address ? [entry.address] : []));
}
async function parseMessageContent(raw) {
    const parsed = await (0, mailparser_1.simpleParser)(raw, { skipImageLinks: true, skipTextToHtml: true });
    return {
        messageId: (parsed.messageId ?? '').trim().replace(/^<|>$/g, ''),
        subject: parsed.subject ?? '',
        sender: parsed.from?.text ?? '',
        recipients: [...addressesOf(parsed.to), ...addressesOf(parsed.cc), ...addressesOf(parsed.bcc)],
        body: parsed.text ?? '',
        headers: parsed.headerLines.map((header) => header.line).join('\n')
    };
}
async function readLocalMessages(db, dbPath, ids) {
    const mailboxColumns = (0, db_schema_js_1.getTableColumns)(db, 'mailboxes');
    const urlColumn = (0, db_schema_js_1.findColumnByAlias)(mailboxColumns, ['url']);
    if (!urlColumn)
        throw new Error('Mail database does not expose mailbox locations');
    const messageColumns = (0, db_schema_js_1.getTableColumns)(db, 'messages');
    const flaggedColumn = (0, db_schema_js_1.findColumnByAlias)(messageColumns, ['flagged']);
    const flagColorColumn = (0, db_schema_js_1.findColumnByAlias)(messageColumns, ['flag_color']);
    const stateColumns = [
        flaggedColumn ? `, m.${(0, db_schema_js_1.quoteIdentifier)(flaggedColumn)} as flagged` : '',
        flagColorColumn ? `, m.${(0, db_schema_js_1.quoteIdentifier)(flagColorColumn)} as flagColor` : ''
    ].join('');
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
            const content = await parseMessageContent(readEmlxMessage(filePath));
            const flagged = Number(row.flagged ?? 0) !== 0;
            const color = Number(row.flagColor);
            results.push({
                id,
                ...content,
                dateReceived: (0, db_schema_js_1.unixSecondsToIso)(row.date_received),
                mailbox: row.url,
                wasRepliedTo: (Number(row.flags) & db_schema_js_1.MESSAGE_FLAG_ANSWERED) !== 0,
                flagIndex: flagged && Number.isInteger(color) && color >= 1 && color <= 7 ? color - 1 : -1
            });
        }
        catch {
            results.push({ id, error: 'Unreadable local message file' });
        }
    }
    return results;
}
