/**
 * Barcode → nutrition via Open Food Facts (free, no API key, CC-BY-SA data).
 * Falls back to USDA FoodData Central for generic/unbranded foods.
 * FatSecret and Nutritionix calls go through the `food-lookup` edge function
 * so their API secrets never ship in the app bundle.
 * https://world.openfoodfacts.org/data
 * https://fdc.nal.usda.gov/api-guide.html
 */

import { getFoodByBarcode, saveFoodItem } from '@/db/repo/foodItems';
import { defaultServingLabel, isDrinkProduct, parseServing } from '@/lib/servingUnits';
import { getSupabase } from '@/supabase/client';

export interface FoodProduct {
  barcode: string;
  name: string;
  brand: string | null;
  /** Basis the numbers below refer to, e.g. "1 bar (45 g)" or "100 g". */
  serving: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** Sugars per serving (g); 0 when the source doesn't report them. */
  sugar_g: number;
  /** Scanned/packaged drinks get a liquid_entries row + drink insights. */
  is_drink: boolean;
  image_url: string | null;
  per100g: { calories: number; protein_g: number; carbs_g: number; fat_g: number; sugar_g: number };
}

const OFF = 'https://world.openfoodfacts.org/api/v2/product';
const FIELDS = 'product_name,brands,serving_size,nutriments,categories_tags,image_front_small_url,image_front_url,image_url';
const USDA_KEY = process.env.EXPO_PUBLIC_USDA_API_KEY ?? 'DEMO_KEY';
const USDA_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search';

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
};

const cache = new Map<string, FoodProduct | null>();
const usdaCache = new Map<string, FoodProduct | null>();
const nixCache = new Map<string, FoodProduct | null>();

// -- Secret-bearing providers (FatSecret / Nutritionix) via edge function ------
// The `food-lookup` edge function holds the API secrets and returns RAW
// upstream JSON tagged with which provider it came from, so the normalizers
// below are the same transforms the direct-fetch code used.

interface LookupResponse {
  provider: 'nutritionix' | 'fatsecret' | null;
  data: unknown;
}

async function invokeFoodLookup(body: Record<string, unknown>): Promise<LookupResponse | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb.functions.invoke('food-lookup', { body });
    if (error || !data) return null;
    return data as LookupResponse;
  } catch {
    return null;
  }
}

interface NixFood {
  food_name?: string; brand_name?: string;
  nf_calories?: number; nf_protein?: number;
  nf_total_carbohydrate?: number; nf_total_fat?: number;
  serving_qty?: number; serving_unit?: string; serving_weight_grams?: number;
  nf_sugars?: number;
  photo?: { thumb?: string; highres?: string };
}

function mapNixFood(barcode: string, f: NixFood): FoodProduct {
  const name = f.food_name ?? 'Unknown';
  const declared = f.serving_qty && f.serving_unit ? `${f.serving_qty} ${f.serving_unit}` : null;
  const drink = isDrinkProduct({ name, serving: declared });
  const serving = declared ?? defaultServingLabel(drink);
  // serving_weight_grams is the clean path to per-100g. When it's missing,
  // pull a gram quantity out of the serving string ("1 bar (45 g)", "30 g")
  // before falling back - otherwise per-serving values get stored as
  // per-100g and recipeImport's grams/100 scaling inflates them.
  let grams = f.serving_weight_grams ?? 0;
  if (!grams) {
    const parsed = parseServing(serving);
    if (parsed.basis === 'weight') grams = parsed.qty * parsed.mlPerUnit; // conv = g per unit
  }
  const per100g = grams > 0
    ? {
        calories: num((f.nf_calories ?? 0) / grams * 100),
        protein_g: num((f.nf_protein ?? 0) / grams * 100),
        carbs_g: num((f.nf_total_carbohydrate ?? 0) / grams * 100),
        fat_g: num((f.nf_total_fat ?? 0) / grams * 100),
        sugar_g: num((f.nf_sugars ?? 0) / grams * 100),
      }
    // Last resort: per-serving values stand in for per-100g. Slightly wrong
    // for non-100g servings but consistent with the declared serving label.
    : { calories: num(f.nf_calories), protein_g: num(f.nf_protein), carbs_g: num(f.nf_total_carbohydrate), fat_g: num(f.nf_total_fat), sugar_g: num(f.nf_sugars) };
  return {
    barcode,
    name,
    brand: f.brand_name ?? null,
    serving,
    calories: num(f.nf_calories),
    protein_g: num(f.nf_protein),
    carbs_g: num(f.nf_total_carbohydrate),
    fat_g: num(f.nf_total_fat),
    sugar_g: num(f.nf_sugars),
    is_drink: drink,
    image_url: f.photo?.thumb ?? f.photo?.highres ?? null,
    per100g,
  };
}

