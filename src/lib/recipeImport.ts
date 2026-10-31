/**
 * Paste-a-link import. Recipe sites almost universally embed a
 * schema.org/Recipe object as JSON-LD; that's what we read. Nothing here
 * scrapes visible HTML, so it degrades to "couldn't find a recipe" rather
 * than producing garbage.
 */

export interface ImportedIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  /** Per-ingredient macros if we could estimate them; null otherwise. */
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
}

export interface ImportedRecipe {
  name: string;
  description: string | null;
  /** Servings the site declared; null when it didn't publish a yield. */
  servings: number | null;
  ingredients: ImportedIngredient[];
  method: string[];
  /** Per-serving macros if the site published them; null otherwise. */
  nutrition: { calories: number; protein_g: number; carbs_g: number; fat_g: number } | null;
  sourceUrl: string;
  tags: string[];
  /** Hero photo - JSON-LD `image` or the page's og:image. */
  imageUrl: string | null;
}

type Json = Record<string, unknown>;

const UNITS = [
  'cups?', 'tbsps?', 'tablespoons?', 'tsps?', 'teaspoons?', 'g', 'grams?', 'kg', 'ml', 'l', 'litres?', 'liters?',
  'oz', 'ounces?', 'lbs?', 'pounds?', 'cloves?', 'slices?', 'cans?', 'tins?', 'pinch', 'handfuls?', 'scoops?',
  'pieces?', 'large', 'medium', 'small', 'whole',
];
const UNIT_RE = new RegExp(`^(${UNITS.join('|')})\\b\\.?\\s*`, 'i');
const VULGAR_CHARS = '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
const FRACTIONS: Record<string, number> = {
  '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4,
  '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5,
  '⅙': 1 / 6, '⅚': 5 / 6,
  '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
};

/** "12,5" is a decimal comma; "1,500" is a thousands separator. */
function parseNum(t: string): number | null {
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return parseFloat(t.replace(/,/g, ''));
  const n = parseFloat(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseQty(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (FRACTIONS[t] != null) return FRACTIONS[t];
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return +mixed[1] + +mixed[2] / +mixed[3];
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return +frac[2] ? +frac[1] / +frac[2] : null;
  const vMixed = t.match(new RegExp(`^(\\d+)\\s*([${VULGAR_CHARS}])$`)); // "1½"
  if (vMixed) return +vMixed[1] + (FRACTIONS[vMixed[2]] ?? 0);
  const range = t.match(/^(\d+(?:[.,]\d+)?)\s*[-\u2013\u2014]\s*(\d+(?:[.,]\d+)?)$/);
  if (range) {
    const a = parseNum(range[1]);
    const b = parseNum(range[2]);
    return a != null && b != null ? (a + b) / 2 : null;
  }
  return parseNum(t);
}

/** "2 1/2 cups rolled oats" → { quantity: 2.5, unit: 'cups', name: 'rolled oats' } */
export function parseIngredientLine(line: string): ImportedIngredient {
  let s = line.replace(/\s+/g, ' ').trim();
  let quantity: number | null = null;
  let unit: string | null = null;

  // Handle "400g can" or "100g Greek yogurt" - quantity+unit attached without space.
  const attached = s.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|oz|lb)\b\s*/i);
  if (attached) {
    quantity = parseQty(attached[1]);
    unit = attached[2].toLowerCase();
    s = s.slice(attached[0].length);
  } else {
    const m = s.match(new RegExp(`^((?:\\d+\\s+\\d+\\/\\d+)|(?:\\d+\\/\\d+)|(?:\\d+\\s*[${VULGAR_CHARS}])|(?:\\d+(?:[.,]\\d+)?(?:\\s*[-\u2013\u2014]\\s*\\d+(?:[.,]\\d+)?)?)|[${VULGAR_CHARS}])\\s*`));
    if (m) {
      quantity = parseQty(m[1]);
      s = s.slice(m[0].length);
    }
    const u = s.match(UNIT_RE);
    if (u) {
      unit = u[1].toLowerCase().replace(/s$/, '').replace(/^tablespoon$/, 'tbsp').replace(/^teaspoon$/, 'tsp').replace(/^gram$/, 'g');
      s = s.slice(u[0].length);
    }
  }
  s = s.replace(/^of\s+/i, '').replace(/,\s*$/, '').trim();
  // Clean up trailing preparation notes in parentheses.
  s = s.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return { name: s || line.trim(), quantity, unit };
}

