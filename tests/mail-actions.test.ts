import {
    buildLookupScript,
    getEmailBody,
    getEmailBodyByLookup,
    getEmailFlagByLookup,
    inspectEmailByLookup,
    MAIL_FLAG_INDEX,
    openEmail,
    openEmailByLookup,
    openEmailByRowId,
    setEmailFlagByLookup
} from '../src/mail-actions';
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
            mockExec.mockResolvedValue({ stdout: '__FRUITMAIL_NOT_FOUND__' });

            await expect(getEmailBody('12345')).rejects.toThrow('Message not found');
        });

        it('should throw strict error if ID is non-numeric', async () => {
            // paranoid check test
            await expect(getEmailBody('123; rm -rf /')).rejects.toThrow('Invalid message ID');
            expect(mockExec).not.toHaveBeenCalled();
        });
    });

    describe('openEmail', () => {
        it('should call osascript and search all mailboxes by document ID', async () => {
            mockExec.mockResolvedValue({ stdout: '' });

            await openEmail('msg-uuid-123');
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('repeat with accountRef in every account')
            );
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('whose message id is candidateId')
            );
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('open foundMsg')
            );
        });

        it('should throw on empty ID', async () => {
            await expect(openEmail('')).rejects.toThrow('Invalid document ID');
        });

        it('should throw "Message not found" on not-found marker', async () => {
            mockExec.mockResolvedValue({ stdout: '__FRUITMAIL_NOT_FOUND__' });
            await expect(openEmail('msg-uuid-123')).rejects.toThrow('Message not found');
        });
    });

    describe('openEmailByRowId', () => {
        it('should call osascript with correct ID', async () => {
            mockExec.mockResolvedValue({ stdout: '' });

            await openEmailByRowId('12345');
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('repeat with accountRef in every account')
            );
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('open foundMsg')
            );
        });

        it('should throw "Message not found" when AppleScript returns not found marker', async () => {
            mockExec.mockResolvedValue({ stdout: '__FRUITMAIL_NOT_FOUND__' });
            await expect(openEmailByRowId('12345')).rejects.toThrow('Message not found');
        });

        it('should throw on non-numeric ID', async () => {
            await expect(openEmailByRowId('abc')).rejects.toThrow('Invalid message ID');
        });

        it('should throw if apple script fails', async () => {
            mockExec.mockRejectedValue(new Error('Osascript failed'));
            await expect(openEmailByRowId('12345')).rejects.toThrow('Failed to open message via AppleScript');
        });
    });

    describe('lookup fallback', () => {
        it('should search by subject and sender when IDs are unavailable', async () => {
            mockExec.mockResolvedValue({ stdout: 'OK' });

            await openEmailByLookup({
                messageIdCandidates: [],
                numericIdCandidates: [],
                subject: '[Rip] REMINDER - Tomorrow Neuroscience RIP 2/18/26',
                sender: 'charlene.bloch@yale.edu'
            });

            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('whose subject is targetSubject and sender contains targetSender')
            );
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('whose subject contains targetSubject and sender contains targetSender')
            );
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('whose subject is targetSubject')
            );
        });

        it('should read body using metadata fallback lookup', async () => {
            mockExec.mockResolvedValue({ stdout: 'Email body content' });
            const result = await getEmailBodyByLookup({
                messageIdCandidates: [],
                numericIdCandidates: [],
                subject: 'Subject only',
                sender: 'sender@example.com'
            });
            expect(result).toBe('Email body content');
            expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('return content of foundMsg'));
        });
    });

    describe('inspection', () => {
        it('returns stable structured message fields', async () => {
            mockExec.mockResolvedValue({
                stdout: JSON.stringify({
                    messageId: 'message@example.com',
                    subject: 'Subject',
                    sender: 'sender@example.com',
                    recipients: ['gustavo@example.com'],
                    dateReceived: 'Friday, September 18, 2026 at 10:00:00 AM',
                    mailbox: 'Inbox',
                    body: 'Body',
                    headers: 'Message-ID: <message@example.com>',
                    wasRepliedTo: false,
                    flagIndex: -1
                })
            });

            await expect(inspectEmailByLookup({ numericIdCandidates: [123] })).resolves.toEqual({
                messageId: 'message@example.com',
                subject: 'Subject',
                sender: 'sender@example.com',
                recipients: ['gustavo@example.com'],
                dateReceived: 'Friday, September 18, 2026 at 10:00:00 AM',
                mailbox: 'Inbox',
                body: 'Body',
                headers: 'Message-ID: <message@example.com>',
                wasRepliedTo: false,
                flagIndex: -1
            });
            expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('all headers of foundMsg'));
            expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('was replied to of foundMsg'));
        });

        it('reports message-not-found without hiding it', async () => {
            mockExec.mockResolvedValue({ stdout: '__FRUITMAIL_NOT_FOUND__' });
            await expect(inspectEmailByLookup({ numericIdCandidates: [123] })).rejects.toThrow('Message not found');
        });
    });

    describe('flag mutation', () => {
        it('reads flag state without message content', async () => {
            mockExec.mockResolvedValue({ stdout: 'true|4' });
            await expect(getEmailFlagByLookup({ numericIdCandidates: [123] })).resolves.toEqual({
                flagged: true,
                flagIndex: 4
            });
            expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('return (isFlagged as text)'));
            expect(mockExec).not.toHaveBeenCalledWith(expect.stringContaining('content of foundMsg'));
        });

        it.each(Object.entries(MAIL_FLAG_INDEX))('supports %s at Mail flag index %i', async (color, index) => {
            mockExec.mockResolvedValue({ stdout: `${color}|${index}|true` });

            await expect(setEmailFlagByLookup(
                { numericIdCandidates: [123] },
                color as keyof typeof MAIL_FLAG_INDEX
            )).resolves.toEqual({ ok: true, color, flagIndex: index, changed: true });
            expect(mockExec).toHaveBeenCalledWith(expect.stringContaining(`set targetFlagIndex to ${index}`));
        });

        it('clears a flag without touching other message state', () => {
            const script = buildLookupScript({ numericIdCandidates: [123] }, 'setFlag', 'none');
            expect(script).toContain('set flagged status of foundMsg to false');
            expect(script).not.toContain('set read status');
            expect(script).not.toContain('delete foundMsg');
            expect(script).not.toContain('move foundMsg');
        });

        it('constructs an idempotent same-color check', () => {
            const script = buildLookupScript({ numericIdCandidates: [123], messageIdCandidates: ['id@example.com'] }, 'setFlag', 'purple');
            expect(script).toContain('currentFlagIndex is not targetFlagIndex');
            expect(script).toContain('set didChange to false');
            expect(script).toContain('if false and foundMsg is missing value and targetSubject is not "" then');
            expect(script).not.toContain('set exactIdMatch to false');
        });

        it('escapes AppleScript lookup strings', () => {
            const script = buildLookupScript({
                numericIdCandidates: [123],
                messageIdCandidates: ['id"with\\characters'],
                subject: 'A "quoted" \\ subject',
                sender: 'sender"@example.com'
            }, 'inspect');

            expect(script).toContain('set targetSubject to "A \\"quoted\\" \\\\ subject"');
            expect(script).toContain('set targetSender to "sender\\"@example.com"');
            expect(script).toContain('{"id\\"with\\\\characters"}');
        });

        it('reports message-not-found before any mutation result', async () => {
            mockExec.mockResolvedValue({ stdout: '__FRUITMAIL_NOT_FOUND__' });
            await expect(setEmailFlagByLookup({ numericIdCandidates: [123] }, 'red')).rejects.toThrow('Message not found');
        });
    });

});
