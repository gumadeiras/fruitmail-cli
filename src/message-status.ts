import { findColumnByAlias, getTableColumns, indexMessageIdOf, MESSAGE_FLAG_ANSWERED, messageFlagIndex, quoteIdentifier } from './db-schema.js';
import { inboxMembershipCondition } from './mailbox-scope.js';

/** Per-message state read from the Envelope Index alone: no message file, no Mail.app. */
export interface MessageStatus {
    id: number;
    /** Mail's flag index, -1 when unflagged. */
    flagIndex: number;
    wasRepliedTo: boolean;
    /** Whether the message still belongs to an account inbox or carries an Inbox label. */
    inInbox: boolean;
    /** The index's own integer message identifier for this row, as a string; null when the index has none. */
    indexMessageId: string | null;
}

export type MessageStatusResult = MessageStatus | { id: number; error: string };

interface IndexedStateRow {
    id: number;
    flags: unknown;
    deleted: number;
    flagged?: unknown;
    in_inbox: unknown;
    index_message_id: unknown;
}

export function readMessageStatuses(db: any, ids: number[]): MessageStatusResult[] {
    const columns = getTableColumns(db, 'messages');
    if (!columns.includes('flags')) throw new Error('Mail database does not expose flag state');
    const flaggedColumn = findColumnByAlias(columns, ['flagged']);
    const deletedColumn = findColumnByAlias(columns, ['deleted']);
    const messageIdColumn = columns.includes('message_id') ? 'message_id' : undefined;
    const rows = new Map<number, IndexedStateRow>();
    if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(', ');
        const found = db.prepare(`
            SELECT m.ROWID as id, m.flags as flags,
                   ${deletedColumn ? `m.${quoteIdentifier(deletedColumn)}` : '0'} as deleted,
                   ${flaggedColumn ? `m.${quoteIdentifier(flaggedColumn)}` : 'NULL'} as flagged,
                   ${messageIdColumn ? `m.${quoteIdentifier(messageIdColumn)}` : 'NULL'} as index_message_id,
                   (${inboxMembershipCondition(db)}) as in_inbox
            FROM messages m
            WHERE m.ROWID IN (${placeholders})
        `).all(ids) as IndexedStateRow[];
        for (const row of found) rows.set(row.id, row);
    }
    return ids.map((id) => {
        const row = rows.get(id);
        if (!row || Number(row.deleted) !== 0) return { id, error: 'Message not found' };
        return {
            id,
            flagIndex: messageFlagIndex(row.flags, row.flagged),
            wasRepliedTo: (Number(row.flags) & MESSAGE_FLAG_ANSWERED) !== 0,
            inInbox: Number(row.in_inbox) === 1,
            indexMessageId: indexMessageIdOf(row.index_message_id)
        };
    });
}