interface FsFoodDetail {
  food?: {
    food_name?: string; brand_name?: string;
    servings?: { serving?: Array<{
      serving_description?: string; calories?: string; protein?: string;
      carbohydrate?: string; fat?: string; sugar?: string;
    }> };
  };
}

function mapFsFoodDetail(barcode: string, detail: FsFoodDetail): FoodProduct | null {
  const food = detail.food;
  const serving = food?.servings?.serving?.[0];
  if (!serving) return null;
  const name = food?.food_name ?? 'Unknown';
  const servingStr = serving.serving_description ?? '1 serving';
  // FatSecret values are per-serving. If the description carries a gram
  // weight ("1 bar (45 g)", "100 g") scale to a real per-100g; otherwise
  // per-100g stands in as per-serving (consistent with the serving label,
  // but recipeImport's grams/100 scaling will overstate non-100g servings).
  const parsed = parseServing(servingStr);
  const grams = parsed.basis === 'weight' ? parsed.qty * parsed.mlPerUnit : 0;
  const scale = (v: unknown) => num(num(v) / grams * 100);
  const per100g = grams > 0
    ? {
        calories: scale(serving.calories),
        protein_g: scale(serving.protein),
        carbs_g: scale(serving.carbohydrate),
        fat_g: scale(serving.fat),
        sugar_g: scale(serving.sugar),
      }
    : { calories: num(serving.calories), protein_g: num(serving.protein), carbs_g: num(serving.carbohydrate), fat_g: num(serving.fat), sugar_g: num(serving.sugar) };
  return {
    barcode,
    name,
    brand: food?.brand_name ?? null,
    serving: servingStr,
    calories: num(serving.calories),
    protein_g: num(serving.protein),
    carbs_g: num(serving.carbohydrate),
    fat_g: num(serving.fat),
    sugar_g: num(serving.sugar),
    is_drink: isDrinkProduct({ name, serving: servingStr }),
    image_url: null, // FatSecret food.get carries no image
    per100g,
  };
}

/** Barcode lookup across the secret-bearing providers (Nutritionix, then
 *  FatSecret) via the food-lookup edge function. */
async function lookupRemoteBarcode(barcode: string): Promise<FoodProduct | null> {
  if (nixCache.has(barcode)) return nixCache.get(barcode)!;
  const res = await invokeFoodLookup({ op: 'barcode', code: barcode });
  if (res === null) return null; // offline / edge unreachable - don't cache
  let out: FoodProduct | null = null;
  if (res.provider === 'nutritionix') {
    const f = (res.data as { foods?: NixFood[] })?.foods?.[0];
    if (f) out = mapNixFood(barcode, f);
  } else if (res.provider === 'fatsecret') {
    out = mapFsFoodDetail(barcode, res.data as FsFoodDetail);
  }
  nixCache.set(barcode, out);
  return out;
}

function mapOFFProduct(code: string, p: {
  product_name?: string;
  brands?: string;
  serving_size?: string;
  nutriments?: Record<string, unknown>;
  categories_tags?: string[];
  image_front_small_url?: string;
  image_front_url?: string;
  image_url?: string;
}): FoodProduct | null {
  if (!p.nutriments) return null;
  const n = p.nutriments;
  const per100g = {
    calories: num(n['energy-kcal_100g'] ?? (num(n['energy_100g']) ? num(n['energy_100g']) / 4.184 : 0)),
    protein_g: num(n['proteins_100g']),
    carbs_g: num(n['carbohydrates_100g']),
    fat_g: num(n['fat_100g']),
    sugar_g: num(n['sugars_100g']),
  };
  const hasServing = n['energy-kcal_serving'] != null || n['proteins_serving'] != null;
  // When per-serving values exist but OFF didn't publish a serving_size,
  // label it honestly as a count ("1 serving") - calling it "100 g" would
  // make the weight path scale per-serving macros as if they were per-100g.
  const name = (p.product_name || 'Unknown product').trim();
  const declared = hasServing ? (p.serving_size ?? '1 serving') : null;
  const drink = isDrinkProduct({ name, serving: declared, categories: p.categories_tags });
  const serving = declared ?? defaultServingLabel(drink);
  return {
    barcode: code,
    name,
    brand: p.brands ? p.brands.split(',')[0].trim() : null,
    serving,
    calories: hasServing ? num(n['energy-kcal_serving']) || per100g.calories : per100g.calories,
    protein_g: hasServing ? num(n['proteins_serving']) || per100g.protein_g : per100g.protein_g,
    carbs_g: hasServing ? num(n['carbohydrates_serving']) || per100g.carbs_g : per100g.carbs_g,
    fat_g: hasServing ? num(n['fat_serving']) || per100g.fat_g : per100g.fat_g,
    sugar_g: hasServing ? num(n['sugars_serving']) || per100g.sugar_g : per100g.sugar_g,
    is_drink: drink,
    image_url: p.image_front_small_url ?? p.image_front_url ?? p.image_url ?? null,
    per100g,
  };
}

