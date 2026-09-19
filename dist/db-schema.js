"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quoteIdentifier = quoteIdentifier;
exports.getTableColumns = getTableColumns;
exports.findColumnByAlias = findColumnByAlias;
function quoteIdentifier(identifier) {
    return `"${identifier.replace(/"/g, '""')}"`;
}
function getTableColumns(db, tableName) {
    try {
        const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();
        return rows.map((row) => row.name);
    }
    catch {
        return [];
    }
}
function findColumnByAlias(columns, aliases) {
    const columnByLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
    for (const alias of aliases) {
        const match = columnByLower.get(alias.toLowerCase());
        if (match)
            return match;
    }
    return undefined;
}
