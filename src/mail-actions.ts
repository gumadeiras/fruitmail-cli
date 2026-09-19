import { type ChildProcess, execFile } from 'node:child_process';

const NOT_FOUND_SENTINEL = '__FRUITMAIL_NOT_FOUND__';
const IDENTITY_MISMATCH_SENTINEL = '__FRUITMAIL_IDENTITY_MISMATCH__';
const SCRIPT_ERROR_SENTINEL = '__FRUITMAIL_SCRIPT_ERROR__';
const OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;

export const MAIL_FLAG_INDEX = {
  red: 0,
  orange: 1,
  yellow: 2,
  green: 3,
  blue: 4,
  purple: 5,
  gray: 6,
  none: -1
} as const;

export type MailFlagColor = keyof typeof MAIL_FLAG_INDEX;

export interface InspectedMailMessage {
  messageId: string;
  subject: string;
  sender: string;
  recipients: string[];
  mailbox: string;
  body: string;
  headers: string;
  wasRepliedTo: boolean;
  flagIndex: number;
}

export interface SetMailFlagResult {
  ok: true;
  color: MailFlagColor;
  flagIndex: number;
  previousFlagIndex: number;
  changed: boolean;
}

export interface MailLookupContext {
  numericIdCandidates?: number[];
  messageIdCandidates?: string[];
  mailboxHints?: string[];
  subject?: string;
  sender?: string;
  /** When set, the found message must carry this Message-ID or the lookup reports an identity mismatch. */
  expectedMessageId?: string;
}

