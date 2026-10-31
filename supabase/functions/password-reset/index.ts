// Supabase Edge Function: password-reset
// Sends a branded password-reset email via Resend. The reset link is minted
// with the service role (admin.generateLink) so we control the email content
// instead of using Supabase's built-in recovery template.
//
// Deploy:  supabase functions deploy password-reset
// Secrets: supabase secrets set RESEND_API_KEY=re_...
//          NOTIFY_FROM="Fit Void <andy@andysocialapps.website>" (domain must be verified in Resend)
//          SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided.
//
// Invoke from the client with supabase.functions.invoke('password-reset', { body: { email } }).
// Always returns { ok: true } for well-formed requests - never reveals whether
// an account exists for a given email.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { LOGO_BASE64 } from '../notify/logo.ts';

const NOTIFY_FROM = Deno.env.get('NOTIFY_FROM') ?? 'Fit Void <andy@andysocialapps.website>';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const REDIRECT_TO = 'gymvoid://auth/reset';

// Bundled logo (256px PNG) sent as an inline attachment so it renders in the email.
const logoBase64 = LOGO_BASE64;

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br>');

// Best-effort in-memory rate limiter. Edge isolates are ephemeral and not
// shared, so this only throttles within a single warm isolate — still enough
// to blunt reset-email spam. Keyed by email: max 3 sends/hour.
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const rateHits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (rateHits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) {
    rateHits.set(key, hits);
    return true;
  }
  hits.push(now);
  rateHits.set(key, hits);
  return false;
}

function row(label: string, value: string): string {
  return `
    <tr>
      <td class="fv-label" style="padding:8px 8px 8px 16px;color:#666;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;vertical-align:top;width:150px">${label}</td>
      <td class="fv-value" style="padding:8px 20px 8px 0;color:#111;font-size:14px;line-height:20px">${value}</td>
    </tr>`;
}

function template(title: string, accent: string, rows: string, extra = ''): string {
  const logo = logoBase64
    ? `<img src="cid:fitvoid-logo" width="56" height="56" alt="Fit Void" style="border-radius:14px;display:block;margin:0 auto 16px">`
    : `<div class="fv-wordmark" style="color:#111;font-size:22px;font-weight:900;letter-spacing:3px;text-align:center;margin-bottom:16px">FIT VOID</div>`;
  return `<!doctype html>
<html>
<head>
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
  :root { color-scheme: light dark; }
  @media (prefers-color-scheme: dark) {
    body, .fv-outer, .fv-outer td, .fv-wrap, .fv-card, .fv-card td { background: #000000 !important; }
    .fv-card { border: 1px solid #1c1c1c !important; }
    .fv-cardhead { border-bottom: 1px solid #1c1c1c !important; }
    .fv-label { color: #8b8b8b !important; }
    .fv-value { color: #f2f2f2 !important; }
    .fv-footer { color: #444 !important; }
    .fv-wordmark { color: #ccff00 !important; }
    .fv-link { color: #ccff00 !important; border-color: #333 !important; }
  }
</style>
</head>
<body bgcolor="#f2f2f2" style="margin:0;padding:0;background:#f2f2f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f2f2f2" class="fv-outer" style="background:#f2f2f2">
<tr><td align="center" style="padding:32px 16px">
  <div class="fv-wrap" style="max-width:520px;font-family:-apple-system,Helvetica,Arial,sans-serif;text-align:left">
    ${logo}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" class="fv-card" style="background:#ffffff;border:1px solid #e2e2e2;border-radius:14px">
      <tr><td class="fv-cardhead" style="padding:16px 20px;border-bottom:1px solid #e2e2e2">
        <span style="display:inline-block;background:${accent};color:#0a0a00;font-size:10px;font-weight:900;letter-spacing:2px;padding:4px 10px;border-radius:6px">${title}</span>
      </td></tr>
      <tr><td style="padding:14px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          ${rows}
        </table>
      </td></tr>
      ${extra ? `<tr><td style="padding:0 20px 18px">${extra}</td></tr>` : ''}
    </table>
    <p class="fv-footer" style="color:#999;font-size:11px;text-align:center;margin-top:20px">Sent from the Fit Void app</p>
  </div>
</td></tr>
</table>
</body></html>`;
}

const ok = () =>
  new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!RESEND_API_KEY) return new Response('RESEND_API_KEY not set', { status: 500 });

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
  if (!email) return new Response('email required', { status: 400 });
  if (rateLimited(email)) return new Response('rate limited', { status: 429 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: REDIRECT_TO },
  });

  const actionLink = data?.properties?.action_link;
  // Unknown email or link generation failure: pretend success so the endpoint
  // can't be used to enumerate accounts.
  if (error || !actionLink) return ok();

  const html = template(
    'RESET PASSWORD', '#ccff00',
    row('Heads up', esc('Tap below to choose a new password.')) +
      row('Expires', esc('This link expires in 1 hour.')) +
      row('Not you?', esc("If you didn't request this, ignore it - your password stays the same.")),
    `<a href="${actionLink}" class="fv-link" style="display:block;background:#ccff00;color:#0a0a00;font-size:14px;font-weight:900;letter-spacing:2px;text-align:center;text-decoration:none;border-radius:8px;padding:14px">RESET PASSWORD</a>`,
  );

  const payload: Record<string, unknown> = {
    from: NOTIFY_FROM,
    to: [email],
    subject: 'Reset your Fit Void password',
    html,
  };
  if (logoBase64) {
    payload.attachments = [{
      filename: 'logo.png',
      content: logoBase64,
      content_id: 'fitvoid-logo',
    }];
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    return new Response(`resend failed: ${err}`, { status: 502 });
  }
  return ok();
});
