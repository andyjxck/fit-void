import type { Macros, MealIngredient } from './types';

export const ZERO: Macros = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

export function sumMacros(items: Macros[]): Macros {
  return items.reduce(
    (a, m) => ({
      calories: a.calories + (m.calories || 0),
      protein_g: a.protein_g + (m.protein_g || 0),
      carbs_g: a.carbs_g + (m.carbs_g || 0),
      fat_g: a.fat_g + (m.fat_g || 0),
    }),
    { ...ZERO }
  );
}

export function scaleMacros(m: Macros, factor: number): Macros {
  const r = (v: number) => Math.round(v * factor * 10) / 10;
  return { calories: Math.round(m.calories * factor), protein_g: r(m.protein_g), carbs_g: r(m.carbs_g), fat_g: r(m.fat_g) };
}

/** Whole-recipe totals and per-serving macros. */
export function mealTotals(ingredients: Macros[], servings: number): { total: Macros; perServing: Macros } {
  const total = sumMacros(ingredients);
  const s = servings > 0 ? servings : 1;
  return { total, perServing: scaleMacros(total, 1 / s) };
}

/** Per-100g product → macros for `grams`. */
export function macrosForGrams(per100g: Macros, grams: number): Macros {
  return scaleMacros(per100g, grams / 100);
}

export interface ShoppingLine {
  name: string;
  quantity: number | null;
  unit: string | null;
}

/** Aggregate ingredients across meals by (name, unit); unmeasured items are listed once. */
export function shoppingList(
  items: { ingredient: Pick<MealIngredient, 'name' | 'quantity' | 'unit'>; servingsFactor: number }[]
): ShoppingLine[] {
  const map = new Map<string, ShoppingLine>();
  for (const { ingredient: ing, servingsFactor } of items) {
    const name = ing.name.trim();
    const unit = ing.unit?.trim().toLowerCase() || null;
    const key = `${name.toLowerCase()}|${unit ?? ''}`;
    const cur = map.get(key);
    const qty = ing.quantity != null ? Math.round(ing.quantity * servingsFactor * 100) / 100 : null;
    if (!cur) map.set(key, { name, quantity: qty, unit });
    else if (cur.quantity != null && qty != null) cur.quantity = Math.round((cur.quantity + qty) * 100) / 100;
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function formatShoppingList(lines: ShoppingLine[], title: string): string {
  const body = lines
    .map((l) => `• ${l.quantity != null ? `${l.quantity}${l.unit ? ' ' + l.unit : ''} ` : ''}${l.name}`)
    .join('\n');
  return `${title}\n\n${body}\n\n- Fit Void`;
}

/** One meal's slice of the shopping list - heading = "DAY 1 · BREAKFAST". */
export interface ShoppingGroup {
  heading?: string;
  title: string;
  meta?: string;
  lines: ShoppingLine[];
}

const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Grouped shopping list as a standalone HTML page, styled after the
 * notification emails (white card on light grey, lime pill title, FIT VOID
 * wordmark). Quantities are already scaled by the caller.
 */
export function formatShoppingListHtml(groups: ShoppingGroup[], title: string): string {
  const sections = groups
    .map(
      (g) => `
      ${g.heading ? `<p style="margin:18px 0 6px;color:#666;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${escHtml(g.heading)}</p>` : ''}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e2e2;border-radius:12px;margin-bottom:12px">
        <tr>
          <td style="padding:10px 14px;border-bottom:1px solid #e2e2e2">
            <span style="color:#111;font-size:14px;font-weight:800">${escHtml(g.title)}</span>
            ${g.meta ? `<span style="color:#999;font-size:11px;margin-left:8px">${escHtml(g.meta)}</span>` : ''}
          </td>
        </tr>
        ${g.lines
          .map(
            (l, i) => `<tr>
          <td style="padding:7px 14px;color:#111;font-size:14px;${i < g.lines.length - 1 ? 'border-bottom:1px solid #f0f0f0;' : ''}">
            ${escHtml(l.name)}
            <span style="color:#666;font-size:13px;float:right">${l.quantity != null ? `${l.quantity}${l.unit ? ' ' + escHtml(l.unit) : ''}` : ''}</span>
          </td>
        </tr>`
          )
          .join('')}
      </table>`
    )
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f2f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2"><tr><td align="center" style="padding:32px 16px">
  <div style="max-width:520px;width:100%;font-family:-apple-system,Helvetica,Arial,sans-serif;text-align:left">
    <div style="color:#111;font-size:22px;font-weight:900;letter-spacing:3px;text-align:center;margin-bottom:16px">FIT&nbsp;<span style="color:#86b300">VOID</span></div>
    <div style="background:#ffffff;border:1px solid #e2e2e2;border-radius:14px;padding:18px 16px">
      <span style="display:inline-block;background:#ccff00;color:#0a0a00;font-size:10px;font-weight:900;letter-spacing:2px;padding:4px 10px;border-radius:6px;text-transform:uppercase">${escHtml(title)}</span>
      ${sections}
    </div>
    <p style="color:#999;font-size:11px;text-align:center;margin-top:20px">Shared from the Fit Void app</p>
  </div>
</td></tr></table>
</body></html>`;
}