type LookupMode = 'open' | 'body' | 'inspect' | 'setFlag';

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
  const unique = (values: string[] | undefined) => Array.from(new Set(
    (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0)
  ));
  const numericIdCandidates = Array.from(new Set(
    (context.numericIdCandidates ?? [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  ));

  return {
    messageIdCandidates: unique(context.messageIdCandidates),
    mailboxHints: unique(context.mailboxHints),
    numericIdCandidates,
    subject: (context.subject ?? '').trim(),
    sender: (context.sender ?? '').trim(),
    expectedMessageId: (context.expectedMessageId ?? '').trim().replace(/^<|>$/g, '')
  };
}

function inspectResultScript(): string {
  return `
        set messageIdValue to ""
        set subjectValue to ""
        set senderValue to ""
        set recipientValues to {}
        set mailboxValue to ""
        set bodyValue to ""
        set headersValue to ""
        set wasRepliedToValue to false
        set flagIndexValue to -1

        try
          set messageIdValue to message id of foundMsg as text
        end try
        try
          set subjectValue to subject of foundMsg as text
        end try
        try
          set senderValue to sender of foundMsg as text
        end try
        try
          repeat with recipientRef in (every to recipient of foundMsg)
            set end of recipientValues to address of recipientRef as text
          end repeat
          repeat with recipientRef in (every cc recipient of foundMsg)
            set end of recipientValues to address of recipientRef as text
          end repeat
          repeat with recipientRef in (every bcc recipient of foundMsg)
            set end of recipientValues to address of recipientRef as text
          end repeat
        end try
        try
          set mailboxValue to name of mailbox of foundMsg as text
        end try
        try
          set bodyValue to content of foundMsg as text
        end try
        try
          set headersValue to all headers of foundMsg as text
        end try
        try
          set wasRepliedToValue to was replied to of foundMsg as boolean
        end try
        try
          if flagged status of foundMsg then
            set flagIndexValue to flag index of foundMsg as integer
          end if
        end try

        return my makeInspectionJson(messageIdValue, subjectValue, senderValue, recipientValues, mailboxValue, bodyValue, headersValue, wasRepliedToValue, flagIndexValue)`;
}

function setFlagResultScript(color: MailFlagColor): string {
  const flagIndex = MAIL_FLAG_INDEX[color];
  return `
        set targetFlagIndex to ${flagIndex}
        set didChange to false
        set currentFlagIndex to -1
        set isCurrentlyFlagged to flagged status of foundMsg
        if isCurrentlyFlagged then
          try
            set currentFlagIndex to flag index of foundMsg as integer
          end try
        end if

        if targetFlagIndex is -1 then
          if isCurrentlyFlagged then
            set flagged status of foundMsg to false
            set didChange to true
          end if
        else if (not isCurrentlyFlagged) or currentFlagIndex is not targetFlagIndex then
          set flag index of foundMsg to targetFlagIndex
          set flagged status of foundMsg to true
          set didChange to true
        end if

        return "${color}|${flagIndex}|" & (didChange as text) & "|" & currentFlagIndex`;
}

/**
 * Search fallbacks for `open` and `body`, which accept document IDs and
 * subject text. Exact modes never use them: a message that the row ID does not
 * resolve is gone or moved, and guessing would defeat the identity check.
 */
function searchFallbackScript(): string {
  return `
        if foundMsg is missing value then
          repeat with candidateText in messageIdCandidates
            set candidateId to candidateText as text
            if candidateId is not "" then
              repeat with mailboxRef in orderedMailboxRefs
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
        end if

        if foundMsg is missing value and targetSubject is not "" then
          repeat with mailboxRef in orderedMailboxRefs
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
        end if`;
}

export function buildLookupScript(context: MailLookupContext, mode: LookupMode, color?: MailFlagColor): string {
  const normalized = normalizeLookupContext(context);
  const exactOnly = mode === 'inspect' || mode === 'setFlag';

  if (mode === 'setFlag' && !color) {
    throw new Error('Flag color is required');
  }

  const action = mode === 'body'
    ? 'return content of foundMsg'
    : mode === 'open'
      ? 'open foundMsg\n        activate\n        return "OK"'
      : mode === 'inspect'
        ? inspectResultScript()
        : setFlagResultScript(color as MailFlagColor);

  const inspectionSupport = mode === 'inspect' ? `
    use framework "Foundation"
    use scripting additions

    on makeInspectionJson(messageIdValue, subjectValue, senderValue, recipientValues, mailboxValue, bodyValue, headersValue, wasRepliedToValue, flagIndexValue)
      set payload to current application's NSMutableDictionary's dictionary()
      payload's setObject:messageIdValue forKey:"messageId"
      payload's setObject:subjectValue forKey:"subject"
      payload's setObject:senderValue forKey:"sender"
      payload's setObject:(current application's NSArray's arrayWithArray:recipientValues) forKey:"recipients"
      payload's setObject:mailboxValue forKey:"mailbox"
      payload's setObject:bodyValue forKey:"body"
      payload's setObject:headersValue forKey:"headers"
      payload's setObject:(current application's NSNumber's numberWithBool:wasRepliedToValue) forKey:"wasRepliedTo"
      payload's setObject:(current application's NSNumber's numberWithInteger:flagIndexValue) forKey:"flagIndex"
      set jsonData to current application's NSJSONSerialization's dataWithJSONObject:payload options:0 |error|:(missing value)
      set jsonText to current application's NSString's alloc()'s initWithData:jsonData encoding:(current application's NSUTF8StringEncoding)
      return jsonText as text
    end makeInspectionJson
  ` : '';

  return `
    ${inspectionSupport}

    tell application "Mail"
      try
        set foundMsg to missing value
        set targetSubject to "${escapeAppleScriptString(normalized.subject)}"
        set targetSender to "${escapeAppleScriptString(normalized.sender)}"
        set expectedMessageId to "${escapeAppleScriptString(normalized.expectedMessageId)}"
        set mailboxHints to ${toAppleScriptStringList(normalized.mailboxHints)}
        set messageIdCandidates to ${toAppleScriptStringList(normalized.messageIdCandidates)}
        set numericIdCandidates to ${toAppleScriptNumberList(normalized.numericIdCandidates)}
        set mailboxRefs to {}
        set hintedMailboxRefs to {}
        set otherMailboxRefs to {}

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

        repeat with mailboxRef in mailboxRefs
          set isHinted to false
          if (count of mailboxHints) > 0 then
            set mailboxLabel to ""
            try
              set mailboxLabel to (name of mailboxRef as text)
            end try
            if mailboxLabel is not "" then
              repeat with hintRef in mailboxHints
                set hintText to hintRef as text
                if hintText is not "" and (mailboxLabel contains hintText or hintText contains mailboxLabel) then
                  set isHinted to true
                  exit repeat
                end if
              end repeat
            end if
          end if
          if isHinted then
            set end of hintedMailboxRefs to mailboxRef
          else
            set end of otherMailboxRefs to mailboxRef
          end if
        end repeat
        set orderedMailboxRefs to hintedMailboxRefs & otherMailboxRefs

        repeat with candidateNumeric in numericIdCandidates
          set candidateId to candidateNumeric as integer
          repeat with mailboxRef in orderedMailboxRefs
            try
              set candidateMsg to «class mssg» id candidateId of mailboxRef
              if (id of candidateMsg) is candidateId then
                set foundMsg to candidateMsg
                exit repeat
              end if
            end try
          end repeat
          if foundMsg is not missing value then exit repeat
        end repeat
        ${exactOnly ? '' : searchFallbackScript()}

        if foundMsg is missing value then
          return "${NOT_FOUND_SENTINEL}"
        end if

        if expectedMessageId is not "" then
          set actualMessageId to ""
          try
            set actualMessageId to message id of foundMsg as text
          end try
          if actualMessageId starts with "<" and actualMessageId ends with ">" then
            set actualMessageId to text 2 thru -2 of actualMessageId
          end if
          if actualMessageId is not expectedMessageId then
            return "${IDENTITY_MISMATCH_SENTINEL}"
          end if
        end if

        ${action}
      on error errMsg number errNum
        return "${SCRIPT_ERROR_SENTINEL}" & errNum & ":" & errMsg
      end try
    end tell
  `;
}

/**
 * Runs osascript directly, without a shell. If this process is terminated while
 * Mail is still working, the osascript child is killed too, so a caller's
 * timeout cannot leave Mail busy with an orphaned script.
 */
function runAppleScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess | undefined;
    const terminate = (signal: NodeJS.Signals) => {
      child?.kill('SIGKILL');
      process.exit(signal === 'SIGINT' ? 130 : 143);
    };
    process.once('SIGTERM', terminate);
    process.once('SIGINT', terminate);
    child = execFile('osascript', ['-e', script], { maxBuffer: OUTPUT_LIMIT_BYTES }, (error, stdout) => {
      process.off('SIGTERM', terminate);
      process.off('SIGINT', terminate);
      if (error) {
        reject(error);
        return;
      }
      const output = stdout.trim();
      if (output.startsWith(NOT_FOUND_SENTINEL)) {
        reject(new Error('Message not found'));
      } else if (output.startsWith(IDENTITY_MISMATCH_SENTINEL)) {
        reject(new Error('Message identity mismatch'));
      } else if (output.startsWith(SCRIPT_ERROR_SENTINEL)) {
        reject(new Error(`Mail AppleScript error: ${output.replace(SCRIPT_ERROR_SENTINEL, '')}`));
      } else {
        resolve(output);
      }
    });
  });
}

