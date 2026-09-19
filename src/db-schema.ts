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
