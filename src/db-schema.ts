export function quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
}

export function getTableColumns(db: any, tableName: string): string[] {
    try {
        const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as Array<{ name: string }>;
        return rows.map((row) => row.name);
    } catch {
        return [];
    }
}

export function findColumnByAlias(columns: string[], aliases: string[]): string | undefined {
    const columnByLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
    for (const alias of aliases) {
        const match = columnByLower.get(alias.toLowerCase());
        if (match) return match;
    }
    return undefined;
}

/** Envelope Index `messages.flags` bits that Mail keeps in sync with IMAP and Exchange state. */
export const MESSAGE_FLAG_ANSWERED = 1 << 2;
export const MESSAGE_FLAG_FLAGGED = 1 << 4;

/** Envelope Index dates are Unix seconds; return ISO 8601 or an empty string for missing values. */
export function unixSecondsToIso(value: unknown): string {
    const seconds = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    return new Date(Math.round(seconds * 1000)).toISOString();
}
