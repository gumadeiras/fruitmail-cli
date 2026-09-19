"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MESSAGE_FLAG_FLAGGED = exports.MESSAGE_FLAG_ANSWERED = void 0;
exports.quoteIdentifier = quoteIdentifier;
exports.getTableColumns = getTableColumns;
exports.findColumnByAlias = findColumnByAlias;
exports.indexMessageIdOf = indexMessageIdOf;
exports.messageIsFlagged = messageIsFlagged;
exports.messageFlagIndex = messageFlagIndex;
exports.unixSecondsToIso = unixSecondsToIso;
function quoteIdentifier(identifier) {
    return `"${identifier.replace(/"/g, '""')}"`;
}
function getTableColumns(db, tableName) {
    try {
        const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();
        return rows.map((row) => row.name);
    }
    catch {
        return [];
    }
}
function findColumnByAlias(columns, aliases) {
    const columnByLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
    for (const alias of aliases) {
        const match = columnByLower.get(alias.toLowerCase());
        if (match)
            return match;
    }
    return undefined;
}
/** Preserve an Envelope Index integer identifier exactly across SQLite and JSON. */
function indexMessageIdOf(value) {
    return value === null || value === undefined ? null : String(value);
}
/** Envelope Index `messages.flags` bits that Mail keeps in sync with IMAP and Exchange state. */
exports.MESSAGE_FLAG_ANSWERED = 1 << 2;
exports.MESSAGE_FLAG_FLAGGED = 1 << 4;
/** The flag color lives in bits 39 to 41 of `flags`, numbered like Mail's AppleScript flag index (0 red to 6 gray). */
const MESSAGE_FLAG_COLOR_SHIFT = 39n;
function flagBits(flags) {
    try {
        return BigInt(String(flags));
    }
    catch {
        return undefined;
    }
}
/** Uses the `flagged` column when the index has one, otherwise the flagged bit. */
function messageIsFlagged(flags, flagged) {
    if (flagged !== undefined && flagged !== null)
        return Number(flagged) !== 0;
    const bits = flagBits(flags);
    return bits !== undefined && (bits & BigInt(exports.MESSAGE_FLAG_FLAGGED)) !== 0n;
}
/** Mail's flag index for a flagged message, or -1. */
function messageFlagIndex(flags, flagged) {
    const bits = flagBits(flags);
    if (bits === undefined || !messageIsFlagged(flags, flagged))
        return -1;
    return Number((bits >> MESSAGE_FLAG_COLOR_SHIFT) & 7n);
}
/** Envelope Index dates are Unix seconds; return ISO 8601 or an empty string for missing values. */
function unixSecondsToIso(value) {
    const seconds = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0)
        return '';
    return new Date(Math.round(seconds * 1000)).toISOString();
}
