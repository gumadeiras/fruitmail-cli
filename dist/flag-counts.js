"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.countMailFlags = countMailFlags;
exports.formatFlagCounts = formatFlagCounts;
const db_schema_js_1 = require("./db-schema.js");
const mailbox_scope_js_1 = require("./mailbox-scope.js");
const COLOR_NAMES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
/** Counts colored flags from the Envelope Index alone; Mail.app is not consulted. */
function countMailFlags(db, inboxOnly = false) {
    const columns = (0, db_schema_js_1.getTableColumns)(db, 'messages');
    if (!columns.includes('flags'))
        throw new Error('Mail database does not expose flag state');
    const flaggedColumn = (0, db_schema_js_1.findColumnByAlias)(columns, ['flagged']);
    const deletedColumn = (0, db_schema_js_1.findColumnByAlias)(columns, ['deleted']);
    const activeCondition = deletedColumn ? `m.${(0, db_schema_js_1.quoteIdentifier)(deletedColumn)} = 0` : '1=1';
    const flagCondition = flaggedColumn
        ? `m.${(0, db_schema_js_1.quoteIdentifier)(flaggedColumn)} != 0`
        : `(m.flags & ${db_schema_js_1.MESSAGE_FLAG_FLAGGED}) != 0`;
    const scopeCondition = inboxOnly ? (0, mailbox_scope_js_1.inboxMembershipCondition)(db) : '1=1';
    const totalRow = db.prepare(`SELECT COUNT(*) as count FROM messages m WHERE ${activeCondition} AND ${scopeCondition}`).get();
    const flaggedRows = db.prepare(`
        SELECT m.flags as flags${flaggedColumn ? `, m.${(0, db_schema_js_1.quoteIdentifier)(flaggedColumn)} as flagged` : ''} FROM messages m
        WHERE ${activeCondition} AND ${scopeCondition} AND ${flagCondition}
    `).all();
    const colors = {
        red: 0, orange: 0, yellow: 0, green: 0, blue: 0, purple: 0, gray: 0
    };
    let unresolved = 0;
    for (const row of flaggedRows) {
        const index = (0, db_schema_js_1.messageFlagIndex)(row.flags, row.flagged);
        if (index >= 0 && index < COLOR_NAMES.length)
            colors[COLOR_NAMES[index]] += 1;
        else
            unresolved += 1;
    }
    return { totalMessages: totalRow.count, flaggedMessages: flaggedRows.length, colors, unresolved };
}
function formatFlagCounts(result) {
    return [
        `Flagged messages: ${result.flaggedMessages}`,
        ...COLOR_NAMES.map((color) => `${color}: ${result.colors[color]}`),
        `Unresolved: ${result.unresolved}`
    ].join('\n');
}
