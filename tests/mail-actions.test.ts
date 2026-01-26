import { getEmailBody, openEmail, openEmailByRowId } from '../src/mail-actions';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

// Mock exec
jest.mock('node:child_process', () => ({
    exec: jest.fn(),
}));

jest.mock('node:util', () => ({
    promisify: (fn: any) => fn,
}));

describe('Mail Actions', () => {
    const mockExec = exec as unknown as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getEmailBody', () => {
        it('should return content when found', async () => {
            mockExec.mockResolvedValue({ stdout: 'Email Content' });

            const result = await getEmailBody('12345');
            expect(result).toBe('Email Content');
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('tell application "Mail"')
            );
        });

        it('should throw "Message not found" on AppleScript error string', async () => {
            mockExec.mockResolvedValue({ stdout: 'ERROR_NOT_FOUND' });

            await expect(getEmailBody('12345')).rejects.toThrow('Message not found');
        });

        it('should throw strict error if ID is non-numeric', async () => {
            // paranoid check test
            await expect(getEmailBody('123; rm -rf /')).rejects.toThrow('Invalid message ID');
            expect(mockExec).not.toHaveBeenCalled();
        });
    });

    describe('openEmail', () => {
        it('should call open command with correct URI', async () => {
            mockExec.mockResolvedValue({ stdout: '' });

            await openEmail('msg-uuid-123');
            expect(mockExec).toHaveBeenCalledWith(
                'open "message://%3cmsg-uuid-123%3e"'
            );
        });

        it('should throw on empty ID', async () => {
            await expect(openEmail('')).rejects.toThrow('Invalid document ID');
        });
    });

    describe('openEmailByRowId', () => {
        it('should call osascript with correct ID', async () => {
            mockExec.mockResolvedValue({ stdout: '' });

            await openEmailByRowId('12345');
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('first message of inbox whose id is 12345')
            );
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('open msg')
            );
        });

        it('should throw on non-numeric ID', async () => {
            await expect(openEmailByRowId('abc')).rejects.toThrow('Invalid message ID');
        });

        it('should throw if apple script fails', async () => {
            mockExec.mockRejectedValue(new Error('Osascript failed'));
            await expect(openEmailByRowId('12345')).rejects.toThrow('Failed to open message via AppleScript');
        });
    });
});
