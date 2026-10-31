import { describe, expect, test } from 'bun:test';

import { formatShoppingList, macrosForGrams, mealTotals, shoppingList } from '../mealMath';
import { extractRecipesFromHtml, normaliseUrl, parseIngredientLine } from '../recipeImport';

describe('mealMath', () => {
  test('totals and per-serving are derived from ingredients', () => {
    const { total, perServing } = mealTotals(
      [
        { calories: 400, protein_g: 30, carbs_g: 40, fat_g: 10 },
        { calories: 200, protein_g: 10, carbs_g: 20, fat_g: 8 },
      ],
      4
    );
    expect(total.calories).toBe(600);
    expect(perServing).toEqual({ calories: 150, protein_g: 10, carbs_g: 15, fat_g: 4.5 });
  });

  test('servings <= 0 is treated as 1', () => {
    expect(mealTotals([{ calories: 100, protein_g: 0, carbs_g: 0, fat_g: 0 }], 0).perServing.calories).toBe(100);
  });

  test('per-100g product scaled to grams', () => {
    expect(macrosForGrams({ calories: 350, protein_g: 12, carbs_g: 60, fat_g: 7 }, 50)).toEqual({
      calories: 175,
      protein_g: 6,
      carbs_g: 30,
      fat_g: 3.5,
    });
  });

  test('shopping list aggregates by name+unit and scales by servings', () => {
    const lines = shoppingList([
      { ingredient: { name: 'Chicken breast', quantity: 200, unit: 'g' }, servingsFactor: 2 },
      { ingredient: { name: 'chicken breast', quantity: 150, unit: 'G' }, servingsFactor: 1 },
      { ingredient: { name: 'Salt', quantity: null, unit: null }, servingsFactor: 3 },
      { ingredient: { name: 'Rice', quantity: 1, unit: 'cup' }, servingsFactor: 1 },
    ]);
    expect(lines).toEqual([
      { name: 'Chicken breast', quantity: 550, unit: 'g' },
      { name: 'Rice', quantity: 1, unit: 'cup' },
      { name: 'Salt', quantity: null, unit: null },
    ]);
    expect(formatShoppingList(lines, 'Week 1')).toContain('• 550 g Chicken breast');
    expect(formatShoppingList(lines, 'Week 1')).toContain('• Salt');
  });
});

describe('parseIngredientLine', () => {
  test('quantity, unit, name', () => {
    expect(parseIngredientLine('2 1/2 cups rolled oats')).toEqual({ quantity: 2.5, unit: 'cup', name: 'rolled oats' });
    expect(parseIngredientLine('200g chicken breast')).toEqual({ quantity: 200, unit: 'g', name: 'chicken breast' });
    expect(parseIngredientLine('½ tsp of salt')).toEqual({ quantity: 0.5, unit: 'tsp', name: 'salt' });
    expect(parseIngredientLine('3 large eggs')).toEqual({ quantity: 3, unit: 'large', name: 'eggs' });
  });

  test('no quantity → name only', () => {
    expect(parseIngredientLine('Black pepper to taste')).toEqual({ quantity: null, unit: null, name: 'Black pepper to taste' });
  });

  test('ranges average out', () => {
    expect(parseIngredientLine('2-3 tbsp olive oil').quantity).toBe(2.5);
    // en/em dashes too
    expect(parseIngredientLine('1\u20132 cups rice').quantity).toBe(1.5);
    expect(parseIngredientLine('1\u20142 cups rice').quantity).toBe(1.5);
  });

  test('decimal commas and unicode fractions', () => {
    expect(parseIngredientLine('12,5 g butter').quantity).toBe(12.5);
    expect(parseIngredientLine('⅔ cup sugar').quantity).toBeCloseTo(2 / 3);
    expect(parseIngredientLine('1½ cups flour').quantity).toBe(1.5);
    expect(parseIngredientLine('⅜ tsp salt').quantity).toBe(0.375);
  });
});

describe('recipe nutrition numFrom', () => {
  const htmlWithNutrition = (fat: string) => `
    <script type="application/ld+json">{"@type":"Recipe","name":"R",
      "recipeIngredient":["1 cup oats"],
      "nutrition":{"calories":"100","fatContent":"${fat}"}}</script>`;

  test('decimal comma in nutrition values is not mangled', () => {
    const [r] = extractRecipesFromHtml(htmlWithNutrition('12,5 g'), 'https://x.y');
    expect(r.nutrition?.fat_g).toBe(12.5);
  });
});

describe('extractRecipesFromHtml', () => {
  const html = `
    <html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
      {"@type":"WebSite","name":"x"},
      {"@type":"Recipe","name":"High-Protein Overnight Oats","description":"Easy &amp; fast",
       "recipeYield":"2 servings","recipeCategory":"Breakfast",
       "recipeIngredient":["1 cup rolled oats","1 scoop whey protein","250 ml milk"],
       "recipeInstructions":[{"@type":"HowToStep","text":"Mix."},{"@type":"HowToSection","itemListElement":[{"@type":"HowToStep","text":"Chill overnight."}]}],
       "nutrition":{"@type":"NutritionInformation","calories":"420 calories","proteinContent":"32 g","carbohydrateContent":"55 g","fatContent":"9 g"}}
    ]}</script>
    <script type="application/ld+json">not json</script>
    </head></html>`;

  test('finds recipe inside @graph, parses ingredients, sections and nutrition', () => {
    const [r] = extractRecipesFromHtml(html, 'https://example.com/oats');
    expect(r.name).toBe('High-Protein Overnight Oats');
    expect(r.description).toBe('Easy & fast');
    expect(r.servings).toBe(2);
    expect(r.ingredients).toHaveLength(3);
    expect(r.ingredients[1]).toEqual({ quantity: 1, unit: 'scoop', name: 'whey protein' });
    expect(r.method).toEqual(['Mix.', 'Chill overnight.']);
    expect(r.nutrition).toEqual({ calories: 420, protein_g: 32, carbs_g: 55, fat_g: 9 });
    expect(r.tags).toContain('Breakfast');
  });

  test('page with no recipe → empty, no throw', () => {
    expect(extractRecipesFromHtml('<html><body>hi</body></html>', 'https://x.y')).toEqual([]);
  });
});

describe('normaliseUrl', () => {
  test('extracts URL from pasted text and adds scheme', () => {
    expect(normaliseUrl('check this https://a.com/r?x=1 out')).toBe('https://a.com/r?x=1');
    expect(normaliseUrl('bbcgoodfood.com/recipes/x')).toBe('https://bbcgoodfood.com/recipes/x');
    expect(normaliseUrl('nope')).toBeNull();
  });
});
