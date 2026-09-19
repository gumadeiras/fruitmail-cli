"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAIL_FLAG_INDEX = void 0;
exports.buildLookupScript = buildLookupScript;
exports.getEmailBodyByLookup = getEmailBodyByLookup;
exports.openEmailByLookup = openEmailByLookup;
exports.inspectEmailByLookup = inspectEmailByLookup;
exports.setEmailFlagByLookup = setEmailFlagByLookup;
exports.getEmailFlagByLookup = getEmailFlagByLookup;
exports.getEmailBody = getEmailBody;
exports.openEmail = openEmail;
exports.openEmailByRowId = openEmailByRowId;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const execAsync = (0, node_util_1.promisify)(node_child_process_1.exec);
const NOT_FOUND_SENTINEL = '__FRUITMAIL_NOT_FOUND__';
const SCRIPT_ERROR_SENTINEL = '__FRUITMAIL_SCRIPT_ERROR__';
exports.MAIL_FLAG_INDEX = {
    red: 0,
    orange: 1,
    yellow: 2,
    green: 3,
    blue: 4,
    purple: 5,
    gray: 6,
    none: -1
};
function escapeAppleScriptString(value) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
function toAppleScriptStringList(values) {
    return `{${values.map((value) => `"${escapeAppleScriptString(value)}"`).join(', ')}}`;
}
function toAppleScriptNumberList(values) {
    return `{${values.map((value) => `${value}`).join(', ')}}`;
}
function normalizeLookupContext(context) {
    const messageIdCandidates = Array.from(new Set((context.messageIdCandidates ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0)));
    const mailboxHints = Array.from(new Set((context.mailboxHints ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0)));
    const numericIdCandidates = Array.from(new Set((context.numericIdCandidates ?? [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)));
    return {
        messageIdCandidates,
        mailboxHints,
        numericIdCandidates,
        subject: (context.subject ?? '').trim(),
        sender: (context.sender ?? '').trim()
    };
}
function inspectResultScript() {
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
function setFlagResultScript(color) {
    const flagIndex = exports.MAIL_FLAG_INDEX[color];
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
function readFlagResultScript() {
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
function buildLookupScript(context, mode, color) {
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
                    : setFlagResultScript(color);
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
async function runAppleScript(script) {
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
async function runLookupScript(context, mode, color) {
    const script = buildLookupScript(context, mode, color);
    try {
        return await runAppleScript(script);
    }
    catch (error) {
        if (error.message.startsWith('Message not found') || error.message.includes(NOT_FOUND_SENTINEL)) {
            throw new Error('Message not found');
        }
        throw error;
    }
}
async function getEmailBodyByLookup(context) {
    try {
        return await runLookupScript(context, 'body');
    }
    catch (error) {
        if (error.message === 'Message not found') {
            throw error;
        }
        throw new Error('Failed to fetch message body via AppleScript');
    }
}
async function openEmailByLookup(context) {
    try {
        await runLookupScript(context, 'open');
    }
    catch (error) {
        if (error.message === 'Message not found') {
            throw error;
        }
        throw new Error('Failed to open message via AppleScript');
    }
}
async function inspectEmailByLookup(context) {
    try {
        const output = await runLookupScript(context, 'inspect');
        const parsed = JSON.parse(output);
        if (!Array.isArray(parsed.recipients) || typeof parsed.wasRepliedTo !== 'boolean') {
            throw new Error('Malformed Mail inspection response');
        }
        return {
            messageId: typeof parsed.messageId === 'string' ? parsed.messageId : '',
            subject: typeof parsed.subject === 'string' ? parsed.subject : '',
            sender: typeof parsed.sender === 'string' ? parsed.sender : '',
            recipients: parsed.recipients.filter((value) => typeof value === 'string'),
            dateReceived: typeof parsed.dateReceived === 'string' ? parsed.dateReceived : '',
            mailbox: typeof parsed.mailbox === 'string' ? parsed.mailbox : '',
            body: typeof parsed.body === 'string' ? parsed.body : '',
            headers: typeof parsed.headers === 'string' ? parsed.headers : '',
            wasRepliedTo: parsed.wasRepliedTo,
            flagIndex: Number.isInteger(parsed.flagIndex) ? parsed.flagIndex : -1
        };
    }
    catch (error) {
        if (error.message === 'Message not found')
            throw error;
        if (error.message === 'Malformed Mail inspection response')
            throw error;
        throw new Error('Failed to inspect message via AppleScript');
    }
}
async function setEmailFlagByLookup(context, color) {
    if (!Object.prototype.hasOwnProperty.call(exports.MAIL_FLAG_INDEX, color)) {
        throw new Error('Invalid flag color');
    }
    try {
        const output = await runLookupScript(context, 'setFlag', color);
        const [returnedColor, returnedIndex, returnedChanged] = output.split('|');
        if (returnedColor !== color || Number(returnedIndex) !== exports.MAIL_FLAG_INDEX[color]
            || (returnedChanged !== 'true' && returnedChanged !== 'false')) {
            throw new Error('Malformed Mail flag response');
        }
        return {
            ok: true,
            color,
            flagIndex: exports.MAIL_FLAG_INDEX[color],
            changed: returnedChanged === 'true'
        };
    }
    catch (error) {
        if (error.message === 'Message not found')
            throw error;
        if (error.message === 'Malformed Mail flag response')
            throw error;
        throw new Error('Failed to set message flag via AppleScript');
    }
}
async function getEmailFlagByLookup(context) {
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
    }
    catch (error) {
        if (error.message === 'Message not found')
            throw error;
        if (error.message === 'Malformed Mail flag response')
            throw error;
        throw new Error('Failed to read message flag via AppleScript');
    }
}
// Backwards-compatible wrappers
async function getEmailBody(messageId) {
    if (!/^\d+$/.test(messageId)) {
        throw new Error('Invalid message ID');
    }
    return getEmailBodyByLookup({
        numericIdCandidates: [parseInt(messageId, 10)]
    });
}
async function openEmail(documentId) {
    if (!documentId) {
        throw new Error('Invalid document ID');
    }
    try {
        await openEmailByLookup({
            messageIdCandidates: [documentId.replace(/^<|>$/g, '')]
        });
    }
    catch (error) {
        if (error.message === 'Message not found') {
            throw error;
        }
        throw new Error('Failed to open message via document ID');
    }
}
async function openEmailByRowId(messageId) {
    if (!/^\d+$/.test(messageId)) {
        throw new Error('Invalid message ID');
    }
    try {
        await openEmailByLookup({
            numericIdCandidates: [parseInt(messageId, 10)]
        });
    }
    catch (error) {
        if (error.message === 'Message not found') {
            throw error;
        }
        throw new Error('Failed to open message via AppleScript');
    }
}
