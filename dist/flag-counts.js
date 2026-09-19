"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.countMailFlags = countMailFlags;
exports.formatFlagCounts = formatFlagCounts;
const db_schema_js_1 = require("./db-schema.js");
const mail_actions_js_1 = require("./mail-actions.js");
const mailbox_scope_js_1 = require("./mailbox-scope.js");
const COLOR_NAMES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
async function countMailFlags(db, buildLookup, inboxOnly = false) {
    const columns = (0, db_schema_js_1.getTableColumns)(db, 'messages');
    const flagsColumn = (0, db_schema_js_1.findColumnByAlias)(columns, ['flags']);
    const flaggedColumn = (0, db_schema_js_1.findColumnByAlias)(columns, ['flagged', 'is_flagged']);
    const flagColorColumn = (0, db_schema_js_1.findColumnByAlias)(columns, ['flag_color']);
    if (!flagsColumn && !flaggedColumn)
        throw new Error('Mail database does not expose flag state');
    const deletedColumn = (0, db_schema_js_1.findColumnByAlias)(columns, ['deleted']);
    const activeCondition = deletedColumn ? `m.${(0, db_schema_js_1.quoteIdentifier)(deletedColumn)} = 0` : '1=1';
    const flagCondition = flaggedColumn
        ? `m.${(0, db_schema_js_1.quoteIdentifier)(flaggedColumn)} != 0`
        : `(m.${(0, db_schema_js_1.quoteIdentifier)(flagsColumn)} & ${db_schema_js_1.MESSAGE_FLAG_FLAGGED}) != 0`;
    const scopeCondition = inboxOnly ? (0, mailbox_scope_js_1.inboxMembershipCondition)(db) : '1=1';
    const totalRow = db.prepare(`SELECT COUNT(*) as count FROM messages m WHERE ${activeCondition} AND ${scopeCondition}`).get();
    const colorSelection = flagColorColumn
        ? `, m.${(0, db_schema_js_1.quoteIdentifier)(flagColorColumn)} as flagColor`
        : '';
    const flaggedRows = db.prepare(`
        SELECT m.ROWID as id${colorSelection} FROM messages m
        WHERE ${activeCondition} AND ${scopeCondition} AND ${flagCondition}
        ORDER BY m.ROWID
    `).all();
    const colors = {
        red: 0, orange: 0, yellow: 0, green: 0, blue: 0, purple: 0, gray: 0
    };
    let unresolved = 0;
    for (const row of flaggedRows) {
        if (Number.isInteger(row.flagColor) && row.flagColor >= 1 && row.flagColor <= 7) {
            colors[COLOR_NAMES[row.flagColor - 1]] += 1;
            continue;
        }
        const lookup = buildLookup(db, String(row.id));
        if (!lookup) {
            unresolved += 1;
            continue;
        }
        try {
            const state = await (0, mail_actions_js_1.getEmailFlagByLookup)(lookup);
            if (state.flagged && state.flagIndex >= 0 && state.flagIndex <= 6) {
                colors[COLOR_NAMES[state.flagIndex]] += 1;
            }
            else {
                unresolved += 1;
            }
        }
        catch (error) {
            if (error instanceof Error && error.message === 'Message not found')
                unresolved += 1;
            else
                throw error;
        }
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
