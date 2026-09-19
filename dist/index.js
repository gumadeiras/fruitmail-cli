#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const cli_table3_1 = __importDefault(require("cli-table3"));
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const db_schema_js_1 = require("./db-schema.js");
const db_finder_js_1 = require("./db-finder.js");
const flag_counts_js_1 = require("./flag-counts.js");
const local_message_js_1 = require("./local-message.js");
const mailbox_scope_js_1 = require("./mailbox-scope.js");
const mail_actions_js_1 = require("./mail-actions.js");
const sqlite_js_1 = require("./sqlite.js");
// Setup CLI
const program = new commander_1.Command();
const packageVersion = require('../package.json').version;
program
    .name('fruitmail')
    .description('Fast Apple Mail search via SQLite')
    .version(packageVersion)
    .configureHelp({ showGlobalOptions: true });
// Global Options
program
    .option('-n, --limit <number>', 'Max results', '20')
    .option('-o, --offset <number>', 'Skip first N results', '0')
    .option('-j, --json', 'Output as JSON')
    .option('-c, --csv', 'Output as CSV')
    .option('-q, --quiet', 'Minimal output')
    .option('--db <path>', 'Override database path')
    .option('--copy', 'Force copy mode (safe mode)');
function parseNonNegativeIntegerOption(value, name, defaultValue) {
    const rawValue = value ?? String(defaultValue);
    if (!/^\d+$/.test(rawValue)) {
        throw new Error(`Invalid --${name}: expected a non-negative integer`);
    }
    return Number.parseInt(rawValue, 10);
}
function parsePaginationOptions(options) {
    return {
        limit: parseNonNegativeIntegerOption(options.limit, 'limit', 20),
        offset: parseNonNegativeIntegerOption(options.offset, 'offset', 0)
    };
}
function getErrorMessage(error) {
    if (error instanceof Error)
        return error.message;
    if (typeof error === 'string')
        return error;
    return 'Unknown error';
}
function handleCommandError(error, options) {
    const message = getErrorMessage(error);
    if (options?.json) {
        console.log(JSON.stringify({ error: message }));
    }
    else {
        console.error(chalk_1.default.red(message));
    }
    process.exit(1);
}
function getCommandOptions(options, command) {
    return (command?.optsWithGlobals ? command.optsWithGlobals() : options);
}
function asNonEmptyString(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function asPositiveInteger(value) {
    const candidate = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(candidate) || candidate <= 0)
        return undefined;
    return candidate;
}
function parseMessageId(value) {
    const text = String(value);
    if (!/^\d+$/.test(text)) {
        throw new Error('Invalid message ID');
    }
    const id = Number(text);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error('Invalid message ID');
    }
    return id;
}
/** A Mail flag index: -1 for unflagged, otherwise one of the seven colors. */
function parseFlagIndex(value) {
    if (value === undefined)
        return undefined;
    const text = String(value);
    if (!/^-?\d+$/.test(text))
        throw new Error('Invalid --expect-flag-index: expected an integer from -1 to 6');
    const index = Number(text);
    if (!Object.values(mail_actions_js_1.MAIL_FLAG_INDEX).includes(index)) {
        throw new Error('Invalid --expect-flag-index: expected an integer from -1 to 6');
    }
    return index;
}
function parseFlagColor(value) {
    const color = String(value).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(mail_actions_js_1.MAIL_FLAG_INDEX, color)) {
        throw new Error(`Invalid flag color: expected ${Object.keys(mail_actions_js_1.MAIL_FLAG_INDEX).join(', ')}`);
    }
    return color;
}
function buildMessageLookupContext(db, rowId) {
    if (!/^\d+$/.test(rowId)) {
        throw new Error('Invalid message ID');
    }
    const messageColumns = (0, db_schema_js_1.getTableColumns)(db, 'messages');
    const selectedColumns = ['m.ROWID as _fruitmail_rowid', 'm.date_received as _fruitmail_date_received'];
    const selectedAliases = [];
    const joins = [
        'LEFT JOIN subjects s ON m.subject = s.ROWID',
        'LEFT JOIN addresses a ON m.sender = a.ROWID'
    ];
    const textIdColumns = ['document_id', 'internet_message_id', 'external_id'];
    for (const column of textIdColumns) {
        if (messageColumns.includes(column)) {
            const alias = `_fruitmail_${column}`;
            selectedColumns.push(`m.${(0, db_schema_js_1.quoteIdentifier)(column)} as ${(0, db_schema_js_1.quoteIdentifier)(alias)}`);
            selectedAliases.push({ column, alias });
        }
    }
    const numericIdColumns = ['id', 'message_id', 'mail_id', 'mailbox_message_id'];
    for (const column of numericIdColumns) {
        if (!messageColumns.includes(column))
            continue;
        if (selectedAliases.some((entry) => entry.column === column))
            continue;
        const alias = `_fruitmail_${column}`;
        selectedColumns.push(`m.${(0, db_schema_js_1.quoteIdentifier)(column)} as ${(0, db_schema_js_1.quoteIdentifier)(alias)}`);
        selectedAliases.push({ column, alias });
    }
    const mailboxHintsAliases = [];
    const mailboxColumnInMessages = (0, db_schema_js_1.findColumnByAlias)(messageColumns, ['mailbox']);
    const mailboxTableColumns = (0, db_schema_js_1.getTableColumns)(db, 'mailboxes');
    if (mailboxColumnInMessages) {
        const mailboxAlias = '_fruitmail_mailbox_raw';
        selectedColumns.push(`m.${(0, db_schema_js_1.quoteIdentifier)(mailboxColumnInMessages)} as ${(0, db_schema_js_1.quoteIdentifier)(mailboxAlias)}`);
        mailboxHintsAliases.push(mailboxAlias);
        if (mailboxTableColumns.length > 0) {
            joins.push(`LEFT JOIN mailboxes mb ON m.${(0, db_schema_js_1.quoteIdentifier)(mailboxColumnInMessages)} = mb.ROWID`);
            const mailboxHintColumns = ['display_name', 'name', 'path', 'url'];
            for (const column of mailboxHintColumns) {
                if (!mailboxTableColumns.includes(column))
                    continue;
                const alias = `_fruitmail_mailbox_${column}`;
                selectedColumns.push(`mb.${(0, db_schema_js_1.quoteIdentifier)(column)} as ${(0, db_schema_js_1.quoteIdentifier)(alias)}`);
                mailboxHintsAliases.push(alias);
            }
        }
    }
    const sql = `
      SELECT
        ${selectedColumns.join(', ')},
        s.subject as _fruitmail_subject,
        a.address as _fruitmail_sender
      FROM messages m
      ${joins.join('\n      ')}
      WHERE m.ROWID = ?
    `;
    const row = db.prepare(sql).get(rowId);
    if (!row)
        return undefined;
    const numericIdCandidates = new Set();
    const rowIdNumber = asPositiveInteger(row._fruitmail_rowid);
    if (rowIdNumber)
        numericIdCandidates.add(rowIdNumber);
    for (const { column, alias } of selectedAliases) {
        if (!['id', 'message_id', 'mail_id', 'mailbox_message_id'].includes(column))
            continue;
        const numericValue = asPositiveInteger(row[alias]);
        if (numericValue)
            numericIdCandidates.add(numericValue);
    }
    const messageIdCandidates = new Set();
    for (const { column, alias } of selectedAliases) {
        if (!['document_id', 'internet_message_id', 'external_id'].includes(column))
            continue;
        const textValue = asNonEmptyString(row[alias]);
        if (textValue)
            messageIdCandidates.add(textValue.replace(/^<|>$/g, ''));
    }
    const mailboxHints = new Set();
    for (const alias of mailboxHintsAliases) {
        const hint = asNonEmptyString(row[alias]);
        if (hint)
            mailboxHints.add(hint);
    }
    return {
        numericIdCandidates: Array.from(numericIdCandidates),
        messageIdCandidates: Array.from(messageIdCandidates),
        mailboxHints: Array.from(mailboxHints),
        subject: asNonEmptyString(row._fruitmail_subject),
        sender: asNonEmptyString(row._fruitmail_sender),
        dateReceived: (0, db_schema_js_1.unixSecondsToIso)(row._fruitmail_date_received)
    };
}
// Database Connection Helper
async function getDb(options) {
    let dbPath = options.db;
    if (!dbPath) {
        dbPath = await (0, db_finder_js_1.findDbPath)();
    }
    let dbFile = dbPath;
    let cleanUp;
    // Copy Mode (safe mode)
    if (options.copy) {
        const tempDir = node_os_1.default.tmpdir();
        const tempFile = node_path_1.default.join(tempDir, `fruitmail.${Date.now()}.db`);
        // Synchronous copy is fine for startup
        (0, node_fs_1.copyFileSync)(dbPath, tempFile);
        dbFile = tempFile;
        cleanUp = () => {
            try {
                (0, node_fs_1.unlinkSync)(tempFile);
            }
            catch { }
        };
    }
    // Open DB
    const db = new sqlite_js_1.SQLiteDatabase(dbFile, {
        readonly: !options.copy, // Read-only unless we are working on a copy
        fileMustExist: true,
        timeout: 2000 // Busy timeout handled natively
    });
    return { db, dbPath, cleanUp };
}
function sanitizeCell(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}
function computeColumnWidths(headers, desiredWidths, terminalWidth) {
    const minWidths = headers.map((header) => {
        const headerLower = header.toLowerCase();
        if (headerLower === 'id')
            return 4;
        if (headerLower === 'date')
            return 16;
        return Math.min(12, Math.max(6, header.length));
    });
    const maxTotalContent = Math.max(10, terminalWidth - (headers.length * 3 + 1));
    const widths = [...minWidths];
    const minTotal = minWidths.reduce((sum, width) => sum + width, 0);
    if (minTotal > maxTotalContent) {
        return headers.map(() => Math.max(1, Math.floor(maxTotalContent / headers.length)));
    }
    let remaining = maxTotalContent - minTotal;
    while (remaining > 0) {
        let grew = false;
        for (let i = 0; i < widths.length && remaining > 0; i += 1) {
            if (widths[i] < desiredWidths[i]) {
                widths[i] += 1;
                remaining -= 1;
                grew = true;
            }
        }
        if (!grew)
            break;
    }
    return widths;
}
function toTitleCase(value) {
    return value.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}
