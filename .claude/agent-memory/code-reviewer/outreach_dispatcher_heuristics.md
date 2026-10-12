---
name: outreach-dispatcher-heuristics
description: Review heuristics for the web outreach dispatcher (dispatcher.ts, sendGuard.mjs, outreachState.ts)
metadata:
  type: project
---

- nodemailer error codes: 'ECONNECTION' with command 'CONN' is also raised for "Connection closed unexpectedly" during DATA, so it is NOT proof that nothing was sent; raw socket errors surface as 'ESOCKET'. Check `sendFailureKind` against node_modules/nodemailer/dist/esm/smtp-connection/index.js.
- Dispatcher picks `limit(8)` due leads per sender; any outcome kind 'none' (sequence off, claim busy, prior 'sending') can starve later leads (head-of-line blocking).
- Sender-level limits (daily cap, gap) are read before the loop and are not atomic across overlapping rounds.
- Lead state written after advanceSequence (threadSubject, emailSentAt) is a second write: a crash between them loses it.
