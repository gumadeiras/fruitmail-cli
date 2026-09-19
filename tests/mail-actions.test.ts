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
import { execFile } from 'node:child_process';

jest.mock('node:child_process', () => ({
    execFile: jest.fn(),
}));

describe('Mail Actions', () => {
    const mockExecFile = execFile as unknown as jest.Mock;
    const fakeChild = { kill: jest.fn() };

    function mailReturns(stdout: string) {
        mockExecFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: Function) => {
            callback(null, stdout, '');
            return fakeChild;
        });
    }

    function mailFails(message: string) {
        mockExecFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: Function) => {
            callback(new Error(message), '', '');
            return fakeChild;
        });
    }

    function lastScript(): string {
        const call = mockExecFile.mock.calls.at(-1);
        expect(call?.[0]).toBe('osascript');
        expect(call?.[1][0]).toBe('-e');
        return call?.[1][1] as string;
    }

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getEmailBody', () => {
        it('should return content when found', async () => {
            mailReturns('Email Content');

            const result = await getEmailBody('12345');
            expect(result).toBe('Email Content');
            expect(lastScript()).toContain('tell application "Mail"');
            expect(lastScript()).toContain('return content of foundMsg');
        });

        it('should throw "Message not found" on AppleScript error string', async () => {
            mailReturns('__FRUITMAIL_NOT_FOUND__');

            await expect(getEmailBody('12345')).rejects.toThrow('Message not found');
        });

        it('should throw strict error if ID is non-numeric', async () => {
            await expect(getEmailBody('123; rm -rf /')).rejects.toThrow('Invalid message ID');
            expect(mockExecFile).not.toHaveBeenCalled();
        });
    });

    describe('openEmail', () => {
        it('should search all mailboxes by document ID', async () => {
            mailReturns('OK');

            await openEmail('msg-uuid-123');
            expect(lastScript()).toContain('repeat with accountRef in every account');
            expect(lastScript()).toContain('whose message id is candidateId');
            expect(lastScript()).toContain('open foundMsg');
        });

        it('should throw on empty ID', async () => {
            await expect(openEmail('')).rejects.toThrow('Invalid document ID');
        });

        it('should throw "Message not found" on not-found marker', async () => {
            mailReturns('__FRUITMAIL_NOT_FOUND__');
            await expect(openEmail('msg-uuid-123')).rejects.toThrow('Message not found');
        });
    });

    describe('openEmailByRowId', () => {
        it('should resolve the row ID directly before any search', async () => {
            mailReturns('OK');

            await openEmailByRowId('12345');
            expect(lastScript()).toContain('set numericIdCandidates to {12345}');
            expect(lastScript()).toContain('«class mssg» id candidateId of mailboxRef');
            expect(lastScript()).toContain('open foundMsg');
        });

        it('should throw "Message not found" when AppleScript returns not found marker', async () => {
            mailReturns('__FRUITMAIL_NOT_FOUND__');
            await expect(openEmailByRowId('12345')).rejects.toThrow('Message not found');
        });

        it('should throw on non-numeric ID', async () => {
            await expect(openEmailByRowId('abc')).rejects.toThrow('Invalid message ID');
        });

        it('should throw if apple script fails', async () => {
            mailFails('Osascript failed');
            await expect(openEmailByRowId('12345')).rejects.toThrow('Failed to open message via AppleScript');
        });
    });

    describe('lookup order', () => {
        it('searches hinted mailboxes before the rest and never only the hinted ones', () => {
            const script = buildLookupScript({ numericIdCandidates: [123], mailboxHints: ['Inbox'] }, 'inspect');
            expect(script).toContain('set orderedMailboxRefs to hintedMailboxRefs & otherMailboxRefs');
            expect(script).toContain('if (id of candidateMsg) is candidateId then');
        });

        it('should search by subject and sender when IDs are unavailable', async () => {
            mailReturns('OK');

            await openEmailByLookup({
                messageIdCandidates: [],
                numericIdCandidates: [],
                subject: '[Rip] REMINDER - Tomorrow Neuroscience RIP 2/18/26',
                sender: 'charlene.bloch@yale.edu'
            });

            expect(lastScript()).toContain('whose subject is targetSubject and sender contains targetSender');
            expect(lastScript()).toContain('whose subject contains targetSubject and sender contains targetSender');
            expect(lastScript()).toContain('whose subject is targetSubject');
        });

        it('should read body using metadata fallback lookup', async () => {
            mailReturns('Email body content');
            const result = await getEmailBodyByLookup({
                messageIdCandidates: [],
                numericIdCandidates: [],
                subject: 'Subject only',
                sender: 'sender@example.com'
            });
            expect(result).toBe('Email body content');
            expect(lastScript()).toContain('return content of foundMsg');
        });

        it('exact modes resolve only by row ID', () => {
            for (const mode of ['inspect', 'readFlag', 'setFlag'] as const) {
                const script = buildLookupScript({ numericIdCandidates: [123], messageIdCandidates: ['id@example.com'], subject: 'S' }, mode, 'red');
                expect(script).toContain('«class mssg» id candidateId of mailboxRef');
                expect(script).not.toContain('whose message id is');
                expect(script).not.toContain('whose subject');
                expect(script).not.toContain('whose id is');
            }
        });

        it('verifies an expected Message-ID before acting', () => {
            const script = buildLookupScript({ numericIdCandidates: [123], expectedMessageId: '<id@example.com>' }, 'setFlag', 'red');
            expect(script).toContain('set expectedMessageId to "id@example.com"');
            expect(script.indexOf('__FRUITMAIL_IDENTITY_MISMATCH__')).toBeLessThan(script.indexOf('set targetFlagIndex to 0'));
        });
    });

    describe('inspection', () => {
        it('returns stable structured message fields', async () => {
            mailReturns(JSON.stringify({
                messageId: 'message@example.com',
                subject: 'Subject',
                sender: 'sender@example.com',
                recipients: ['gustavo@example.com'],
                mailbox: 'Inbox',
                body: 'Body',
                headers: 'Message-ID: <message@example.com>',
                wasRepliedTo: false,
                flagIndex: -1
            }));

            await expect(inspectEmailByLookup({ numericIdCandidates: [123] })).resolves.toEqual({
                messageId: 'message@example.com',
                subject: 'Subject',
                sender: 'sender@example.com',
                recipients: ['gustavo@example.com'],
                mailbox: 'Inbox',
                body: 'Body',
                headers: 'Message-ID: <message@example.com>',
                wasRepliedTo: false,
                flagIndex: -1
            });
            expect(lastScript()).toContain('all headers of foundMsg');
            expect(lastScript()).toContain('was replied to of foundMsg');
            expect(lastScript()).not.toContain('date received');
        });

        it('reports message-not-found without hiding it', async () => {
            mailReturns('__FRUITMAIL_NOT_FOUND__');
            await expect(inspectEmailByLookup({ numericIdCandidates: [123] })).rejects.toThrow('Message not found');
        });

        it('reports a malformed response distinctly', async () => {
            mailReturns('not json');
            await expect(inspectEmailByLookup({ numericIdCandidates: [123] })).rejects.toThrow('Malformed Mail inspection response');
        });
    });

    describe('flag mutation', () => {
        it('reads flag state without message content', async () => {
            mailReturns('true|4');
            await expect(getEmailFlagByLookup({ numericIdCandidates: [123] })).resolves.toEqual({
                flagged: true,
                flagIndex: 4
            });
            expect(lastScript()).toContain('return (isFlagged as text)');
            expect(lastScript()).not.toContain('content of foundMsg');
        });

        it.each(Object.entries(MAIL_FLAG_INDEX))('supports %s at Mail flag index %i', async (color, index) => {
            mailReturns(`${color}|${index}|true|2`);

            await expect(setEmailFlagByLookup(
                { numericIdCandidates: [123] },
                color as keyof typeof MAIL_FLAG_INDEX
            )).resolves.toEqual({ ok: true, color, flagIndex: index, previousFlagIndex: 2, changed: true });
            expect(lastScript()).toContain(`set targetFlagIndex to ${index}`);
        });

        it('clears a flag without touching other message state', () => {
            const script = buildLookupScript({ numericIdCandidates: [123] }, 'setFlag', 'none');
            expect(script).toContain('set flagged status of foundMsg to false');
            expect(script).not.toContain('set read status');
            expect(script).not.toContain('delete foundMsg');
            expect(script).not.toContain('move foundMsg');
        });

        it('constructs an idempotent same-color check that reports the previous index', () => {
            const script = buildLookupScript({ numericIdCandidates: [123] }, 'setFlag', 'purple');
            expect(script).toContain('currentFlagIndex is not targetFlagIndex');
            expect(script).toContain('set didChange to false');
            expect(script).toContain('& "|" & currentFlagIndex');
        });

        it('escapes AppleScript lookup strings', () => {
            const script = buildLookupScript({
                numericIdCandidates: [123],
                messageIdCandidates: ['id"with\\characters'],
                subject: 'A "quoted" \\ subject',
                sender: 'sender"@example.com',
                expectedMessageId: 'expect"ed@example.com'
            }, 'body');

            expect(script).toContain('set targetSubject to "A \\"quoted\\" \\\\ subject"');
            expect(script).toContain('set targetSender to "sender\\"@example.com"');
            expect(script).toContain('{"id\\"with\\\\characters"}');
            expect(script).toContain('set expectedMessageId to "expect\\"ed@example.com"');
        });

        it('reports message-not-found before any mutation result', async () => {
            mailReturns('__FRUITMAIL_NOT_FOUND__');
            await expect(setEmailFlagByLookup({ numericIdCandidates: [123] }, 'red')).rejects.toThrow('Message not found');
        });

        it('reports an identity mismatch instead of mutating', async () => {
            mailReturns('__FRUITMAIL_IDENTITY_MISMATCH__');
            await expect(setEmailFlagByLookup({ numericIdCandidates: [123], expectedMessageId: 'a@example.com' }, 'red'))
                .rejects.toThrow('Message identity mismatch');
        });

        it('rejects a malformed flag response', async () => {
            mailReturns('red|0|true');
            await expect(setEmailFlagByLookup({ numericIdCandidates: [123] }, 'red')).rejects.toThrow('Malformed Mail flag response');
        });
    });

    it('runs osascript without a shell and with a large output limit', async () => {
        mailReturns('Email Content');
        await getEmailBody('1');
        const [file, args, options] = mockExecFile.mock.calls[0];
        expect(file).toBe('osascript');
        expect(args).toHaveLength(2);
        expect(options.maxBuffer).toBeGreaterThanOrEqual(64 * 1024 * 1024);
    });
});
