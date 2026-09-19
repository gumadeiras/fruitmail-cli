"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readMessageStatuses = readMessageStatuses;
const db_schema_js_1 = require("./db-schema.js");
const mailbox_scope_js_1 = require("./mailbox-scope.js");
function readMessageStatuses(db, ids) {
    const columns = (0, db_schema_js_1.getTableColumns)(db, 'messages');
    if (!columns.includes('flags'))
        throw new Error('Mail database does not expose flag state');
    const flaggedColumn = (0, db_schema_js_1.findColumnByAlias)(columns, ['flagged']);
    const deletedColumn = (0, db_schema_js_1.findColumnByAlias)(columns, ['deleted']);
    const messageIdColumn = columns.includes('message_id') ? 'message_id' : undefined;
    const rows = new Map();
    if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(', ');
        const found = db.prepare(`
            SELECT m.ROWID as id, m.flags as flags,
                   ${deletedColumn ? `m.${(0, db_schema_js_1.quoteIdentifier)(deletedColumn)}` : '0'} as deleted,
                   ${flaggedColumn ? `m.${(0, db_schema_js_1.quoteIdentifier)(flaggedColumn)}` : 'NULL'} as flagged,
                   ${messageIdColumn ? `m.${(0, db_schema_js_1.quoteIdentifier)(messageIdColumn)}` : 'NULL'} as index_message_id,
                   (${(0, mailbox_scope_js_1.inboxMembershipCondition)(db)}) as in_inbox
            FROM messages m
            WHERE m.ROWID IN (${placeholders})
        `).all(ids);
        for (const row of found)
            rows.set(row.id, row);
    }
    return ids.map((id) => {
        const row = rows.get(id);
        if (!row || Number(row.deleted) !== 0)
            return { id, error: 'Message not found' };
        return {
            id,
            flagIndex: (0, db_schema_js_1.messageFlagIndex)(row.flags, row.flagged),
            wasRepliedTo: (Number(row.flags) & db_schema_js_1.MESSAGE_FLAG_ANSWERED) !== 0,
            inInbox: Number(row.in_inbox) === 1,
            indexMessageId: (0, db_schema_js_1.indexMessageIdOf)(row.index_message_id)
        };
    });
}
