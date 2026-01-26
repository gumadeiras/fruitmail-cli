"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmailBody = getEmailBody;
exports.openEmail = openEmail;
exports.openEmailByRowId = openEmailByRowId;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const execAsync = (0, node_util_1.promisify)(node_child_process_1.exec);
async function getEmailBody(messageId) {
    // Paranoid Sanitization: Ensure strictly numeric ID to prevent AppleScript injection
    if (!/^\d+$/.test(messageId)) {
        throw new Error('Invalid message ID');
    }
    // Use osascript directly.
    const script = `
    tell application "Mail"
      try
        set msg to first message of inbox whose id is ${messageId}
        return content of msg
      on error
        return "ERROR_NOT_FOUND"
      end try
    end tell
  `;
    try {
        const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
        const result = stdout.trim();
        if (result === 'ERROR_NOT_FOUND') {
            throw new Error('Message not found');
        }
        return result;
    }
    catch (error) {
        if (error.message.includes('ERROR_NOT_FOUND')) {
            throw new Error('Message not found');
        }
        throw error;
    }
}
async function openEmail(documentId) {
    if (!documentId) {
        throw new Error('Invalid document ID');
    }
    // macOS specific open
    await execAsync(`open "message://%3c${documentId}%3e"`);
}
async function openEmailByRowId(messageId) {
    if (!/^\d+$/.test(messageId)) {
        throw new Error('Invalid message ID');
    }
    const script = `
    tell application "Mail"
      try
        set msg to first message of inbox whose id is ${messageId}
        open msg
        activate
      on error
        return "ERROR_NOT_FOUND"
      end try
    end tell
  `;
    try {
        await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    }
    catch (e) {
        throw new Error('Failed to open message via AppleScript');
    }
}
