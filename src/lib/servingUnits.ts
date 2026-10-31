/**
 * Serving-size parsing + drink detection for the food log. Pure functions so
 * they can be unit-tested under Bun.
 *
 * Model: a serving declares a quantity in some unit ("500 ml", "1 can",
 * "2 scoops (60 g)"). Custom amounts are entered in that same unit, so
 * factor = entered / declared. Volume↔weight conversion is only used to credit
 * drinks toward hydration (ml), where 1 ml ≈ 1 g is a fine approximation.
 */

export type ServingBasis = 'weight' | 'volume' | 'count';

export interface ServingUnit {
  /** Declared quantity of one serving, in `unit`. */
  qty: number;
  /** Unit label shown to the user (e.g. "ml", "g", "can"). */
  unit: string;
  basis: ServingBasis;
  /** ml credited toward hydration per 1 of `unit` (0 = count/unknown). */
  mlPerUnit: number;
}

// Ordered longest-first inside each family so alternation prefers "fl oz"
// over "oz", "litre" over "l", etc. (\b guards handle the rest.)
const UNIT_SRC =
  'fl\\.?\\s?oz|fluid\\s+ounces?|' +
  'kilograms?|kgs?|milligrams?|mcgs?|mgs?|grams?|grms?|grs?|gm\\b|g\\b|' +
  'millilitres?|milliliters?|mls?|centilitres?|centiliters?|cls?|decilitres?|deciliters?|dls?|litres?|liters?|ltrs?|l\\b|' +
  'ounces?|oz|pounds?|lbs?|' +
  'cups?|tablespoons?|tbsps?|teaspoons?|tsps?|pints?|pts?|quarts?|qts?|gallons?|gals?|' +
  'cans?|bottles?|bars?|slices?|scoops?|pieces?|packs?|servings?|portions?|cookies?|biscuits?|crackers?|squares?|sticks?|sachets?|eggs?|balls?|handfuls?|chunks?|wedges?|bites?';

// Unicode vulgar fractions found on nutrition labels ("½ cup", "1½ cups").
const VULGAR = '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
const VULGAR_VAL: Record<string, number> = {
  '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4,
  '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5,
  '⅙': 1 / 6, '⅚': 5 / 6,
  '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
};

// Quantity: mixed fraction ("1 1/2"), fraction ("1/2"), digit+unicode ("1½"),
// standalone unicode ("½"), decimal/thousands ("1.5", "12,5", "1,500"),
// leading decimal (".5"), or plain integer. Longest forms first.
const NUM =
  `(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+\\s*[${VULGAR}]|[${VULGAR}]|\\d*(?:[.,]\\d+)+|\\d+)`;

// Every "qty unit" mention in the string; paren position resolves ties below.
const QTY_UNIT_RE = new RegExp(`(${NUM})\\s*(${UNIT_SRC})\\b`, 'gi');

interface UnitDef {
  basis: ServingBasis;
  label: string;
  /** Multiplier to ml (volume) or g (weight). */
  conv?: number;
}

const UNITS: [RegExp, UnitDef][] = [
  // Weight → grams
  [/^(kilograms?|kgs?)$/, { basis: 'weight', label: 'kg', conv: 1000 }],
  [/^(milligrams?|mcgs?|mgs?)$/, { basis: 'weight', label: 'mg', conv: 0.001 }],
  [/^(grams?|grms?|grs?|gm|g)$/, { basis: 'weight', label: 'g', conv: 1 }],
  [/^(ounces?|oz)$/, { basis: 'weight', label: 'oz', conv: 28.3495 }],
  [/^(pounds?|lbs?)$/, { basis: 'weight', label: 'lb', conv: 453.592 }],
  // Volume → ml
  [/^(millilitres?|milliliters?|mls?)$/, { basis: 'volume', label: 'ml', conv: 1 }],
  [/^(centilitres?|centiliters?|cls?)$/, { basis: 'volume', label: 'cl', conv: 10 }],
  [/^(decilitres?|deciliters?|dls?)$/, { basis: 'volume', label: 'dl', conv: 100 }],
  [/^(litres?|liters?|ltrs?|l)$/, { basis: 'volume', label: 'l', conv: 1000 }],
  [/^(fl\.?\s?oz|fluid\s+ounces?)$/, { basis: 'volume', label: 'fl oz', conv: 29.5735 }],
  [/^(cups?)$/, { basis: 'volume', label: 'cup', conv: 236.588 }],
  [/^(tablespoons?|tbsps?)$/, { basis: 'volume', label: 'tbsp', conv: 14.7868 }],
  [/^(teaspoons?|tsps?)$/, { basis: 'volume', label: 'tsp', conv: 4.9289 }],
  [/^(pints?|pts?)$/, { basis: 'volume', label: 'pint', conv: 473.176 }],
  [/^(quarts?|qts?)$/, { basis: 'volume', label: 'quart', conv: 946.353 }],
  [/^(gallons?|gals?)$/, { basis: 'volume', label: 'gal', conv: 3785.41 }],
];

