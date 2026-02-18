import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const NOT_FOUND_SENTINEL = '__FRUITMAIL_NOT_FOUND__';
const SCRIPT_ERROR_SENTINEL = '__FRUITMAIL_SCRIPT_ERROR__';

export interface MailLookupContext {
  numericIdCandidates?: number[];
  messageIdCandidates?: string[];
  mailboxHints?: string[];
  subject?: string;
  sender?: string;
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function toAppleScriptStringList(values: string[]): string {
  return `{${values.map((value) => `"${escapeAppleScriptString(value)}"`).join(', ')}}`;
}

function toAppleScriptNumberList(values: number[]): string {
  return `{${values.map((value) => `${value}`).join(', ')}}`;
}

function normalizeLookupContext(context: MailLookupContext): Required<MailLookupContext> {
  const messageIdCandidates = Array.from(new Set(
    (context.messageIdCandidates ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  ));

  const mailboxHints = Array.from(new Set(
    (context.mailboxHints ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  ));

  const numericIdCandidates = Array.from(new Set(
    (context.numericIdCandidates ?? [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  ));

  return {
    messageIdCandidates,
    mailboxHints,
    numericIdCandidates,
    subject: (context.subject ?? '').trim(),
    sender: (context.sender ?? '').trim()
  };
}

function buildLookupScript(context: MailLookupContext, mode: 'open' | 'body'): string {
  const normalized = normalizeLookupContext(context);
  const escapedSubject = escapeAppleScriptString(normalized.subject);
  const escapedSender = escapeAppleScriptString(normalized.sender);
  const mailboxHintsList = toAppleScriptStringList(normalized.mailboxHints);
  const messageIdCandidatesList = toAppleScriptStringList(normalized.messageIdCandidates);
  const numericIdCandidatesList = toAppleScriptNumberList(normalized.numericIdCandidates);

  return `
    tell application "Mail"
      try
        set foundMsg to missing value
        set targetSubject to "${escapedSubject}"
        set targetSender to "${escapedSender}"
        set mailboxHints to ${mailboxHintsList}
        set messageIdCandidates to ${messageIdCandidatesList}
        set numericIdCandidates to ${numericIdCandidatesList}
        set mailboxRefs to {}
        set hintedMailboxRefs to {}

        repeat with accountRef in every account
          try
            repeat with accountMailbox in every mailbox of accountRef
              set end of mailboxRefs to accountMailbox
            end repeat
          end try
        end repeat

        try
          repeat with rootMailbox in every mailbox
            set end of mailboxRefs to rootMailbox
          end repeat
        end try

        if (count of mailboxHints) > 0 then
          repeat with mailboxRef in mailboxRefs
            set mailboxLabel to ""
            try
              set mailboxLabel to (name of mailboxRef as text)
            end try
            if mailboxLabel is not "" then
              repeat with hintRef in mailboxHints
                set hintText to hintRef as text
                if hintText is not "" then
                  if mailboxLabel contains hintText or hintText contains mailboxLabel then
                    set end of hintedMailboxRefs to mailboxRef
                    exit repeat
                  end if
                end if
              end repeat
            end if
          end repeat
        end if

        if (count of hintedMailboxRefs) > 0 then
          set mailboxRefs to hintedMailboxRefs
        end if

        repeat with candidateText in messageIdCandidates
          set candidateId to candidateText as text
          if candidateId is not "" then
            repeat with mailboxRef in mailboxRefs
              try
                set foundMsg to first message of mailboxRef whose message id is candidateId
                exit repeat
              end try
              try
                set foundMsg to first message of mailboxRef whose message id is "<" & candidateId & ">"
                exit repeat
              end try
            end repeat
            if foundMsg is not missing value then exit repeat
          end if
        end repeat

        if foundMsg is missing value then
          repeat with candidateNumeric in numericIdCandidates
            if candidateNumeric is greater than 0 then
              repeat with mailboxRef in mailboxRefs
                try
                  set foundMsg to first message of mailboxRef whose id is candidateNumeric
                  exit repeat
                end try
              end repeat
              if foundMsg is not missing value then exit repeat
            end if
          end repeat
        end if

        if foundMsg is missing value and targetSubject is not "" then
          repeat with mailboxRef in mailboxRefs
            try
              if targetSender is not "" then
                set foundMsg to first message of mailboxRef whose subject is targetSubject and sender contains targetSender
              else
                set foundMsg to first message of mailboxRef whose subject is targetSubject
              end if
              exit repeat
            end try
            try
              set foundMsg to first message of mailboxRef whose subject is targetSubject
              exit repeat
            end try
            try
              if targetSender is not "" then
                set foundMsg to first message of mailboxRef whose subject contains targetSubject and sender contains targetSender
              else
                set foundMsg to first message of mailboxRef whose subject contains targetSubject
              end if
              exit repeat
            end try
            try
              set foundMsg to first message of mailboxRef whose subject contains targetSubject
              exit repeat
            end try
          end repeat
        end if

        if foundMsg is missing value then
          return "${NOT_FOUND_SENTINEL}"
        end if

        ${mode === 'body' ? 'return content of foundMsg' : 'open foundMsg\n        activate\n        return "OK"'}
      on error errMsg number errNum
        return "${SCRIPT_ERROR_SENTINEL}" & errNum & ":" & errMsg
      end try
    end tell
  `;
}

async function runLookupScript(context: MailLookupContext, mode: 'open' | 'body'): Promise<string> {
  const script = buildLookupScript(context, mode);
  try {
    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    const output = stdout.trim();
    if (output === NOT_FOUND_SENTINEL) {
      throw new Error('Message not found');
    }
    if (output.startsWith(SCRIPT_ERROR_SENTINEL)) {
      throw new Error(`Mail AppleScript error: ${output.replace(SCRIPT_ERROR_SENTINEL, '')}`);
    }
    return output;
  } catch (error: any) {
    if (error.message === 'Message not found' || error.message.includes(NOT_FOUND_SENTINEL)) {
      throw new Error('Message not found');
    }
    throw error;
  }
}

export async function getEmailBodyByLookup(context: MailLookupContext): Promise<string> {
  try {
    return await runLookupScript(context, 'body');
  } catch (error: any) {
    if (error.message === 'Message not found') {
      throw error;
    }
    throw new Error('Failed to fetch message body via AppleScript');
  }
}

export async function openEmailByLookup(context: MailLookupContext): Promise<void> {
  try {
    await runLookupScript(context, 'open');
  } catch (error: any) {
    if (error.message === 'Message not found') {
      throw error;
    }
    throw new Error('Failed to open message via AppleScript');
  }
}

// Backwards-compatible wrappers
export async function getEmailBody(messageId: string): Promise<string> {
  if (!/^\d+$/.test(messageId)) {
    throw new Error('Invalid message ID');
  }
  return getEmailBodyByLookup({
    numericIdCandidates: [parseInt(messageId, 10)]
  });
}

export async function openEmail(documentId: string): Promise<void> {
  if (!documentId) {
    throw new Error('Invalid document ID');
  }
  try {
    await openEmailByLookup({
      messageIdCandidates: [documentId.replace(/^<|>$/g, '')]
    });
  } catch (error: any) {
    if (error.message === 'Message not found') {
      throw error;
    }
    throw new Error('Failed to open message via document ID');
  }
}

export async function openEmailByRowId(messageId: string): Promise<void> {
  if (!/^\d+$/.test(messageId)) {
    throw new Error('Invalid message ID');
  }
  try {
    await openEmailByLookup({
      numericIdCandidates: [parseInt(messageId, 10)]
    });
  } catch (error: any) {
    if (error.message === 'Message not found') {
      throw error;
    }
    throw new Error('Failed to open message via AppleScript');
  }
}