interface UsdaNutrient {
  nutrientName?: string;
  unitName?: string;
  nutrientId?: number;
  value?: number;
}

function mapUSDAFood(f: {
  description?: string;
  brandName?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: UsdaNutrient[];
  gtinUpc?: string;
}): FoodProduct | null {
  if (!f.foodNutrients) return null;
  const nutrients = f.foodNutrients;
  // FDC lists "Energy" twice - kcal (nutrientId 1008) and kJ (1062). Matching
  // by name alone can grab the kJ row and inflate calories ~4.2×.
  const get = (names: string[], opts: { kcal?: boolean; exclude?: RegExp } = {}) => {
    for (const name of names) {
      const n = nutrients.find((x) => {
        const nm = x.nutrientName?.toLowerCase() ?? '';
        if (!nm.includes(name)) return false;
        if (opts.exclude?.test(nm)) return false;
        if (opts.kcal && !(x.unitName?.toLowerCase() === 'kcal' || x.nutrientId === 1008)) return false;
        return true;
      });
      if (n?.value != null) return num(n.value);
    }
    return 0;
  };
  const kj = nutrients.find(
    (x) => (x.nutrientName?.toLowerCase().includes('energy')) && x.unitName?.toLowerCase() === 'kj'
  );
  const per100g = {
    calories: get(['energy'], { kcal: true }) || (kj?.value != null ? num(kj.value / 4.184) : 0),
    protein_g: get(['protein']),
    carbs_g: get(['carbohydrate']),
    fat_g: get(['total lipid', 'lipid', 'fat'], { exclude: /fatty acid/ }),
    sugar_g: get(['sugars, total', 'total sugars', 'sugar'], { exclude: /alcohol/ }),
  };
  const declared = f.servingSize ? `${f.servingSize}${f.servingSizeUnit ?? 'g'}` : null;
  const name = f.description ?? 'Unknown';
  const drink = isDrinkProduct({ name, serving: declared });
  const serving = declared ?? defaultServingLabel(drink);
  return {
    barcode: f.gtinUpc ?? '',
    name,
    brand: f.brandName ?? null,
    serving,
    calories: per100g.calories,
    protein_g: per100g.protein_g,
    carbs_g: per100g.carbs_g,
    fat_g: per100g.fat_g,
    sugar_g: per100g.sugar_g,
    is_drink: drink,
    image_url: null, // USDA FDC doesn't publish product images
    per100g,
  };
}

async function lookupUSDA(barcode: string): Promise<FoodProduct | null> {
  if (usdaCache.has(barcode)) return usdaCache.get(barcode)!;
  try {
    const res = await fetch(`${USDA_SEARCH}?api_key=${USDA_KEY}&query=${encodeURIComponent(barcode)}&pageSize=5&dataType=Branded`);
    if (!res.ok) return null; // transient server error - don't cache a null over the barcode
    const json = (await res.json()) as { foods?: Array<{
      description?: string; brandName?: string; servingSize?: number;
      servingSizeUnit?: string; foodNutrients?: UsdaNutrient[];
      gtinUpc?: string;
    }> };
    // Barcode lookups require an exact GTIN/UPC match - persisting a fuzzy
    // first-hit under this barcode would poison the local cache permanently.
    // Leading zeros are normalised so a UPC-A code still matches its EAN-13 form.
    const bare = barcode.replace(/^0+/, '');
    const match = json.foods?.find((f) => f.gtinUpc?.replace(/\D/g, '').replace(/^0+/, '') === bare);
    if (!match) { usdaCache.set(barcode, null); return null; }
    const out = mapUSDAFood(match);
    usdaCache.set(barcode, out);
    return out;
  } catch {
    return null;
  }
}

/** Reflect a user-corrected product in the in-memory lookup cache so a rescan
 *  in the same session returns the edited values immediately. */
export function primeFoodCache(product: FoodProduct): void {
  const code = product.barcode.replace(/\D/g, '');
  if (code) cache.set(code, product);
}

