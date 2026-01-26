import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export async function getEmailBody(messageId: string): Promise<string> {
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
  } catch (error: any) {
    if (error.message.includes('ERROR_NOT_FOUND')) {
      throw new Error('Message not found');
    }
    throw error;
  }
}

export async function openEmail(documentId: string): Promise<void> {
  if (!documentId) {
    throw new Error('Invalid document ID');
  }
  // macOS specific open
  await execAsync(`open "message://%3c${documentId}%3e"`);
}

export async function openEmailByRowId(messageId: string): Promise<void> {
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
  } catch (e: any) {
    throw new Error('Failed to open message via AppleScript');
  }
}