const numFrom = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return 0;
  let t = v.trim();
  // "1,500" thousands vs "12,5" decimal comma - same rule as parseQty.
  t = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  const n = parseFloat(t.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const strFrom = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() || null;
  if (Array.isArray(v)) return strFrom(v[0]);
  if (v && typeof v === 'object' && '@value' in (v as Json)) return strFrom((v as Json)['@value']);
  return null;
};

function servingsFrom(v: unknown): number | null {
  const s = strFrom(v);
  if (!s) return null;
  const n = parseInt(s.replace(/\D+/g, ' ').trim().split(' ')[0] || '', 10);
  return n > 0 && n <= 50 ? n : null;
}

function stepsFrom(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === 'string') return v.split(/\r?\n+/).map((x) => x.trim()).filter(Boolean);
  if (!Array.isArray(v)) return stepsFrom([v]);
  const out: string[] = [];
  for (const it of v) {
    if (typeof it === 'string') out.push(it.trim());
    else if (it && typeof it === 'object') {
      const o = it as Json;
      if (o['@type'] === 'HowToSection' && Array.isArray(o.itemListElement)) out.push(...stepsFrom(o.itemListElement));
      else if (typeof o.text === 'string') out.push(o.text.trim());
      else if (typeof o.name === 'string') out.push(o.name.trim());
    }
  }
  return out.filter(Boolean);
}

function isRecipe(o: unknown): o is Json {
  if (!o || typeof o !== 'object') return false;
  const t = (o as Json)['@type'];
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
}

/** Depth-first search of a JSON-LD document for Recipe nodes (handles @graph, arrays, nesting). */
function findRecipes(node: unknown, out: Json[] = [], depth = 0): Json[] {
  if (depth > 6 || !node) return out;
  if (Array.isArray(node)) {
    for (const n of node) findRecipes(n, out, depth + 1);
  } else if (typeof node === 'object') {
    if (isRecipe(node)) out.push(node);
    const o = node as Json;
    if (o['@graph']) findRecipes(o['@graph'], out, depth + 1);
    if (o.mainEntity) findRecipes(o.mainEntity, out, depth + 1);
  }
  return out;
}

function stripHtml(s: string | null): string | null {
  return s ? s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim() || null : null;
}

/** JSON-LD image can be a URL string, an ImageObject ({url}), or an array. */
function imageFrom(v: unknown): string | null {
  const one = (x: unknown): string | null => {
    if (typeof x === 'string' && /^https?:\/\//.test(x)) return x;
    if (x && typeof x === 'object') {
      const u = (x as Json).url ?? (x as Json).contentUrl;
      if (typeof u === 'string' && /^https?:\/\//.test(u)) return u;
    }
    return null;
  };
  if (Array.isArray(v)) {
    for (const x of v) {
      const u = one(x);
      if (u) return u;
    }
    return null;
  }
  return one(v);
}

export function recipeFromJsonLd(node: Json, sourceUrl: string): ImportedRecipe {
  const nut = node.nutrition as Json | undefined;
  const ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : Array.isArray(node.ingredients) ? node.ingredients : [])
    .filter((x): x is string => typeof x === 'string')
    .map(parseIngredientLine);
  const tags = [node.recipeCategory, node.recipeCuisine, node.keywords]
    .flatMap((v) => (typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v : []))
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 6);
  return {
    name: stripHtml(strFrom(node.name)) ?? 'Imported recipe',
    description: stripHtml(strFrom(node.description)),
    servings: servingsFrom(node.recipeYield ?? node.yield),
    ingredients,
    method: stepsFrom(node.recipeInstructions).map((s) => stripHtml(s) ?? s),
    nutrition:
      nut && (nut.calories != null || nut.proteinContent != null)
        ? {
            calories: Math.round(numFrom(nut.calories)),
            protein_g: numFrom(nut.proteinContent),
            carbs_g: numFrom(nut.carbohydrateContent),
            fat_g: numFrom(nut.fatContent),
          }
        : null,
    sourceUrl,
    tags,
    imageUrl: imageFrom(node.image ?? node.thumbnailUrl),
  };
}

