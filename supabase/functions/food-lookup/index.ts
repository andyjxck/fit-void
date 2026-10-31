// Supabase Edge Function: food-lookup
// Server-side proxy for nutrition providers whose API secrets must not ship in
// the app bundle: FatSecret (OAuth client-credentials) and Nutritionix
// (x-app-id / x-app-key). Open Food Facts and USDA calls stay client-side —
// they need no secrets.
//
// Deploy:  supabase functions deploy food-lookup
// Secrets: supabase secrets set FATSECRET_CLIENT_ID=... FATSECRET_CLIENT_SECRET=...
//                           NUTRITIONIX_APP_ID=... NUTRITIONIX_APP_KEY=...
//
// Invoke: supabase.functions.invoke('food-lookup', { body })
//   { op: 'barcode', code }            -> { provider, data } (raw upstream JSON)
//   { op: 'search',  query }           -> { provider, data }
//   { op: 'item',    id, provider }    -> { provider, data }
//
// `provider` is 'nutritionix' | 'fatsecret' | null; `data` is the raw upstream
// response so the client's existing normalizers keep working unchanged.

const FS_ID = Deno.env.get('FATSECRET_CLIENT_ID');
const FS_SECRET = Deno.env.get('FATSECRET_CLIENT_SECRET');
const NIX_ID = Deno.env.get('NUTRITIONIX_APP_ID');
const NIX_KEY = Deno.env.get('NUTRITIONIX_APP_KEY');

const FS_TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
const FS_API = 'https://platform.fatsecret.com/rest/server.api';
const NIX_ITEM = 'https://trackapi.nutritionix.com/v2/search/item';
const NIX_SEARCH = 'https://trackapi.nutritionix.com/v2/natural/nutrients';

// Best-effort in-memory rate limiter. Edge isolates are ephemeral and not
// shared, so this only throttles within a single warm isolate — still enough
// to stop a client loop from hammering the upstream APIs. Keyed by caller IP
// (x-forwarded-for): max 60 requests/hour.
const RATE_LIMIT = 60;
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// -- FatSecret OAuth ----------------------------------------------------------

const fsTokenCache = { token: '', expiry: 0 };

async function getFatSecretToken(): Promise<string | null> {
  if (!FS_ID || !FS_SECRET) return null;
  if (fsTokenCache.token && Date.now() < fsTokenCache.expiry) return fsTokenCache.token;
  try {
    const res = await fetch(FS_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(`${FS_ID}:${FS_SECRET}`)}`,
      },
      body: 'grant_type=client_credentials&scope=basic',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) return null;
    fsTokenCache.token = body.access_token;
    fsTokenCache.expiry = Date.now() + (body.expires_in ?? 3600) * 1000 - 60000;
    return body.access_token;
  } catch {
    return null;
  }
}

async function fsCall(params: string): Promise<unknown | null> {
  const token = await getFatSecretToken();
  if (!token) return null;
  try {
    const res = await fetch(`${FS_API}?format=json&${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** FatSecret search + detail for a term (barcode or name). Returns the raw
 *  food.get response so the client sees the full serving list. */
async function fsSearchAndGet(term: string): Promise<unknown | null> {
  const search = (await fsCall(
    `method=foods.search&search_expression=${encodeURIComponent(term)}&max_results=1`
  )) as { foods?: { food?: Array<{ food_id?: string }> } } | null;
  const foodId = search?.foods?.food?.[0]?.food_id;
  if (!foodId) return null;
  return fsCall(`method=food.get&food_id=${encodeURIComponent(foodId)}`);
}

// -- Nutritionix --------------------------------------------------------------

function nixHeaders(): Record<string, string> | null {
  if (!NIX_ID || !NIX_KEY) return null;
  return { 'x-app-id': NIX_ID, 'x-app-key': NIX_KEY };
}

async function nixItem(param: string, value: string): Promise<unknown | null> {
  const headers = nixHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(`${NIX_ITEM}?${param}=${encodeURIComponent(value)}`, { headers });
    if (!res.ok) return null;
    const data = (await res.json()) as { foods?: unknown[] };
    return data.foods?.length ? data : null;
  } catch {
    return null;
  }
}

async function nixNatural(query: string): Promise<unknown | null> {
  const headers = nixHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(NIX_SEARCH, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { foods?: unknown[] };
    return data.foods?.length ? data : null;
  } catch {
    return null;
  }
}

// -- Handler ------------------------------------------------------------------

interface LookupBody {
  op?: 'barcode' | 'search' | 'item';
  code?: string;
  query?: string;
  id?: string;
  provider?: 'nutritionix' | 'fatsecret';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return new Response('rate limited', { status: 429 });

  let body: LookupBody;
  try {
    body = await req.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }

  if (body.op === 'barcode') {
    const code = (body.code ?? '').replace(/\D/g, '');
    if (!code) return new Response('code required', { status: 400 });
    // Nutritionix has the best barcode coverage; FatSecret fills UK gaps.
    const nix = await nixItem('upc', code);
    if (nix) return json({ provider: 'nutritionix', data: nix });
    const fs = await fsSearchAndGet(code);
    if (fs) return json({ provider: 'fatsecret', data: fs });
    return json({ provider: null, data: null });
  }

  if (body.op === 'search') {
    const query = (body.query ?? '').trim();
    if (!query) return new Response('query required', { status: 400 });
    const nix = await nixNatural(query);
    if (nix) return json({ provider: 'nutritionix', data: nix });
    const fs = await fsSearchAndGet(query);
    if (fs) return json({ provider: 'fatsecret', data: fs });
    return json({ provider: null, data: null });
  }

  if (body.op === 'item') {
    const id = (body.id ?? '').trim();
    if (!id) return new Response('id required', { status: 400 });
    if (body.provider === 'fatsecret') {
      const fs = await fsCall(`method=food.get&food_id=${encodeURIComponent(id)}`);
      return json(fs ? { provider: 'fatsecret', data: fs } : { provider: null, data: null });
    }
    if (body.provider === 'nutritionix') {
      const nix = await nixItem('nix_item_id', id);
      return json(nix ? { provider: 'nutritionix', data: nix } : { provider: null, data: null });
    }
    return new Response('provider must be fatsecret or nutritionix', { status: 400 });
  }

  return new Response('invalid op', { status: 400 });
});
