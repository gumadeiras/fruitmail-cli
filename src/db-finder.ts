import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Finds the Apple Mail database.
 * Logic:
 * 1. Search for ~/Library/Mail/V* folders.
 * 2. Sort by version (highest first).
 * 3. Return the first one that contains MailData/Envelope Index.
 */
export async function findDbPath(): Promise<string> {
    // Check override env var
    if (process.env.MAIL_DB) {
        return process.env.MAIL_DB;
    }

    const mailRoot = path.join(os.homedir(), 'Library/Mail');

    try {
        const entries = await fs.readdir(mailRoot, { withFileTypes: true });

        // Find V* directories
        const vDirs = entries
            .filter(e => e.isDirectory() && /^V\d+$/.test(e.name))
            .map(e => e.name)
            .sort((a, b) => {
                // Sort V10 > V9
                const verA = parseInt(a.substring(1), 10);
                const verB = parseInt(b.substring(1), 10);
                return verB - verA;
            });

        for (const vDir of vDirs) {
            const dbPath = path.join(mailRoot, vDir, 'MailData', 'Envelope Index');
            try {
                await fs.access(dbPath);
                return dbPath;
            } catch {
                continue;
            }
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EACCES' || (error as NodeJS.ErrnoException).code === 'EPERM') {
            throw new Error(`Permission denied accessing ${mailRoot}. Please grant Terminal 'Full Disk Access' in System Settings.`);
        }
    }

    // Fallback / helpful error
    throw new Error(`Could not find Mail database in ${mailRoot}. Ensure you have 'Full Disk Access' enabled.`);
}
