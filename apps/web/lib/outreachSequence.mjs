// Rules of an outreach sequence (the `outreachsequences` collection): which step
// comes next, how long to wait for it, and whether a sequence is fit to run.
// Pure functions, so they are tested without a database.
//
// A step is { id, delayDays, subject, body, sameThread, enabled, variantOf?, weight? }.
// - `id` is a short random string and never changes. A lead points at its next
//   step by id (`seq.stepId`), not by position: if the position were the key,
//   one inserted step would shift every running lead and people would get the
//   same email twice.
// - `delayDays` is the wait after the step before it, not a day counted from
//   the start, so inserting a step does not mean renumbering the others.
// - A step with `variantOf` is another wording of that step (an A/B variant).
//   It has no place of its own in the order.

const isVariant = (step) => !!(step && step.variantOf);
const mainSteps = (seq) => (Array.isArray(seq && seq.steps) ? seq.steps : []).filter((s) => s && !isVariant(s));
const filled = (v) => typeof v === 'string' && v.trim() !== '';

// A new step id. Six characters are plenty inside one sequence.
export function newStepId(random = Math.random) {
  let id = '';
  while (id.length < 6) id += Math.floor(random() * 36).toString(36);
  return id;
}

// The steps that will be sent, in order. Variants are not part of the order.
export function enabledSteps(seq) {
  return mainSteps(seq).filter((s) => s.enabled);
}

// Any step by id, variants and switched-off steps included. null when there is none.
export function stepById(seq, id) {
  if (!id) return null;
  return (Array.isArray(seq && seq.steps) ? seq.steps : []).find((s) => s && s.id === id) || null;
}

// The step to send after `afterId`, and the days to wait for it: { step, delayDays }.
// A switched-off step is skipped but its wait still counts, so switching a step
// off does not pull the later ones forward.
// - Without `afterId` (a lead that got nothing yet) it is the first enabled step, at once.
// - null when nothing is left, and also when `afterId` is not in the sequence
//   any more (the step was deleted): the place of the lead is unknown then, and
//   stopping is better than sending something twice.
export function nextEnabledStep(seq, afterId) {
  const steps = mainSteps(seq);
  if (!afterId) {
    const first = steps.find((s) => s.enabled);
    return first ? { step: first, delayDays: 0 } : null;
  }
  const from = steps.findIndex((s) => s.id === afterId);
  if (from < 0) return null;
  let delayDays = 0;
  for (let i = from + 1; i < steps.length; i++) {
    delayDays += Number(steps[i].delayDays) || 0;
    if (steps[i].enabled) return { step: steps[i], delayDays };
  }
  return null;
}

// The day a step falls on, counted from the first step (day 0). For the editor
// only; sending works from the waits. A variant falls on the day of its step.
// null for an unknown id.
export function absoluteDayOf(seq, stepId) {
  const target = stepById(seq, stepId);
  if (!target) return null;
  const mainId = isVariant(target) ? target.variantOf : target.id;
  let day = 0;
  for (const s of mainSteps(seq)) {
    day += Number(s.delayDays) || 0;
    if (s.id === mainId) return day;
  }
  return null;
}

// Everything wrong with a sequence, as sentences for the editor. An empty list
// means it may run. Strict on purpose: a sequence that slips through wrong is a
// thousand wrong emails.
export function validateSequence(seq) {
  const errors = [];
  if (!seq || typeof seq !== 'object') return ['The sequence is missing.'];
  if (!filled(seq.name)) errors.push('The sequence has no name.');
  if (seq.language !== 'en' && seq.language !== 'hu') errors.push('The language must be en or hu.');
  if (!Array.isArray(seq.steps)) return [...errors, 'The sequence has no steps.'];

  const label = (s, i) => `Step ${i + 1}${filled(s && s.subject) ? ` ("${s.subject.trim().slice(0, 40)}")` : ''}`;
  const seen = new Set();
  seq.steps.forEach((s, i) => {
    if (!s || typeof s !== 'object') { errors.push(`Step ${i + 1} is not a step.`); return; }
    if (!filled(s.id)) errors.push(`${label(s, i)} has no id.`);
    else if (seen.has(s.id)) errors.push(`${label(s, i)} has the same id as an earlier step.`);
    else seen.add(s.id);
  });

  const main = mainSteps(seq);
  const firstEnabled = main.find((s) => s.enabled);
  if (!firstEnabled) errors.push('At least one step must be switched on.');
  if (main.length && main[0].delayDays !== 0) errors.push('The first step must have a wait of 0 days.');

  seq.steps.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const name = label(s, i);
    if (isVariant(s)) {
      const of = main.find((m) => m.id === s.variantOf);
      if (!of) errors.push(`${name} is a variant of a step that does not exist.`);
    } else {
      if (!Number.isInteger(s.delayDays) || s.delayDays < 0) errors.push(`${name}: the wait must be a whole number of days, 0 or more.`);
      // two emails to the same person on the same day
      else if (s !== main[0] && s.delayDays === 0) errors.push(`${name}: only the first step may have a wait of 0 days.`);
    }
    if (s.weight !== undefined && !(typeof s.weight === 'number' && s.weight > 0 && s.weight <= 1000)) errors.push(`${name}: the weight must be a number above 0, up to 1000.`);
    if (!s.enabled) return;
    const first = s === firstEnabled || (isVariant(s) && firstEnabled && s.variantOf === firstEnabled.id);
    if (first && s.sameThread) errors.push(`${name} opens the conversation, so it cannot continue an earlier thread.`);
    // a step that continues the thread is sent under the thread's subject; its own is not used
    if (!filled(s.subject) && (first || !s.sameThread)) errors.push(`${name} has no subject.`);
    if (!filled(s.body)) errors.push(`${name} has no text.`);
  });

  return errors;
}

