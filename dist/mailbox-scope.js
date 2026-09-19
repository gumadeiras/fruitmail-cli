"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inboxMembershipCondition = inboxMembershipCondition;
const db_schema_js_1 = require("./db-schema.js");
function inboxMailboxPredicate(db, mailboxAlias) {
    const columns = (0, db_schema_js_1.getTableColumns)(db, 'mailboxes');
    const labelColumn = (0, db_schema_js_1.findColumnByAlias)(columns, ['url', 'display_name', 'name', 'path']);
    if (!labelColumn)
        throw new Error('Mail database does not expose mailbox identity');
    const value = `LOWER(RTRIM(COALESCE(${mailboxAlias}.${(0, db_schema_js_1.quoteIdentifier)(labelColumn)}, ''), '/'))`;
    return `(${value} = 'inbox' OR ${value} LIKE '%/inbox')`;
}
function inboxMembershipCondition(db, messageAlias = 'm') {
    const primary = `EXISTS (
        SELECT 1 FROM mailboxes inbox_primary
        WHERE inbox_primary.ROWID = ${messageAlias}.mailbox
          AND ${inboxMailboxPredicate(db, 'inbox_primary')}
    )`;
    const labelColumns = (0, db_schema_js_1.getTableColumns)(db, 'labels');
    if (!labelColumns.includes('message_id') || !labelColumns.includes('mailbox_id'))
        return primary;
    const labeled = `EXISTS (
        SELECT 1 FROM labels inbox_label
        JOIN mailboxes inbox_labeled_mailbox ON inbox_labeled_mailbox.ROWID = inbox_label.mailbox_id
        WHERE inbox_label.message_id = ${messageAlias}.ROWID
          AND ${inboxMailboxPredicate(db, 'inbox_labeled_mailbox')}
    )`;
    return `(${primary} OR ${labeled})`;
}