function friendlyMailboxName(value) {
    const raw = sanitizeCell(value);
    if (!raw)
        return raw;
    let normalized = raw;
    try {
        normalized = decodeURIComponent(normalized);
    }
    catch {
        // Keep raw string if URL decoding fails.
    }
    normalized = normalized.replace(/^[a-z]+:\/\//i, '');
    const segments = normalized.split('/').map((segment) => segment.trim()).filter(Boolean);
    let candidate = segments.length > 0 ? segments[segments.length - 1] : normalized;
    if (candidate.includes(':')) {
        candidate = candidate.split(':').pop() ?? candidate;
    }
    candidate = candidate.replace(/[._-]+/g, ' ').trim();
    const canonical = candidate.toLowerCase();
    if (canonical === 'inbox')
        return 'Inbox';
    if (canonical === 'sent' || canonical === 'sent messages')
        return 'Sent';
    if (canonical === 'drafts')
        return 'Drafts';
    if (canonical === 'deleted messages' || canonical === 'trash')
        return 'Trash';
    if (canonical === 'junk' || canonical === 'junk mail' || canonical === 'spam')
        return 'Junk';
    if (canonical === 'archive' || canonical === 'archives')
        return 'Archive';
    return toTitleCase(candidate);
}
// Output Helper
function outputResults(rows, options) {
    if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
    }
    if (options.csv) {
        if (rows.length === 0)
            return;
        const headers = Object.keys(rows[0]);
        console.log(headers.join(','));
        for (const row of rows) {
            console.log(Object.values(row).map(v => JSON.stringify(v)).join(','));
        }
        return;
    }
    if (rows.length === 0) {
        if (!options.quiet)
            console.log(chalk_1.default.gray('No results found.'));
        return;
    }
    const headers = Object.keys(rows[0]);
    const sanitizedRows = rows.map((row) => headers.map((header) => sanitizeCell(row[header])));
    const desiredWidths = headers.map((header, index) => {
        let maxWidth = header.length;
        for (const rowValues of sanitizedRows) {
            maxWidth = Math.max(maxWidth, rowValues[index].length);
        }
        return maxWidth;
    });
    const terminalWidth = process.stdout.columns ?? 120;
    const contentWidths = computeColumnWidths(headers, desiredWidths, terminalWidth);
    const colWidths = contentWidths.map((width) => width + 2); // +2 for left/right cell padding
    const table = new cli_table3_1.default({
        head: headers.map((header) => chalk_1.default.bold(header)),
        colWidths,
        wordWrap: false,
        style: { head: ['cyan'], compact: false }
    });
    for (const rowValues of sanitizedRows) {
        table.push(rowValues);
    }
    console.log(table.toString());
}
// Unified Search Builder
async function runSearch(filters, options) {
    const pagination = parsePaginationOptions(options);
    const { db, cleanUp } = await getDb(options);
    try {
        const conditions = ['1=1'];
        const params = [];
        const joins = [
            'LEFT JOIN subjects s ON m.subject = s.rowid',
            'LEFT JOIN addresses a ON m.sender = a.rowid'
        ];
        let mailboxSelect = '';
        const messageColumns = (0, db_schema_js_1.getTableColumns)(db, 'messages');
        const mailboxColumnInMessages = (0, db_schema_js_1.findColumnByAlias)(messageColumns, ['mailbox']);
        const mailboxColumns = (0, db_schema_js_1.getTableColumns)(db, 'mailboxes');
        if (mailboxColumnInMessages) {
            const quotedMailboxColumn = (0, db_schema_js_1.quoteIdentifier)(mailboxColumnInMessages);
            const mailboxLabelColumn = mailboxColumns.length > 0
                ? (0, db_schema_js_1.findColumnByAlias)(mailboxColumns, ['display_name', 'name', 'path', 'url'])
                : undefined;
            if (mailboxColumns.length > 0) {
                joins.push(`LEFT JOIN mailboxes mb ON m.${quotedMailboxColumn} = mb.ROWID`);
            }
            mailboxSelect = mailboxLabelColumn
                ? `,\n        COALESCE(mb.${(0, db_schema_js_1.quoteIdentifier)(mailboxLabelColumn)}, CAST(m.${quotedMailboxColumn} AS TEXT)) as mailbox`
                : `,\n        CAST(m.${quotedMailboxColumn} AS TEXT) as mailbox`;
        }
        // --subject
        if (filters.subject) {
            conditions.push('s.subject LIKE ?');
            params.push(`%${filters.subject}%`);
        }
        // --sender
        if (filters.sender) {
            conditions.push('a.address LIKE ?');
            params.push(`%${filters.sender}%`);
        }
        // --from-name
        if (filters.fromName) {
            conditions.push('a.comment LIKE ?');
            params.push(`%${filters.fromName}%`);
        }
        // --to
        if (filters.to) {
            joins.push('JOIN recipients r ON m.ROWID = r.message');
            joins.push('JOIN addresses ra ON r.address = ra.ROWID');
            conditions.push('ra.address LIKE ?');
            params.push(`%${filters.to}%`);
        }
        // --unread / --read
        if (filters.unread)
            conditions.push('m.read = 0');
        if (filters.read)
            conditions.push('m.read = 1');
        if (filters.inbox)
            conditions.push((0, mailbox_scope_js_1.inboxMembershipCondition)(db));
        // --days
        if (filters.days) {
            const seconds = Math.floor(Date.now() / 1000) - (parseInt(filters.days) * 86400);
            conditions.push('m.date_sent >= ?');
            params.push(seconds);
        }
        // --has-attachment / --attachment-type
        if (filters.hasAttachment || filters.attachmentType) {
            joins.push('JOIN attachments att ON m.ROWID = att.message');
        }
        if (filters.attachmentType) {
            conditions.push('att.name LIKE ?');
            params.push(`%.${filters.attachmentType}`);
        }
        // Explicit deleted check
        conditions.push('m.deleted = 0');
        const sql = `
      SELECT DISTINCT 
        m.ROWID as id,
        datetime(m.date_sent, 'unixepoch', 'localtime') as date,
        a.address as sender,
        s.subject${mailboxSelect}
      FROM messages m
      ${[...new Set(joins)].join(' ')}
      WHERE ${conditions.join(' AND ')}
      ORDER BY m.date_sent DESC
      LIMIT ?
      OFFSET ?
    `;
        params.push(pagination.limit, pagination.offset);
        // Synchronous execution
        const rows = db.prepare(sql).all(params);
        const normalizedRows = rows.map((row) => {
            if (!Object.prototype.hasOwnProperty.call(row, 'mailbox'))
                return row;
            return { ...row, mailbox: friendlyMailboxName(row.mailbox) };
        });
        outputResults(normalizedRows, options);
    }
    finally {
        db.close();
        if (cleanUp)
            cleanUp();
    }
}
// --- Commands ---
program.command('search')
    .description('Unified advanced search')
    .option('--subject <text>', 'Search by subject')
    .option('--sender <text>', 'Search by sender email')
    .option('--from-name <text>', 'Search by sender name')
    .option('--to <text>', 'Search by recipient')
    .option('--unread', 'Only unread emails')
    .option('--read', 'Only read emails')
    .option('--inbox', 'Only messages in account inboxes')
    .option('--days <number>', 'Days lookback', '7')
    .option('--has-attachment', 'Only emails with attachments')
    .option('--attachment-type <ext>', 'Filter by attachment extension (e.g. pdf)')
    .action(async (opts, cmd) => {
    const commandOptions = cmd.optsWithGlobals();
    try {
        await runSearch(opts, commandOptions);
    }
    catch (error) {
        handleCommandError(error, commandOptions);
    }
});
// Shortcuts
program.command('subject <pattern>').action(async (p, options, command) => {
    const opts = getCommandOptions(options, command);
    try {
        await runSearch({ subject: p }, opts);
    }
    catch (error) {
        handleCommandError(error, opts);
    }
});
program.command('sender <pattern>').action(async (p, options, command) => {
    const opts = getCommandOptions(options, command);
    try {
        await runSearch({ sender: p }, opts);
    }
    catch (error) {
        handleCommandError(error, opts);
    }
});
program.command('to <pattern>').action(async (p, options, command) => {
    const opts = getCommandOptions(options, command);
    try {
        await runSearch({ to: p }, opts);
    }
    catch (error) {
        handleCommandError(error, opts);
    }
});
program.command('unread').action(async (options, command) => {
    const opts = getCommandOptions(options, command);
    try {
        await runSearch({ unread: true }, opts);
    }
    catch (error) {
        handleCommandError(error, opts);
    }
});
// Recent
program.command('recent [days]')
    .action(async (days, options, command) => {
    const opts = getCommandOptions(options, command);
    try {
        await runSearch({ days: days || '7' }, opts);
    }
    catch (error) {
        handleCommandError(error, opts);
    }
});
// Open
program.command('open <id>')
    .description('Open email in Mail.app')
    .action(async (id, options, command) => {
    const opts = getCommandOptions(options, command);
    try {
        const numericId = Number.parseInt(String(id), 10);
        if (!Number.isNaN(numericId) && /^\d+$/.test(String(id))) {
            try {
                await (0, mail_actions_js_1.openEmailByLookup)({ numericIdCandidates: [numericId] });
                return;
            }
            catch (error) {
                if (getErrorMessage(error) !== 'Message not found') {
                    throw error;
                }
            }
        }
        const { db, cleanUp } = await getDb(opts);
        try {
            const lookup = buildMessageLookupContext(db, String(id));
            if (!lookup)
                throw new Error('Message not found');
            await (0, mail_actions_js_1.openEmailByLookup)(lookup);
        }
        finally {
            db.close();
            if (cleanUp)
                cleanUp();
        }
    }
    catch (error) {
        handleCommandError(error, opts);
    }
});
// Body
program.command('body <id>')
    .description('Read email body content')
    .action(async (id, options, command) => {
    const opts = getCommandOptions(options, command);
    try {
        const numericId = Number.parseInt(String(id), 10);
        if (!Number.isNaN(numericId) && /^\d+$/.test(String(id))) {
            try {
                const content = await (0, mail_actions_js_1.getEmailBodyByLookup)({ numericIdCandidates: [numericId] });
                if (opts.json) {
                    console.log(JSON.stringify({ id, body: content }, null, 2));
                }
                else {
                    console.log(content);
                }
                return;
            }
            catch (error) {
                if (getErrorMessage(error) !== 'Message not found') {
                    throw error;
                }
            }
        }
        const { db, cleanUp } = await getDb(opts);
        try {
            const lookup = buildMessageLookupContext(db, String(id));
            if (!lookup)
                throw new Error('Message not found');
            const content = await (0, mail_actions_js_1.getEmailBodyByLookup)(lookup);
            if (opts.json) {
                console.log(JSON.stringify({ id, body: content }, null, 2));
            }
            else {
                console.log(content);
            }
        }
        finally {
            db.close();
            if (cleanUp)
                cleanUp();
        }
    }
    catch (error) {
        handleCommandError(error, opts);
    }
});
program.command('inspect <id>')
    .description('Inspect one exact message through Mail.app')
    .action(async (id, options, command) => {
    const opts = getCommandOptions(options, command);
    try {
        const numericId = parseMessageId(id);
        const { db, cleanUp } = await getDb(opts);
        try {
            const lookup = buildMessageLookupContext(db, String(numericId));
            if (!lookup)
                throw new Error('Message not found');
            const inspected = await (0, mail_actions_js_1.inspectEmailByLookup)(lookup);
            const result = {
                id: numericId,
                messageId: inspected.messageId,
                subject: inspected.subject,
                sender: inspected.sender,
                recipients: inspected.recipients,
                dateReceived: lookup.dateReceived,
                mailbox: friendlyMailboxName(inspected.mailbox),
                body: inspected.body,
                headers: inspected.headers,
                wasRepliedTo: inspected.wasRepliedTo,
                flagIndex: inspected.flagIndex
            };
            console.log(JSON.stringify(result, null, 2));
        }
        finally {
            db.close();
            if (cleanUp)
                cleanUp();
        }
    }
    catch (error) {
        handleCommandError(error, opts);
    }
});
program.command('read <ids...>')
    .description('Read messages from the local Mail store without Mail.app')
    .option('--max-body-chars <count>', 'Return at most this many body characters per message')
    .action(async (ids, options, command) => {
    const opts = getCommandOptions(options, command);
    try {
        const numericIds = ids.map(parseMessageId);
        const maxBodyChars = options.maxBodyChars === undefined
            ? Infinity
            : parseNonNegativeIntegerOption(options.maxBodyChars, 'max-body-chars', 0);
        const { db, dbPath, cleanUp } = await getDb(opts);
        try {
            const results = await (0, local_message_js_1.readLocalMessages)(db, dbPath, numericIds, maxBodyChars);
            console.log(JSON.stringify(results.map((result) => ('error' in result ? result : { ...result, mailbox: friendlyMailboxName(result.mailbox) })), null, 2));
        }
        finally {
            db.close();
            if (cleanUp)
                cleanUp();
        }
    }
    catch (error) {
        handleCommandError(error, opts);
    }
});
program.command('set-flag <id> <color>')
    .description('Set or clear one message flag in Mail.app')
    .option('--expect-message-id <messageId>', 'Fail unless the found message carries this Message-ID')
    .option('--expect-flag-index <index>', 'Fail unless the message currently has this flag index (-1 when unflagged)')
    .action(async (id, color, options, command) => {
    const opts = getCommandOptions(options, command);
    try {
        const numericId = parseMessageId(id);
        const parsedColor = parseFlagColor(color);
        const expectedFlagIndex = parseFlagIndex(options.expectFlagIndex);
        const { db, cleanUp } = await getDb(opts);
        try {
            const lookup = buildMessageLookupContext(db, String(numericId));
            if (!lookup)
                throw new Error('Message not found');
            const flagResult = await (0, mail_actions_js_1.setEmailFlagByLookup)({ ...lookup, expectedMessageId: options.expectMessageId, expectedFlagIndex }, parsedColor);
            const result = { id: numericId, ...flagResult };
            if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
            }
            else {
                const action = flagResult.changed ? 'Updated' : 'Already set';
                console.log(`${action}: message ${numericId} flag is ${parsedColor}`);
            }
        }
        finally {
            db.close();
            if (cleanUp)
                cleanUp();
        }
    }
    catch (error) {
        handleCommandError(error, opts);
    }
});
program.command('flag-counts')
    .description('Count colored message flags without returning message content')
    .option('--inbox', 'Only messages in account inboxes')
    .action(async (localOptions, command) => {
    const opts = getCommandOptions(localOptions, command);
    try {
        const { db, cleanUp } = await getDb(opts);
        try {
            const result = (0, flag_counts_js_1.countMailFlags)(db, localOptions.inbox === true);
            if (opts.json)
                console.log(JSON.stringify(result, null, 2));
            else
                console.log((0, flag_counts_js_1.formatFlagCounts)(result));
        }
        finally {
            db.close();
            if (cleanUp)
                cleanUp();
        }
    }
    catch (error) {
        handleCommandError(error, opts);
    }
});
// Stats
program.command('stats')
    .description('Database statistics')
    .action(async (options, command) => {
    const opts = getCommandOptions(options, command);
    try {
        const { db, cleanUp } = await getDb(opts);
        try {
            // Synchronous
            const total = db.prepare('SELECT COUNT(*) as c FROM messages').get();
            const unread = db.prepare('SELECT COUNT(*) as c FROM messages WHERE read = 0 AND deleted = 0').get();
            const deleted = db.prepare('SELECT COUNT(*) as c FROM messages WHERE deleted = 1').get();
            const attachments = db.prepare('SELECT COUNT(DISTINCT message) as c FROM attachments').get();
            console.log(chalk_1.default.bold('=== Mail Database Statistics ==='));
            console.log(`Total messages: ${chalk_1.default.green(total.c)}`);
            console.log(`Unread:         ${chalk_1.default.yellow(unread.c)}`);
            console.log(`Deleted:        ${chalk_1.default.red(deleted.c)}`);
            console.log(`Attachments:    ${chalk_1.default.blue(attachments.c)}`);
        }
        finally {
            db.close();
            if (cleanUp)
                cleanUp();
        }
    }
    catch (error) {
        handleCommandError(error, opts);
    }
});
program.parseAsync(process.argv).catch((error) => {
    handleCommandError(error, program.opts());
});
