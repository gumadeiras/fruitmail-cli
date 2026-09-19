import { findColumnByAlias, getTableColumns, MESSAGE_FLAG_FLAGGED, quoteIdentifier } from './db-schema.js';
import { getEmailFlagByLookup, MailFlagColor, MailLookupContext } from './mail-actions.js';
import { inboxMembershipCondition } from './mailbox-scope.js';

const COLOR_NAMES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const;

export interface FlagCountsResult {
    totalMessages: number;
    flaggedMessages: number;
    colors: Record<Exclude<MailFlagColor, 'none'>, number>;
    unresolved: number;
}

export async function countMailFlags(
    db: any,
    buildLookup: (db: any, id: string) => MailLookupContext | undefined,
    inboxOnly = false
): Promise<FlagCountsResult> {
    const columns = getTableColumns(db, 'messages');
    const flagsColumn = findColumnByAlias(columns, ['flags']);
    const flaggedColumn = findColumnByAlias(columns, ['flagged', 'is_flagged']);
    const flagColorColumn = findColumnByAlias(columns, ['flag_color']);
    if (!flagsColumn && !flaggedColumn) throw new Error('Mail database does not expose flag state');

    const deletedColumn = findColumnByAlias(columns, ['deleted']);
    const activeCondition = deletedColumn ? `m.${quoteIdentifier(deletedColumn)} = 0` : '1=1';
    const flagCondition = flaggedColumn
        ? `m.${quoteIdentifier(flaggedColumn)} != 0`
        : `(m.${quoteIdentifier(flagsColumn as string)} & ${MESSAGE_FLAG_FLAGGED}) != 0`;
    const scopeCondition = inboxOnly ? inboxMembershipCondition(db) : '1=1';
    const totalRow = db.prepare(`SELECT COUNT(*) as count FROM messages m WHERE ${activeCondition} AND ${scopeCondition}`).get() as { count: number };
    const colorSelection = flagColorColumn
        ? `, m.${quoteIdentifier(flagColorColumn)} as flagColor`
        : '';
    const flaggedRows = db.prepare(`
        SELECT m.ROWID as id${colorSelection} FROM messages m
        WHERE ${activeCondition} AND ${scopeCondition} AND ${flagCondition}
        ORDER BY m.ROWID
    `).all() as Array<{ id: number; flagColor?: number }>;
    const colors: FlagCountsResult['colors'] = {
        red: 0, orange: 0, yellow: 0, green: 0, blue: 0, purple: 0, gray: 0
    };
    let unresolved = 0;
    for (const row of flaggedRows) {
        if (Number.isInteger(row.flagColor) && row.flagColor! >= 1 && row.flagColor! <= 7) {
            colors[COLOR_NAMES[row.flagColor! - 1]] += 1;
            continue;
        }
        const lookup = buildLookup(db, String(row.id));
        if (!lookup) {
            unresolved += 1;
            continue;
        }
        try {
            const state = await getEmailFlagByLookup(lookup);
            if (state.flagged && state.flagIndex >= 0 && state.flagIndex <= 6) {
                colors[COLOR_NAMES[state.flagIndex]] += 1;
            } else {
                unresolved += 1;
            }
        } catch (error) {
            if (error instanceof Error && error.message === 'Message not found') unresolved += 1;
            else throw error;
        }
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
