"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmailBodyByLookup = getEmailBodyByLookup;
exports.openEmailByLookup = openEmailByLookup;
exports.getEmailBody = getEmailBody;
exports.openEmail = openEmail;
exports.openEmailByRowId = openEmailByRowId;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const execAsync = (0, node_util_1.promisify)(node_child_process_1.exec);
const NOT_FOUND_SENTINEL = '__FRUITMAIL_NOT_FOUND__';
const SCRIPT_ERROR_SENTINEL = '__FRUITMAIL_SCRIPT_ERROR__';
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
function buildLookupScript(context, mode) {
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
async function runLookupScript(context, mode) {
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
    }
    catch (error) {
        if (error.message === 'Message not found' || error.message.includes(NOT_FOUND_SENTINEL)) {
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
