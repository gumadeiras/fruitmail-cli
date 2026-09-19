import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const NOT_FOUND_SENTINEL = '__FRUITMAIL_NOT_FOUND__';
const SCRIPT_ERROR_SENTINEL = '__FRUITMAIL_SCRIPT_ERROR__';

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
  dateReceived: string;
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
  changed: boolean;
}

export interface MailFlagState {
  flagged: boolean;
  flagIndex: number;
}

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

function inspectResultScript(): string {
  return `
        set messageIdValue to ""
        set subjectValue to ""
        set senderValue to ""
        set recipientValues to {}
        set dateReceivedValue to ""
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
          set dateReceivedValue to date received of foundMsg as text
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

        return my makeInspectionJson(messageIdValue, subjectValue, senderValue, recipientValues, dateReceivedValue, mailboxValue, bodyValue, headersValue, wasRepliedToValue, flagIndexValue)`;
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

        return "${color}|${flagIndex}|" & (didChange as text)`;
}

function readFlagResultScript(): string {
  return `
        set isFlagged to flagged status of foundMsg
        set currentFlagIndex to -1
        if isFlagged then
          try
            set currentFlagIndex to flag index of foundMsg as integer
          end try
        end if
        return (isFlagged as text) & "|" & currentFlagIndex`;
}

export function buildLookupScript(
  context: MailLookupContext,
  mode: 'open' | 'body' | 'inspect' | 'readFlag' | 'setFlag',
  color?: MailFlagColor
): string {
  const normalized = normalizeLookupContext(context);
  const escapedSubject = escapeAppleScriptString(normalized.subject);
  const escapedSender = escapeAppleScriptString(normalized.sender);
  const mailboxHintsList = toAppleScriptStringList(normalized.mailboxHints);
  const messageIdCandidatesList = toAppleScriptStringList(normalized.messageIdCandidates);
  const numericIdCandidatesList = toAppleScriptNumberList(normalized.numericIdCandidates);
  const exactOnly = mode === 'inspect' || mode === 'readFlag' || mode === 'setFlag';

  if (mode === 'setFlag' && !color) {
    throw new Error('Flag color is required');
  }

  const action = mode === 'body'
    ? 'return content of foundMsg'
    : mode === 'open'
      ? 'open foundMsg\n        activate\n        return "OK"'
      : mode === 'inspect'
        ? inspectResultScript()
        : mode === 'readFlag'
          ? readFlagResultScript()
          : setFlagResultScript(color as MailFlagColor);

  const inspectionSupport = mode === 'inspect' ? `
    use framework "Foundation"
    use scripting additions

    on makeInspectionJson(messageIdValue, subjectValue, senderValue, recipientValues, dateReceivedValue, mailboxValue, bodyValue, headersValue, wasRepliedToValue, flagIndexValue)
      set payload to current application's NSMutableDictionary's dictionary()
      payload's setObject:messageIdValue forKey:"messageId"
      payload's setObject:subjectValue forKey:"subject"
      payload's setObject:senderValue forKey:"sender"
      payload's setObject:(current application's NSArray's arrayWithArray:recipientValues) forKey:"recipients"
      payload's setObject:dateReceivedValue forKey:"dateReceived"
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

        if ${exactOnly ? 'false' : 'true'} and foundMsg is missing value and targetSubject is not "" then
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

        ${action}
      on error errMsg number errNum
        return "${SCRIPT_ERROR_SENTINEL}" & errNum & ":" & errMsg
      end try
    end tell
  `;
}

async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
  const output = stdout.trim();
  if (output.startsWith(NOT_FOUND_SENTINEL)) {
    throw new Error(`Message not found: ${output.slice(NOT_FOUND_SENTINEL.length)}`);
  }
  if (output.startsWith(SCRIPT_ERROR_SENTINEL)) {
    throw new Error(`Mail AppleScript error: ${output.replace(SCRIPT_ERROR_SENTINEL, '')}`);
  }
  return output;
}

async function runLookupScript(
  context: MailLookupContext,
  mode: 'open' | 'body' | 'inspect' | 'readFlag' | 'setFlag',
  color?: MailFlagColor
): Promise<string> {
  const script = buildLookupScript(context, mode, color);
  try {
    return await runAppleScript(script);
  } catch (error: any) {
    if (error.message.startsWith('Message not found') || error.message.includes(NOT_FOUND_SENTINEL)) {
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

export async function inspectEmailByLookup(context: MailLookupContext): Promise<InspectedMailMessage> {
  try {
    const output = await runLookupScript(context, 'inspect');
    const parsed = JSON.parse(output) as Partial<InspectedMailMessage>;
    if (!Array.isArray(parsed.recipients) || typeof parsed.wasRepliedTo !== 'boolean') {
      throw new Error('Malformed Mail inspection response');
    }
    return {
      messageId: typeof parsed.messageId === 'string' ? parsed.messageId : '',
      subject: typeof parsed.subject === 'string' ? parsed.subject : '',
      sender: typeof parsed.sender === 'string' ? parsed.sender : '',
      recipients: parsed.recipients.filter((value): value is string => typeof value === 'string'),
      dateReceived: typeof parsed.dateReceived === 'string' ? parsed.dateReceived : '',
      mailbox: typeof parsed.mailbox === 'string' ? parsed.mailbox : '',
      body: typeof parsed.body === 'string' ? parsed.body : '',
      headers: typeof parsed.headers === 'string' ? parsed.headers : '',
      wasRepliedTo: parsed.wasRepliedTo,
      flagIndex: Number.isInteger(parsed.flagIndex) ? parsed.flagIndex as number : -1
    };
  } catch (error: any) {
    if (error.message === 'Message not found') throw error;
    if (error.message === 'Malformed Mail inspection response') throw error;
    throw new Error('Failed to inspect message via AppleScript');
  }
}

export async function setEmailFlagByLookup(
  context: MailLookupContext,
  color: MailFlagColor
): Promise<SetMailFlagResult> {
  if (!Object.prototype.hasOwnProperty.call(MAIL_FLAG_INDEX, color)) {
    throw new Error('Invalid flag color');
  }

  try {
    const output = await runLookupScript(context, 'setFlag', color);
    const [returnedColor, returnedIndex, returnedChanged] = output.split('|');
    if (returnedColor !== color || Number(returnedIndex) !== MAIL_FLAG_INDEX[color]
      || (returnedChanged !== 'true' && returnedChanged !== 'false')) {
      throw new Error('Malformed Mail flag response');
    }
    return {
      ok: true,
      color,
      flagIndex: MAIL_FLAG_INDEX[color],
      changed: returnedChanged === 'true'
    };
  } catch (error: any) {
    if (error.message === 'Message not found') throw error;
    if (error.message === 'Malformed Mail flag response') throw error;
    throw new Error('Failed to set message flag via AppleScript');
  }
}

export async function getEmailFlagByLookup(context: MailLookupContext): Promise<MailFlagState> {
  try {
    const output = await runLookupScript(context, 'readFlag');
    const [flaggedText, indexText] = output.split('|');
    if ((flaggedText !== 'true' && flaggedText !== 'false') || !/^-?\d+$/.test(indexText ?? '')) {
      throw new Error('Malformed Mail flag response');
    }
    const flagged = flaggedText === 'true';
    const flagIndex = Number(indexText);
    if ((flagged && (flagIndex < 0 || flagIndex > 6)) || (!flagged && flagIndex !== -1)) {
      throw new Error('Malformed Mail flag response');
    }
    return { flagged, flagIndex };
  } catch (error: any) {
    if (error.message === 'Message not found') throw error;
    if (error.message === 'Malformed Mail flag response') throw error;
    throw new Error('Failed to read message flag via AppleScript');
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