// What a sequence looks like on its way into the database, from a request body:
// only the known fields, coerced and cut to size. With `creating` every field
// gets a value; otherwise only the fields that were sent are in the result, so
// an edit changes nothing else. A step that arrives without an id gets one
// here; a step that has one keeps it, whatever else changes on it.
// This only shapes the data. Whether it may run is validateSequence's call.
const line = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const prose = (v, max) => String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max);
const wholeOrNull = (v) => (v === '' || v === null || v === undefined || typeof v === 'boolean' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function cleanStep(input, random = Math.random) {
  const b = input && typeof input === 'object' ? input : {};
  const step = {
    id: filled(b.id) ? line(b.id, 40) : newStepId(random),
    delayDays: wholeOrNull(b.delayDays),
    // one line: the subject becomes a mail header, and a line break in it would start another
    subject: line(b.subject, 300),
    body: prose(b.body, 20000),
    sameThread: b.sameThread === true,
    enabled: b.enabled !== false,
  };
  if (filled(b.variantOf)) step.variantOf = line(b.variantOf, 40);
  // a step with wording variants has a weight too: its share against them (lib/outreachVariant.mjs)
  if (b.weight !== undefined && b.weight !== null && b.weight !== '') step.weight = Number(b.weight);
  return step;
}

export function cleanSequence(input, creating, random = Math.random) {
  const b = input && typeof input === 'object' ? input : {};
  const has = (k) => creating || b[k] !== undefined;
  const value = {};
  if (has('name')) value.name = line(b.name, 120);
  if (has('language')) value.language = line(b.language, 5) || 'en';
  if (has('senderIds')) value.senderIds = [...new Set((Array.isArray(b.senderIds) ? b.senderIds : []).map((x) => line(x, 40)).filter(Boolean))].slice(0, 100);
  if (has('steps')) value.steps = (Array.isArray(b.steps) ? b.steps : []).slice(0, 50).map((s) => cleanStep(s, random));
  if (has('stopOnReply')) value.stopOnReply = b.stopOnReply !== false;
  if (has('stopOnBounce')) value.stopOnBounce = b.stopOnBounce !== false;
  if (has('enabled')) value.enabled = b.enabled === true;
  // false unless asked for: after the opening email the lead waits for the operator
  if (has('autoFollowUp')) value.autoFollowUp = b.autoFollowUp === true;
  return value;
}

// What happens to a lead's sequence state after a step went out. Pure: the
// database write is in lib/outreachState.ts and nothing else decides this, so
// the dashboard and the dispatcher cannot drift apart.
// `sentStepId` is the step that REALLY went out, which may be a variant; the
// place in the order is that of the step it is a variant of.
// → { sentStepId, stepId, nextStepAt, status, delayDays }: `stepId` is the next
// step to send ('' when the sequence is over) and `nextStepAt` when it is due.
//
// After the OPENING email the lead does not go on by itself unless the sequence
// says so (`autoFollowUp`). Its status becomes 'waiting': it keeps its next
// step, nothing is due, and the operator starts the follow-ups for the leads
// they choose (planContinue). A sender has a few dozen emails a day; if every
// follow-up went out by itself, there would be days with one new company
// reached. Once started, the rest of the steps run by their waits.
export function planAdvance(seq, sentStepId, now = new Date()) {
  const sent = stepById(seq, sentStepId);
  const mainId = sent && isVariant(sent) ? sent.variantOf : sentStepId;
  const next = sent ? nextEnabledStep(seq, mainId) : null;
  if (!next) return { sentStepId, stepId: '', nextStepAt: '', status: 'finished', delayDays: 0 };
  const opening = nextEnabledStep(seq, '');
  if (!(seq && seq.autoFollowUp) && opening && opening.step.id === mainId) {
    return { sentStepId, stepId: next.step.id, nextStepAt: '', status: 'waiting', delayDays: next.delayDays };
  }
  return {
    sentStepId,
    stepId: next.step.id,
    nextStepAt: new Date(now.getTime() + next.delayDays * 86_400_000).toISOString(),
    status: 'active',
    delayDays: next.delayDays,
  };
}

// The status a lead's sequence ends in, by why it was stopped. A reply and a
// bounce keep their own status because the reports count them; every other
// reason (an unsubscribe, the operator, a deleted sequence, a suppressed
// address) is 'stopped'.
export function statusForStop(reason) {
  if (reason === 'replied' || reason === 'bounced') return reason;
  return 'stopped';
}

// The operator starts the follow-ups of a waiting lead: it becomes active again
// on the step it was waiting for. `spreadMs` scatters the due times, so the
// leads started together do not all fall due in the same minute.
// → { stepId, nextStepAt, status } or null when there is nothing to continue
// with (the step it waited for is gone or switched off, and nothing follows it).
export function planContinue(seq, waitingStepId, now = new Date(), random = Math.random, spreadMs = 120 * 60_000) {
  const step = stepById(seq, waitingStepId);
  // the step itself when it can still be sent, otherwise the next one that can
  const target = step && !isVariant(step) && step.enabled ? step : (step ? (nextEnabledStep(seq, waitingStepId) || {}).step : null);
  if (!target) return null;
  return { stepId: target.id, nextStepAt: new Date(now.getTime() + Math.floor(random() * spreadMs)).toISOString(), status: 'active' };
}
