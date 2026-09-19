import { findColumnByAlias, getTableColumns, quoteIdentifier } from './db-schema.js';

function inboxMailboxPredicate(db: any, mailboxAlias: string): string {
    const columns = getTableColumns(db, 'mailboxes');
    const labelColumn = findColumnByAlias(columns, ['url', 'display_name', 'name', 'path']);
    if (!labelColumn) throw new Error('Mail database does not expose mailbox identity');
    const value = `LOWER(RTRIM(COALESCE(${mailboxAlias}.${quoteIdentifier(labelColumn)}, ''), '/'))`;
    return `(${value} = 'inbox' OR ${value} LIKE '%/inbox')`;
}

export function inboxMembershipCondition(db: any, messageAlias = 'm'): string {
    const primary = `EXISTS (
        SELECT 1 FROM mailboxes inbox_primary
        WHERE inbox_primary.ROWID = ${messageAlias}.mailbox
          AND ${inboxMailboxPredicate(db, 'inbox_primary')}
    )`;
    const labelColumns = getTableColumns(db, 'labels');
    if (!labelColumns.includes('message_id') || !labelColumns.includes('mailbox_id')) return primary;
    const labeled = `EXISTS (
        SELECT 1 FROM labels inbox_label
        JOIN mailboxes inbox_labeled_mailbox ON inbox_labeled_mailbox.ROWID = inbox_label.mailbox_id
        WHERE inbox_label.message_id = ${messageAlias}.ROWID
          AND ${inboxMailboxPredicate(db, 'inbox_labeled_mailbox')}
    )`;
    return `(${primary} OR ${labeled})`;
}