const COUNT_LABEL: Record<string, string> = {
  cans: 'can', bottles: 'bottle', bars: 'bar', slices: 'slice', scoops: 'scoop',
  pieces: 'piece', packs: 'pack', servings: 'serving', portions: 'portion',
  cookies: 'cookie', biscuits: 'biscuit', crackers: 'cracker', squares: 'square',
  sticks: 'stick', sachets: 'sachet', eggs: 'egg', balls: 'ball',
  handfuls: 'handful', chunks: 'chunk', wedges: 'wedge', bites: 'bite',
};

function unitDef(raw: string): UnitDef {
  const key = raw.toLowerCase().replace(/\s+/g, ' ');
  for (const [re, def] of UNITS) if (re.test(key)) return def;
  return { basis: 'count', label: COUNT_LABEL[key] ?? key };
}

/** Numeric value of a quantity token: fractions, mixed numbers, unicode
 *  vulgar fractions, thousands separators and decimal commas. */
function qtyOf(raw: string): number {
  const t = raw.trim();
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/); // "1 1/2"
  if (mixed) return +mixed[1] + +mixed[2] / +mixed[3];
  const frac = t.match(/^(\d+)\/(\d+)$/); // "1/2"
  if (frac) return +frac[2] ? +frac[1] / +frac[2] : NaN;
  const vMixed = t.match(new RegExp(`^(\\d+)\\s*([${VULGAR}])$`)); // "1½"
  if (vMixed) return +vMixed[1] + (VULGAR_VAL[vMixed[2]] ?? 0);
  if (VULGAR_VAL[t] != null) return VULGAR_VAL[t];
  // "1,500" / "1,500,000" - comma followed by exactly 3-digit groups is a
  // thousands separator; a lone "12,5" stays a decimal comma.
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return parseFloat(t.replace(/,/g, ''));
  return parseFloat(t.replace(',', '.'));
}

/**
 * Parse a serving string into { qty, unit, basis }. Falls back to 100 g -
 * Open Food Facts macros are per-100g backed, so it's the least-wrong guess.
 *
 * When several "qty unit" pairs appear ("500 ml (1 can)"), a weight/volume
 * unit beats a count unit regardless of position - the count is packaging.
 * Parentheses only break ties between same-basis candidates, so
 * "1 can (500 ml)" and "1 cup (240 ml)" still resolve to the bracketed value.
 */
export function parseServing(serving: string | null | undefined): ServingUnit {
  const s = serving ?? '';
  let best: { qty: number; def: UnitDef; score: number } | null = null;
  for (const m of s.matchAll(QTY_UNIT_RE)) {
    const before = s.slice(0, m.index);
    const inParens =
      (before.match(/\(/g)?.length ?? 0) > (before.match(/\)/g)?.length ?? 0);
    const def = unitDef(m[2]);
    // Lower score wins: count basis loses to weight/volume; within the same
    // basis a parenthesised mention ("(500 ml)") beats the loose one.
    const score = (def.basis === 'count' ? 2 : 0) + (inParens ? 0 : 1);
    if (!best || score < best.score) best = { qty: qtyOf(m[1]), def, score };
  }
  if (!best) return { qty: 100, unit: 'g', basis: 'weight', mlPerUnit: 1 };
  const { qty, def } = best;
  return {
    qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
    unit: def.label,
    basis: def.basis,
    mlPerUnit: def.conv ?? 0, // weight conv is g - ml ≈ g for drinks
  };
}