const PASSTHROUGH_ERRORS = new Set(['Message not found', 'Message identity mismatch']);

async function runLookup<T>(
  context: MailLookupContext,
  mode: LookupMode,
  parse: (output: string) => T,
  failure: string,
  color?: MailFlagColor
): Promise<T> {
  const script = buildLookupScript(context, mode, color);
  let output: string;
  try {
    output = await runAppleScript(script);
  } catch (error: any) {
    if (PASSTHROUGH_ERRORS.has(error.message)) throw error;
    throw new Error(failure);
  }
  return parse(output);
}

export async function getEmailBodyByLookup(context: MailLookupContext): Promise<string> {
  return runLookup(context, 'body', (output) => output, 'Failed to fetch message body via AppleScript');
}

export async function openEmailByLookup(context: MailLookupContext): Promise<void> {
  await runLookup(context, 'open', () => undefined, 'Failed to open message via AppleScript');
}

export async function inspectEmailByLookup(context: MailLookupContext): Promise<InspectedMailMessage> {
  return runLookup(context, 'inspect', (output) => {
    let parsed: Partial<InspectedMailMessage>;
    try {
      parsed = JSON.parse(output) as Partial<InspectedMailMessage>;
    } catch {
      throw new Error('Malformed Mail inspection response');
    }
    if (!Array.isArray(parsed.recipients) || typeof parsed.wasRepliedTo !== 'boolean') {
      throw new Error('Malformed Mail inspection response');
    }
    return {
      messageId: typeof parsed.messageId === 'string' ? parsed.messageId : '',
      subject: typeof parsed.subject === 'string' ? parsed.subject : '',
      sender: typeof parsed.sender === 'string' ? parsed.sender : '',
      recipients: parsed.recipients.filter((value): value is string => typeof value === 'string'),
      mailbox: typeof parsed.mailbox === 'string' ? parsed.mailbox : '',
      body: typeof parsed.body === 'string' ? parsed.body : '',
      headers: typeof parsed.headers === 'string' ? parsed.headers : '',
      wasRepliedTo: parsed.wasRepliedTo,
      flagIndex: Number.isInteger(parsed.flagIndex) ? parsed.flagIndex as number : -1
    };
  }, 'Failed to inspect message via AppleScript');
}

export async function setEmailFlagByLookup(
  context: MailLookupContext,
  color: MailFlagColor
): Promise<SetMailFlagResult> {
  if (!Object.prototype.hasOwnProperty.call(MAIL_FLAG_INDEX, color)) {
    throw new Error('Invalid flag color');
  }
  return runLookup(context, 'setFlag', (output) => {
    const [returnedColor, returnedIndex, returnedChanged, previousIndex] = output.split('|');
    if (returnedColor !== color || Number(returnedIndex) !== MAIL_FLAG_INDEX[color]
      || (returnedChanged !== 'true' && returnedChanged !== 'false')
      || !/^-?\d+$/.test(previousIndex ?? '')) {
      throw new Error('Malformed Mail flag response');
    }
    return {
      ok: true,
      color,
      flagIndex: MAIL_FLAG_INDEX[color],
      previousFlagIndex: Number(previousIndex),
      changed: returnedChanged === 'true'
    };
  }, 'Failed to set message flag via AppleScript', color);
}

// Backwards-compatible wrappers
export async function getEmailBody(messageId: string): Promise<string> {
  if (!/^\d+$/.test(messageId)) {
    throw new Error('Invalid message ID');
  }
  return getEmailBodyByLookup({ numericIdCandidates: [parseInt(messageId, 10)] });
}

export async function openEmail(documentId: string): Promise<void> {
  if (!documentId) {
    throw new Error('Invalid document ID');
  }
  try {
    await openEmailByLookup({ messageIdCandidates: [documentId.replace(/^<|>$/g, '')] });
  } catch (error: any) {
    if (error.message === 'Message not found') throw error;
    throw new Error('Failed to open message via document ID');
  }
}

export async function openEmailByRowId(messageId: string): Promise<void> {
  if (!/^\d+$/.test(messageId)) {
    throw new Error('Invalid message ID');
  }
  await openEmailByLookup({ numericIdCandidates: [parseInt(messageId, 10)] });
}