/** Pull every <script type="application/ld+json"> block and parse. Pure; testable. */
export function extractRecipesFromHtml(html: string, sourceUrl: string): ImportedRecipe[] {
  const out: ImportedRecipe[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const json = JSON.parse(m[1].trim());
      for (const r of findRecipes(json)) out.push(recipeFromJsonLd(r, sourceUrl));
    } catch {
      // Malformed block - skip, keep looking.
    }
  }
  // og:image fallback for recipes whose JSON-LD didn't carry a photo.
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
  if (og && /^https?:\/\//.test(og)) {
    for (const r of out) r.imageUrl ??= og;
  }
  return out;
}

export function normaliseUrl(input: string): string | null {
  const s = input.trim().match(/https?:\/\/[^\s<>"']+/)?.[0] ?? (input.trim().includes('.') ? `https://${input.trim()}` : null);
  if (!s) return null;
  try {
    return new URL(s).toString();
  } catch {
    return null;
  }
}

export async function importRecipesFromUrl(url: string): Promise<ImportedRecipe[]> {
  const res = await fetch(url, {
    headers: {
      // Some sites serve a bot-wall to unknown UAs; a browser-ish UA gets the real page.
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`Site returned ${res.status}`);
  const recipes = extractRecipesFromHtml(await res.text(), url);

  // Enrich ingredients with per-ingredient nutrition from Open Food Facts.
  // Run lookups in parallel (bounded) so the user doesn't wait too long.
  for (const recipe of recipes) {
    await enrichIngredients(recipe);
  }
  return recipes;
}

/**
 * Look up each ingredient on Open Food Facts and estimate per-ingredient macros
 * based on the parsed quantity + unit. Falls back to leaving macros at 0.
 */
async function enrichIngredients(recipe: ImportedRecipe): Promise<void> {
  const { searchFoodByName } = await import('@/lib/foodLookup');

  // Limit concurrent lookups to avoid hammering the API.
  const CONCURRENCY = 5;
  const results = new Array<ImportedIngredient>(recipe.ingredients.length);

  for (let i = 0; i < recipe.ingredients.length; i += CONCURRENCY) {
    const batch = recipe.ingredients.slice(i, i + CONCURRENCY);
    const looked = await Promise.all(
      batch.map(async (ing) => {
        // Use just the ingredient name (first 2-3 words) for search.
        const searchName = ing.name.split(/[,(]/)[0].trim().split(/\s+/).slice(0, 3).join(' ');
        const product = await searchFoodByName(searchName);
        return { ing, product };
      })
    );
    for (let j = 0; j < looked.length; j++) {
      const { ing, product } = looked[j];
      if (product && ing.quantity != null) {
        // Estimate grams from the quantity + unit.
        const grams = estimateGrams(ing.quantity, ing.unit);
        if (grams > 0) {
          const factor = grams / 100;
          results[i + j] = {
            ...ing,
            calories: Math.round(product.per100g.calories * factor),
            protein_g: Math.round(product.per100g.protein_g * factor * 10) / 10,
            carbs_g: Math.round(product.per100g.carbs_g * factor * 10) / 10,
            fat_g: Math.round(product.per100g.fat_g * factor * 10) / 10,
          };
        } else {
          // No weight info - use per-serving from the product if available.
          results[i + j] = {
            ...ing,
            calories: Math.round(product.calories),
            protein_g: product.protein_g,
            carbs_g: product.carbs_g,
            fat_g: product.fat_g,
          };
        }
      } else {
        results[i + j] = ing;
      }
    }
  }
  recipe.ingredients = results;
}

/** Rough conversion of common cooking units to grams for macro estimation. */
function estimateGrams(quantity: number, unit: string | null): number {
  if (!unit) return 0;
  const u = unit.toLowerCase().replace(/s$/, '');
  // Dry/weight
  if (u === 'g' || u === 'gram') return quantity;
  if (u === 'kg') return quantity * 1000;
  if (u === 'oz') return quantity * 28.35;
  if (u === 'lb' || u === 'pound') return quantity * 453.6;
  // Volume → approximate grams (water-like density for most foods)
  if (u === 'ml' || u === 'l') return u === 'l' ? quantity * 1000 : quantity;
  if (u === 'tsp') return quantity * 5;
  if (u === 'tbsp') return quantity * 15;
  if (u === 'cup') return quantity * 240;
  if (u === 'clove') return quantity * 5; // garlic
  if (u === 'slice') return quantity * 30;
  if (u === 'can' || u === 'tin') return quantity * 400;
  if (u === 'handful') return quantity * 30;
  if (u === 'scoop') return quantity * 30;
  if (u === 'piece') return quantity * 50;
  return 0;
}