/** ml for `amount` of `u`'s unit; 0 when the unit is a count (unknown volume). */
export function mlFor(u: ServingUnit, amount: number): number {
  return Math.round(amount * u.mlPerUnit);
}

/** Fallback serving label when a data source declares none - drinks get a
 *  volume basis, foods a weight basis. */
export function defaultServingLabel(isDrink: boolean): string {
  return isDrink ? '100 ml' : '100 g';
}

/** Drink detection: beverage categories or a volume-based serving. */
const DRINK_CATEGORY = /beverage|drink|juice|soda|water|beer|wine|coffee|tea|energy-drink/i;
// Liquids that aren't really "a drink you're drinking" for hydration purposes.
const NOT_A_DRINK = /\boils?\b|sauce|condiment|vinegar|extract|syrup|honey|\bjam\b|spread|dressing|mayo|ketchup|mustard|puree|paste\b|soup|yogurt|yoghurt|cream|butter|hummus|cottage/i;
// Words in the product name that mark it as something you drink.
const DRINK_NAME =
  /beverage|\bdrink\b|juice|soda|cola|\bcoke\b|pepsi|sprite|fanta|lemonade|coffee|latte|espresso|cappuccino|frappuccino|macchiato|americano|cold\s?brew|\btea\b|matcha|chai\b|beer|lager|\bale\b|stout|cider|wine|vodka|whisky|whiskey|rum\b|gin\b|prosecco|champagne|cocktail|seltzer|smoothie|kombucha|milk|shake|water|energy/i;
// Volume units that only make sense poured into a glass - cup/tbsp/tsp are
// also cooking measures, so a "1 cup" serving of yogurt is not a drink.
const POURABLE_UNITS = new Set(['ml', 'cl', 'dl', 'l', 'fl oz', 'pint', 'quart', 'gal']);

export function isDrinkProduct(p: {
  name?: string | null;
  serving?: string | null;
  categories?: string | string[] | null;
}): boolean {
  const cats = Array.isArray(p.categories) ? p.categories.join(' ') : (p.categories ?? '');
  const text = `${p.name ?? ''} ${cats}`;
  if (NOT_A_DRINK.test(text)) return false;
  if (DRINK_CATEGORY.test(cats)) return true;
  if (DRINK_NAME.test(p.name ?? '')) return true;
  const u = parseServing(p.serving);
  return u.basis === 'volume' && POURABLE_UNITS.has(u.unit);
}

const KIND_PATTERNS: [RegExp, string][] = [
  // Coffee before energy so "nitro cold brew" doesn't get read as an
  // energy drink ('nitro' alone still hits the energy row below).
  [/coffee|latte|espresso|cappuccino|frappuccino|macchiato|americano|cold\s?brew/i, 'coffee'],
  [/monster|red\s?bull|rockstar|relentless|energy|nitro/i, 'energy'],
  [/iced?\s?tea|\btea\b|matcha|chai\b/i, 'tea'],
  [/cola|\bcoke\b|pepsi|sprite|fanta|soda|dr\.?\s?pepper|lemonade|fizzy|tonic|ginger\s?(beer|ale)|7\s?up|mountain\s?dew|irn\s?bru|lilt|oasis|squash|cordial|kombucha/i, 'soda'],
  [/juice|smoothie|orange|apple juice|cranberry/i, 'juice'],
  [/beer|lager|\bale\b|stout|cider|wine|vodka|whisky|whiskey|rum\b|gin\b|prosecco|champagne|cocktail|ipa\b|hard\s?seltzer/i, 'alcohol'],
  [/water|hydrat|seltzer/i, 'water'],
];

/** Best-guess liquid kind for a scanned/logged drink name. */
export function drinkKind(name: string): string {
  for (const [re, kind] of KIND_PATTERNS) if (re.test(name)) return kind;
  return 'other';
}
