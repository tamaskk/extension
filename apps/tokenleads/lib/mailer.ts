// Email adapter: Resend (REST) when RESEND_API_KEY is set, otherwise "dev
// mode" — the email is stored in the `outbox` collection (readable on the
// admin page) and logged. Every send is recorded in outbox either way.
import { Outbox } from './models';
import { dbConnect } from './db';
import { logError, logEvent } from './monitoring';

const FROM = process.env.EMAIL_FROM || 'TokenLeads <no-reply@tokenleads.dev>';

export async function sendMail(to: string, subject: string, html: string): Promise<'sent' | 'dev' | 'failed'> {
  await dbConnect();
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    await Outbox.create({ to, subject, html, status: 'dev', provider: 'dev' });
    logEvent('mail_dev_mode', { to, subject });
    return 'dev';
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
    await Outbox.create({ to, subject, html, status: 'sent', provider: 'resend' });
    return 'sent';
  } catch (e) {
    await Outbox.create({ to, subject, html, status: 'failed', provider: 'resend', error: String(e) });
    logError('mail_send_failed', e, { to, subject });
    return 'failed';
  }
}

const wrap = (body: string) => `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1e1b4b">
    <div style="font-weight:800;font-size:18px;margin-bottom:16px">Token<span style="color:#6366f1">Leads</span></div>
    ${body}
    <p style="color:#928ea9;font-size:12px;margin-top:24px">Ezt a levelet a TokenLeads küldte.</p>
  </div>`;

export function verifyEmailHtml(verifyUrl: string, bonus: number) {
  return wrap(`
    <h2 style="font-size:18px">Erősítsd meg az e-mail címed</h2>
    <p>Kattints a gombra a fiókod aktiválásához — utána azonnal jóváírjuk a(z) <b>${bonus} token</b> üdvözlő bónuszt.</p>
    <p style="margin:24px 0"><a href="${verifyUrl}" style="background:#6366f1;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700">E-mail megerősítése</a></p>
    <p style="color:#64607e;font-size:13px">A link 24 óráig érvényes. Ha nem te regisztráltál, hagyd figyelmen kívül.</p>`);
}

export function radarAlertHtml(name: string, newCount: number, appUrl: string) {
  return wrap(`
    <h2 style="font-size:18px">${newCount} új lead a radarodon</h2>
    <p>A(z) „<b>${name}</b>” mentett keresésedre <b>${newCount} új lead</b> érkezett az utolsó futás óta.</p>
    <p style="margin:24px 0"><a href="${appUrl}/leads" style="background:#6366f1;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700">Megnézem</a></p>`);
}
