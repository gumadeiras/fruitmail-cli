import { findColumnByAlias, getTableColumns, MESSAGE_FLAG_FLAGGED, messageFlagIndex, quoteIdentifier } from './db-schema.js';
import { MailFlagColor } from './mail-actions.js';
import { inboxMembershipCondition } from './mailbox-scope.js';

const COLOR_NAMES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const;

export interface FlagCountsResult {
    totalMessages: number;
    flaggedMessages: number;
    colors: Record<Exclude<MailFlagColor, 'none'>, number>;
    /** Flagged messages whose color bits fall outside Mail's seven colors. */
    unresolved: number;
}

/** Counts colored flags from the Envelope Index alone; Mail.app is not consulted. */
export function countMailFlags(db: any, inboxOnly = false): FlagCountsResult {
    const columns = getTableColumns(db, 'messages');
    if (!columns.includes('flags')) throw new Error('Mail database does not expose flag state');
    const flaggedColumn = findColumnByAlias(columns, ['flagged']);
    const deletedColumn = findColumnByAlias(columns, ['deleted']);
    const activeCondition = deletedColumn ? `m.${quoteIdentifier(deletedColumn)} = 0` : '1=1';
    const flagCondition = flaggedColumn
        ? `m.${quoteIdentifier(flaggedColumn)} != 0`
        : `(m.flags & ${MESSAGE_FLAG_FLAGGED}) != 0`;
    const scopeCondition = inboxOnly ? inboxMembershipCondition(db) : '1=1';
    const totalRow = db.prepare(`SELECT COUNT(*) as count FROM messages m WHERE ${activeCondition} AND ${scopeCondition}`).get() as { count: number };
    const flaggedRows = db.prepare(`
        SELECT m.flags as flags${flaggedColumn ? `, m.${quoteIdentifier(flaggedColumn)} as flagged` : ''} FROM messages m
        WHERE ${activeCondition} AND ${scopeCondition} AND ${flagCondition}
    `).all() as Array<{ flags: unknown; flagged?: unknown }>;
    const colors: FlagCountsResult['colors'] = {
        red: 0, orange: 0, yellow: 0, green: 0, blue: 0, purple: 0, gray: 0
    };
    let unresolved = 0;
    for (const row of flaggedRows) {
        const index = messageFlagIndex(row.flags, row.flagged);
        if (index >= 0 && index < COLOR_NAMES.length) colors[COLOR_NAMES[index]] += 1;
        else unresolved += 1;
    }
    return { totalMessages: totalRow.count, flaggedMessages: flaggedRows.length, colors, unresolved };
}

export function formatFlagCounts(result: FlagCountsResult): string {
    return [
        `Flagged messages: ${result.flaggedMessages}`,
        ...COLOR_NAMES.map((color) => `${color}: ${result.colors[color]}`),
        `Unresolved: ${result.unresolved}`
    ].join('\n');
}
