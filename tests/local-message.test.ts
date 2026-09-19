import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mailboxDirectorySegments, messageDataSegments, openEmlxMessage, parseMessageContent } from '../src/local-message';

const CRLF = '\r\n';

function multipartMessage(attachmentBytes: number): string {
    const attachment = Buffer.alloc(attachmentBytes, 0x41).toString('base64').replace(/(.{76})/g, `$1${CRLF}`);
    return [
        'Message-ID: <request@example.com>',
        'Subject: Please review',
        'From: Person <person@example.com>',
        'To: gustavo@example.com, Group: a@example.com, b@example.com;',
        'Cc: c@example.com',
        'Content-Type: multipart/mixed; boundary="B"',
        '',
        '--B',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Can you review this by tomorrow?',
        'Second line.',
        '--B',
        'Content-Type: application/octet-stream',
        'Content-Disposition: attachment; filename="large.bin"',
        'Content-Transfer-Encoding: base64',
        '',
        attachment,
        '--B--',
        ''
    ].join(CRLF);
}

function writeEmlx(directory: string, message: string, declaredLength = Buffer.byteLength(message)): string {
    const filePath = path.join(directory, '42.emlx');
    fs.writeFileSync(filePath, `${declaredLength}\n${message}<?xml version="1.0"?><plist/>`);
    return filePath;
}

describe('local message store', () => {
    let directory: string;
    beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fruitmail-local-')); });
    afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

    it('derives Mail data directory segments from the row ID', () => {
        expect(messageDataSegments(42)).toEqual([]);
        expect(messageDataSegments(159759)).toEqual(['9', '5', '1']);
        expect(mailboxDirectorySegments('imap://user@mail.example.com/INBOX/Sub%20folder')).toEqual(['INBOX.mbox', 'Sub folder.mbox']);
    });

    it('parses headers, addresses, and the text body from a streamed emlx file', async () => {
        const filePath = writeEmlx(directory, multipartMessage(1024));
        const content = await parseMessageContent(openEmlxMessage(filePath));
        expect(content.messageId).toBe('request@example.com');
        expect(content.subject).toBe('Please review');
        expect(content.sender).toBe('"Person" <person@example.com>');
        expect(content.recipients).toEqual(['gustavo@example.com', 'a@example.com', 'b@example.com', 'c@example.com']);
        expect(content.body).toBe('Can you review this by tomorrow?\nSecond line.');
        expect(content.headers).toContain('Message-ID: <request@example.com>');
        expect(content.headers).not.toContain('Can you review');
    });

    // Memory is not asserted here: a heap delta depends on collector timing. The streaming path was
    // measured directly with a 24 MB attachment and did not retain it, where simpleParser kept it whole.
    it('bounds the body and reads past a large attachment', async () => {
        const filePath = writeEmlx(directory, multipartMessage(4 * 1024 * 1024));
        const content = await parseMessageContent(openEmlxMessage(filePath), 16);
        expect(content.body).toBe('Can you review t');
        expect(content.headers).not.toContain('large.bin');
        expect(await parseMessageContent(openEmlxMessage(filePath), 0)).toMatchObject({ body: '', subject: 'Please review' });
    }, 15_000);

    it('rejects a malformed emlx prefix or a truncated file', () => {
        const message = multipartMessage(16);
        expect(() => openEmlxMessage(writeEmlx(directory, message, Buffer.byteLength(message) + 1_000_000))).toThrow('Malformed emlx file');
        fs.writeFileSync(path.join(directory, 'bad.emlx'), 'not a length\nFrom: a@example.com\n');
        expect(() => openEmlxMessage(path.join(directory, 'bad.emlx'))).toThrow('Malformed emlx file');
    });
});
