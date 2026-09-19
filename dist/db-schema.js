"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MESSAGE_FLAG_FLAGGED = exports.MESSAGE_FLAG_ANSWERED = void 0;
exports.quoteIdentifier = quoteIdentifier;
exports.getTableColumns = getTableColumns;
exports.findColumnByAlias = findColumnByAlias;
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
/** Envelope Index `messages.flags` bits that Mail keeps in sync with IMAP and Exchange state. */
exports.MESSAGE_FLAG_ANSWERED = 1 << 2;
exports.MESSAGE_FLAG_FLAGGED = 1 << 4;
/** Envelope Index dates are Unix seconds; return ISO 8601 or an empty string for missing values. */
function unixSecondsToIso(value) {
    const seconds = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0)
        return '';
    return new Date(Math.round(seconds * 1000)).toISOString();
}
