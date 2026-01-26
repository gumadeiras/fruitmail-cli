import { findDbPath } from '../src/db-finder';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

jest.mock('node:fs/promises');
jest.mock('node:os');

describe('DB Finder', () => {
    const mockReaddir = fs.readdir as jest.Mock;
    const mockAccess = fs.access as jest.Mock;
    const mockHomedir = os.homedir as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockHomedir.mockReturnValue('/Users/testuser');
        process.env.MAIL_DB = ''; // Clear env override
    });

    afterAll(() => {
        process.env.MAIL_DB = '';
    });

    it('should use MAIL_DB env var if set', async () => {
        process.env.MAIL_DB = '/custom/path/Envelope Index';
        const result = await findDbPath();
        expect(result).toBe('/custom/path/Envelope Index');
    });

    it('should find the highest version V-folder containing Envelope Index', async () => {
        mockReaddir.mockResolvedValue([
            { name: 'V9', isDirectory: () => true },
            { name: 'V2', isDirectory: () => true }, // Old stuff
            { name: 'V10', isDirectory: () => true }, // Target
            { name: 'Random', isDirectory: () => true },
            { name: 'file.txt', isDirectory: () => false },
        ] as any);

        // Mock access: Succeed for V10, Fail for V9 (to test priority, actually V10 is checked first due to sort)
        // The code sorts V10 > V9. So it checks V10 first.
        mockAccess.mockImplementation(async (p: string) => {
            if (p.includes('V10')) return Promise.resolve();
            return Promise.reject(new Error('ENOENT'));
        });

        const result = await findDbPath();
        expect(result).toBe(path.join('/Users/testuser', 'Library/Mail/V10/MailData/Envelope Index'));
    });

    it('should fall back to V9 if V10 is missing the file', async () => {
        mockReaddir.mockResolvedValue([
            { name: 'V9', isDirectory: () => true },
            { name: 'V10', isDirectory: () => true },
        ] as any);

        mockAccess.mockImplementation(async (p: string) => {
            if (p.includes('V10')) return Promise.reject(new Error('ENOENT'));
            if (p.includes('V9')) return Promise.resolve();
            return Promise.reject(new Error('ENOENT'));
        });

        const result = await findDbPath();
        expect(result).toBe(path.join('/Users/testuser', 'Library/Mail/V9/MailData/Envelope Index'));
    });

    it('should throw nice error on permission denied', async () => {
        const err: any = new Error('EACCES');
        err.code = 'EACCES';
        mockReaddir.mockRejectedValue(err);

        await expect(findDbPath()).rejects.toThrow('Permission denied');
    });

    it('should throw if no DB found', async () => {
        mockReaddir.mockResolvedValue([]);
        await expect(findDbPath()).rejects.toThrow('Could not find Mail database');
    });
});
