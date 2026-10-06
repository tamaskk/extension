// What saving an edited sequence will do to the leads that are in the middle of
// it. Pure: the caller hands in the stored sequence, the edited one and the
// active leads ({ stepId, sentStepIds } each), and gets back one line per change
// with the numbers. The editor shows these before anything is written.
//
// How a lead moves through a sequence (lib/outreachSequence.mjs):
// `seq.stepId` is the step the lead is waiting for, and its due date
// (`seq.nextStepAt`) was fixed when the step before it went out. So an edit
// never changes a date that is already set; it changes what happens from the
// lead's current step on.

const isVariant = (s) => !!(s && s.variantOf);
const steps = (seq) => (seq && Array.isArray(seq.steps) ? seq.steps.filter(Boolean) : []);
const mainSteps = (seq) => steps(seq).filter((s) => !isVariant(s));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const leadsText = (n) => plural(n, 'active lead', 'active leads');

// → { activeLeads, items }. An item is { kind, stepId, text, ...numbers }.
// Kinds: sequence-off, sequence-on, text, new, off, on, delay, removed, order, variant.
export function sequenceImpact(current, proposed, leads) {
  const list = leads || [];
  const items = [];
  const before = new Map(steps(current).map((s) => [s.id, s]));
  const after = new Map(steps(proposed).map((s) => [s.id, s]));
  const order = mainSteps(proposed).map((s) => s.id);
  const pos = (id) => order.indexOf(id);
  const label = (id, seq = proposed) => `Step ${mainSteps(seq).findIndex((s) => s.id === id) + 1}`;

  // a lead got a step when that step, or any wording of it, is in its history
  const wordings = (id) => [id, ...[...steps(current), ...steps(proposed)].filter((s) => s.variantOf === id).map((s) => s.id)];
  const got = (lead, id) => { const w = wordings(id); return (lead.sentStepIds || []).some((x) => w.includes(x)); };
  // a lead still reaches a step when it has not got it and stands at or before it
  const reaches = (lead, id) => !got(lead, id) && pos(lead.stepId) !== -1 && pos(lead.stepId) <= pos(id);
  const count = (fn) => list.filter(fn).length;

  if (current.enabled && proposed.enabled === false) items.push({ kind: 'sequence-off', stepId: '', text: `The sequence is switched off: ${leadsText(list.length)} stay where they are and get nothing until it is switched on again.` });
  if (!current.enabled && proposed.enabled === true) items.push({ kind: 'sequence-on', stepId: '', text: `The sequence is switched on: sending starts for ${leadsText(list.length)} already in it, and for every lead enrolled from now on.` });

  for (const s of mainSteps(proposed)) {
    const old = before.get(s.id);
    if (!old) {
      const willGet = s.enabled ? count((l) => pos(l.stepId) !== -1 && pos(l.stepId) < pos(s.id)) : 0;
      const pastIt = count((l) => pos(l.stepId) > pos(s.id));
      items.push({ kind: 'new', stepId: s.id, willGet, pastIt, text: s.enabled
        ? `${label(s.id)} is new: ${leadsText(willGet)} will get it; ${pastIt} are already past its place and will not.`
        : `${label(s.id)} is new and switched off: nobody gets it until it is switched on.` });
      continue;
    }
    if (old.enabled && !s.enabled) {
      const skip = count((l) => reaches(l, s.id));
      const waiting = count((l) => l.stepId === s.id);
      items.push({ kind: 'off', stepId: s.id, skip, waiting, text: `${label(s.id)} is switched off: ${leadsText(skip)} will skip it and go on to the next step that is on, with the waits added together${waiting ? ` (${waiting} of them are waiting for it right now)` : ''}.` });
    } else if (!old.enabled && s.enabled) {
      const willGet = count((l) => reaches(l, s.id));
      items.push({ kind: 'on', stepId: s.id, willGet, text: `${label(s.id)} is switched on: ${leadsText(willGet)} will get it.` });
    }
    if ((old.subject || '') !== (s.subject || '') || (old.body || '') !== (s.body || '') || !!old.sameThread !== !!s.sameThread) {
      const willGet = s.enabled ? count((l) => reaches(l, s.id)) : 0;
      const alreadyGot = count((l) => got(l, s.id));
      items.push({ kind: 'text', stepId: s.id, willGet, alreadyGot, text: `${label(s.id)} has new wording: ${leadsText(willGet)} will get the new one; ${alreadyGot} already got the old one and will not get it again.` });
    }
    if (old.delayDays !== s.delayDays) {
      const later = count((l) => pos(l.stepId) !== -1 && pos(l.stepId) < pos(s.id));
      const fixed = count((l) => l.stepId === s.id);
      items.push({ kind: 'delay', stepId: s.id, later, fixed, text: `${label(s.id)} now waits ${plural(Number(s.delayDays) || 0, 'day', 'days')} instead of ${old.delayDays}: it applies to ${leadsText(later)} who have not reached it yet. ${plural(fixed, 'lead is', 'leads are')} already scheduled for it and ${fixed === 1 ? 'keeps its' : 'keep their'} date.` });
    }
  }

  for (const s of mainSteps(current)) {
    if (after.has(s.id)) continue;
    const stranded = count((l) => l.stepId === s.id);
    const hadIt = count((l) => got(l, s.id));
    items.push({ kind: 'removed', stepId: s.id, stranded, hadIt, text: `${label(s.id, current)} is deleted: for ${leadsText(stranded)} waiting for it the sequence ends, they get nothing more. ${plural(hadIt, 'lead has', 'leads have')} it in their history, where it will show as an unknown step. Switching the step off instead avoids both.` });
  }

  const kept = (seq) => mainSteps(seq).map((s) => s.id).filter((id) => before.has(id) && after.has(id));
  if (kept(current).join('|') !== kept(proposed).join('|')) {
    items.push({ kind: 'order', stepId: '', text: `The order of the steps changed: each of the ${leadsText(list.length)} goes on from the step it is waiting for, in the new order. A step that moved behind a lead is not sent to it; a step that moved ahead of a lead is.` });
  }

  const variantsOf = (seq) => steps(seq).filter(isVariant);
  for (const v of variantsOf(proposed)) {
    const old = before.get(v.id);
    if (old && (old.subject || '') === (v.subject || '') && (old.body || '') === (v.body || '') && !!old.enabled === !!v.enabled && old.weight === v.weight) continue;
    const reach = count((l) => reaches(l, v.variantOf));
    items.push({ kind: 'variant', stepId: v.id, reach, text: `${label(v.variantOf)} has ${old ? 'a changed' : 'a new'} wording variant: it can go to some of the ${leadsText(reach)} who have not got that step yet.` });
  }
  for (const v of variantsOf(current)) {
    if (!after.has(v.id)) items.push({ kind: 'variant', stepId: v.id, reach: 0, text: `A wording variant of ${label(v.variantOf, current)} is deleted: nobody gets it any more; leads who got it keep it in their history.` });
  }

  return { activeLeads: list.length, items };
}
