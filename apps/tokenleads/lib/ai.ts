// AI outreach-email generator. With ANTHROPIC_API_KEY: Claude API via the
// official SDK, structured output (subject + body). Without a key: a clearly
// labelled deterministic template, so the flow works in dev.
import Anthropic from '@anthropic-ai/sdk';
import { logError, logEvent } from './monitoring';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';

export interface OutreachInput {
  leadName: string;
  category: string;
  city: string;
  rating: number | null;
  reviewCount: number | null;
  websiteStatus: string;
  aiSummary: string;
  aiPainPoints: string;
  senderName: string;   // who is reaching out
  senderPitch: string;  // what they sell / offer
}

export interface OutreachResult { subject: string; body: string; source: 'ai' | 'template'; }

export function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'Rövid, figyelemfelkeltő tárgysor magyarul vagy a lead nyelvén' },
    body: { type: 'string', description: 'A teljes e-mail törzse, 80-140 szó, személyre szabott, konkrét' },
  },
  required: ['subject', 'body'],
  additionalProperties: false,
} as const;

export async function generateOutreach(input: OutreachInput): Promise<OutreachResult> {
  if (!aiEnabled()) return templateOutreach(input);

  const client = new Anthropic();
  const prompt = `Írj egy rövid, személyre szabott hideg-megkereső e-mailt az alábbi vállalkozásnak.

CÉLPONT:
- Név: ${input.leadName}
- Kategória: ${input.category}
- Hely: ${input.city}
- Google értékelés: ${input.rating ?? 'nincs'} (${input.reviewCount ?? 0} vélemény)
- Weboldal státusz: ${input.websiteStatus || 'ismeretlen'}
${input.aiSummary ? `- Összefoglaló: ${input.aiSummary}` : ''}
${input.aiPainPoints ? `- Fájdalompontok: ${input.aiPainPoints}` : ''}

KÜLDŐ:
- Név: ${input.senderName || 'a küldő'}
- Amit kínál: ${input.senderPitch || 'digitális szolgáltatások helyi vállalkozásoknak'}

Szabályok: 80-140 szó, konkrét utalás a célpont helyzetére (pl. hiányzó weboldal, kevés vélemény),
egyetlen világos call-to-action, semmi túlzó marketinges frázis, magyarul.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: {
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{ role: 'user', content: prompt }],
    });

    if (response.stop_reason === 'refusal') {
      logEvent('ai_outreach_refusal', { lead: input.leadName });
      return templateOutreach(input);
    }
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') throw new Error('no text block in response');
    const parsed = JSON.parse(text.text) as { subject: string; body: string };
    logEvent('ai_outreach_generated', { model: MODEL, outputTokens: response.usage.output_tokens });
    return { subject: parsed.subject, body: parsed.body, source: 'ai' };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      logError('ai_outreach_rate_limited', e);
      throw new AiUnavailableError('rate_limited');
    }
    if (e instanceof Anthropic.APIConnectionError) {
      logError('ai_outreach_connection', e);
      throw new AiUnavailableError('connection');
    }
    if (e instanceof Anthropic.APIError) {
      logError('ai_outreach_api_error', e, { status: (e as { status?: number }).status });
      throw new AiUnavailableError('api_error');
    }
    logError('ai_outreach_parse_error', e);
    return templateOutreach(input); // malformed output → degrade to template
  }
}

export class AiUnavailableError extends Error {
  constructor(public reason: string) { super(`ai unavailable: ${reason}`); }
}

// Deterministic fallback — clearly labelled in the UI as template-based.
export function templateOutreach(i: OutreachInput): OutreachResult {
  const hooks: string[] = [];
  if (i.websiteStatus === 'NO_WEBSITE') hooks.push('láttam, hogy jelenleg nincs weboldaluk');
  if (i.websiteStatus === 'FACEBOOK_ONLY') hooks.push('láttam, hogy jelenleg csak Facebook-oldaluk van');
  if (i.websiteStatus === 'INSTAGRAM_ONLY') hooks.push('láttam, hogy jelenleg csak Instagram-oldaluk van');
  if ((i.reviewCount ?? 0) > 0 && (i.rating ?? 0) >= 4.5) hooks.push(`a ${i.rating} csillagos értékelésük kiemelkedő a környéken`);
  const hook = hooks.length ? hooks.join(', és ') : `${i.city ? i.city + ' környékén' : 'a környéken'} kerestem ${i.category || 'vállalkozásokat'}`;

  return {
    subject: `Gyors kérdés — ${i.leadName}`,
    body: `Kedves ${i.leadName} csapata!

${i.senderName || 'A nevem [név]'} vagyok, és ${i.senderPitch || 'helyi vállalkozásoknak segítek több ügyfelet szerezni online'}. Azért írok, mert ${hook}.

Szívesen megmutatnám 15 percben, hogyan tudnánk ebből több megkeresést csinálni Önöknek — kötelezettség nélkül.

Mikor lenne alkalmas egy rövid hívás a héten?

Üdvözlettel,
${i.senderName || '[név]'}`,
    source: 'template',
  };
}