export async function lookupBarcode(barcode: string): Promise<FoodProduct | null> {
  const code = barcode.replace(/\D/g, '');
  if (!code) return null;
  if (cache.has(code)) return cache.get(code)!;

  // 0. Previously scanned - persisted in SQLite, survives reinstall via sync.
  try {
    const stored = await getFoodByBarcode(code);
    if (stored) {
      // FoodItem.serving is nullable in the DB; FoodProduct wants a label.
      const product: FoodProduct = { ...stored, serving: stored.serving ?? defaultServingLabel(stored.is_drink) };
      cache.set(code, product);
      saveFoodItem(stored).catch(() => {}); // bump last_used_at
      return product;
    }
  } catch { /* DB not ready - fall through to remote */ }

  const persist = (p: FoodProduct): FoodProduct => {
    cache.set(code, p);
    saveFoodItem(p).catch((e) => console.warn('[foodLookup] saveFoodItem failed', e));
    return p;
  };

  // 1. Open Food Facts (free, no key)
  try {
    const res = await fetch(`${OFF}/${code}.json?fields=${FIELDS}`, {
      headers: { 'User-Agent': 'GymVoid/1.0 (ios; contact: app)' },
    });
    if (res.ok) {
      const json = (await res.json()) as {
        status: number;
        product?: { product_name?: string; brands?: string; serving_size?: string; nutriments?: Record<string, unknown>; image_front_small_url?: string; image_front_url?: string; image_url?: string };
      };
      if (json.status === 1 && json.product?.nutriments) {
        const out = mapOFFProduct(code, json.product);
        if (out) return persist(out);
      }
    }
  } catch { /* fall through */ }

  // 2. Nutritionix + FatSecret via the food-lookup edge function
  //    (secrets live server-side; best barcode + UK coverage)
  const remote = await lookupRemoteBarcode(code);
  if (remote) return persist(remote);

  // 3. USDA FDC (free, good for generic/branded foods)
  const usda = await lookupUSDA(code);
  if (usda) {
    usda.barcode = code;
    return persist(usda);
  }

  cache.set(code, null);
  return null;
}

/**
 * Search Open Food Facts by ingredient name. Returns the best match's
 * per-100g nutrition so we can estimate per-ingredient macros during import.
 *
 * Uses the /cgi/search.pl endpoint which is the documented text search API.
 * https://wiki.openfoodfacts.org/API/Searching
 */
const searchCache = new Map<string, FoodProduct | null>();

export async function searchFoodByName(query: string): Promise<FoodProduct | null> {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  if (searchCache.has(q)) return searchCache.get(q)!;

  // Try Open Food Facts first
  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&fields=product_name,brands,serving_size,nutriments,code,image_front_small_url,image_front_url,image_url&page_size=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GymVoid/1.0 (ios; contact: app)' },
    });
    if (res.ok) {
      const json = (await res.json()) as {
        count?: number;
        products?: Array<{
          product_name?: string;
          brands?: string;
          serving_size?: string;
          nutriments?: Record<string, unknown>;
          code?: string;
          image_front_small_url?: string;
          image_front_url?: string;
          image_url?: string;
        }>;
      };
      const p = json.products?.[0];
      if (p?.nutriments) {
        const out = mapOFFProduct(p.code ?? '', p);
        if (out) { searchCache.set(q, out); return out; }
      }
    }
  } catch {
    // fall through to USDA
  }

  // USDA FDC fallback - good for generic/unbranded foods
  try {
    const res = await fetch(
      `${USDA_SEARCH}?api_key=${USDA_KEY}&query=${encodeURIComponent(q)}&pageSize=3`
    );
    if (res.ok) {
      const json = (await res.json()) as {
        foods?: Array<{
          description?: string; brandName?: string; servingSize?: number;
          servingSizeUnit?: string; foodNutrients?: UsdaNutrient[];
          gtinUpc?: string;
        }>;
      };
      const match = json.foods?.[0];
      if (match) {
        const out = mapUSDAFood(match);
        if (out) { searchCache.set(q, out); return out; }
      }
    }
  } catch { /* fall through */ }

  // Nutritionix natural-language / FatSecret search via the edge function
  const res = await invokeFoodLookup({ op: 'search', query: q });
  if (res?.provider === 'nutritionix') {
    const f = (res.data as { foods?: NixFood[] })?.foods?.[0];
    if (f) {
      const out = mapNixFood('', f);
      if (!out.name || out.name === 'Unknown') out.name = query;
      searchCache.set(q, out);
      return out;
    }
  } else if (res?.provider === 'fatsecret') {
    const out = mapFsFoodDetail('', res.data as FsFoodDetail);
    if (out) {
      searchCache.set(q, out);
      return out;
    }
  }

  searchCache.set(q, null);
  return null;
}
