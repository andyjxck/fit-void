import { describe, expect, test } from 'bun:test';
import { drinkKind, isDrinkProduct, mlFor, parseServing } from '../servingUnits';

describe('parseServing', () => {
  test('parses metric weight/volume', () => {
    expect(parseServing('30 g')).toMatchObject({ qty: 30, unit: 'g', basis: 'weight' });
    expect(parseServing('1.5 kg')).toMatchObject({ qty: 1.5, unit: 'kg', basis: 'weight' });
    expect(parseServing('500 ml')).toMatchObject({ qty: 500, unit: 'ml', basis: 'volume' });
    expect(parseServing('33cl')).toMatchObject({ qty: 33, unit: 'cl', basis: 'volume' });
    expect(parseServing('1 litre')).toMatchObject({ qty: 1, unit: 'l', basis: 'volume' });
  });

  test('parses imperial units', () => {
    expect(parseServing('8 fl oz')).toMatchObject({ qty: 8, unit: 'fl oz', basis: 'volume' });
    expect(parseServing('2 oz')).toMatchObject({ qty: 2, unit: 'oz', basis: 'weight' });
    expect(parseServing('1 cup')).toMatchObject({ qty: 1, unit: 'cup', basis: 'volume' });
    expect(parseServing('2 tbsp')).toMatchObject({ qty: 2, unit: 'tbsp', basis: 'volume' });
  });

  test('parses count units', () => {
    expect(parseServing('1 can')).toMatchObject({ qty: 1, unit: 'can', basis: 'count' });
    expect(parseServing('2 slices')).toMatchObject({ qty: 2, unit: 'slice', basis: 'count' });
    expect(parseServing('1 scoop')).toMatchObject({ qty: 1, unit: 'scoop', basis: 'count' });
  });

  test('prefers parenthesised quantities', () => {
    // "1 can" would parse as count, but "(500 ml)" is the real measure.
    expect(parseServing('1 can (500 ml)')).toMatchObject({ qty: 500, unit: 'ml', basis: 'volume' });
    expect(parseServing('2 cookies (30 g)')).toMatchObject({ qty: 30, unit: 'g', basis: 'weight' });
  });

  test('weight/volume beats a count unit even inside parens', () => {
    // "(1 can)" is packaging - the 500 ml volume is the serving.
    expect(parseServing('500 ml (1 can)')).toMatchObject({ qty: 500, unit: 'ml', basis: 'volume' });
    expect(parseServing('300 g (2 pieces)')).toMatchObject({ qty: 300, unit: 'g', basis: 'weight' });
    // Parens still break ties within the same basis.
    expect(parseServing('1 cup (240 ml)')).toMatchObject({ qty: 240, unit: 'ml', basis: 'volume' });
  });

  test('parses slash fractions', () => {
    expect(parseServing('1/2 cup')).toMatchObject({ qty: 0.5, unit: 'cup' });
    expect(parseServing('2/3 cup').qty).toBeCloseTo(2 / 3);
    expect(parseServing('3/4 l')).toMatchObject({ qty: 0.75, unit: 'l' });
  });

  test('parses mixed numbers and leading decimals', () => {
    expect(parseServing('1 1/2 l')).toMatchObject({ qty: 1.5, unit: 'l' });
    expect(parseServing('2 1/2 cups')).toMatchObject({ qty: 2.5, unit: 'cup' });
    expect(parseServing('.5 l')).toMatchObject({ qty: 0.5, unit: 'l' });
  });

  test('parses unicode vulgar fractions', () => {
    expect(parseServing('½ cup')).toMatchObject({ qty: 0.5, unit: 'cup' });
    expect(parseServing('¾ l')).toMatchObject({ qty: 0.75, unit: 'l' });
    expect(parseServing('1½ cups')).toMatchObject({ qty: 1.5, unit: 'cup' });
    expect(parseServing('2⅔ l').qty).toBeCloseTo(2 + 2 / 3);
    expect(parseServing('⅛ tsp')).toMatchObject({ qty: 0.125, unit: 'tsp' });
  });

  test('thousands separators vs decimal commas', () => {
    expect(parseServing('1,500 g')).toMatchObject({ qty: 1500, unit: 'g' });
    expect(parseServing('12,5 g')).toMatchObject({ qty: 12.5, unit: 'g' });
  });

  test('variant unit spellings', () => {
    expect(parseServing('30 gr')).toMatchObject({ qty: 30, unit: 'g', basis: 'weight' });
    expect(parseServing('50 grm')).toMatchObject({ qty: 50, unit: 'g', basis: 'weight' });
    expect(parseServing('1 ltr')).toMatchObject({ qty: 1, unit: 'l', basis: 'volume' });
  });

  test('falls back to 100 g when unparseable', () => {
    expect(parseServing(null)).toMatchObject({ qty: 100, unit: 'g' });
    expect(parseServing('per pack')).toMatchObject({ qty: 100, unit: 'g' });
  });

  test('monster can: 1000 ml of a 500 ml serving is ×2, not ×10', () => {
    const s = parseServing('500 ml');
    expect(1000 / s.qty).toBe(2);
  });
});

describe('mlFor', () => {
  test('converts volume units to ml', () => {
    expect(mlFor(parseServing('500 ml'), 1000)).toBe(1000);
    expect(mlFor(parseServing('33 cl'), 33)).toBe(330);
    expect(mlFor(parseServing('12 fl oz'), 12)).toBe(355);
    expect(mlFor(parseServing('1 pint'), 1)).toBe(473);
  });

  test('approximates weight as ml (ml ≈ g)', () => {
    expect(mlFor(parseServing('330 g'), 330)).toBe(330);
    expect(mlFor(parseServing('1 l'), 1)).toBe(1000);
  });

  test('count units have no known volume', () => {
    expect(mlFor(parseServing('1 can'), 2)).toBe(0);
  });
});

describe('isDrinkProduct', () => {
  test('detects drinks by volume serving', () => {
    expect(isDrinkProduct({ name: 'Monster Energy', serving: '500 ml' })).toBe(true);
    expect(isDrinkProduct({ name: 'Cola', serving: '330ml' })).toBe(true);
  });

  test('detects drinks by category tags', () => {
    expect(
      isDrinkProduct({ name: 'Protein Shake', serving: '310 g', categories: ['en:beverages', 'en:protein-drinks'] })
    ).toBe(true);
  });

  test('does not flag food or non-drink liquids', () => {
    expect(isDrinkProduct({ name: 'Protein Bar', serving: '1 bar (45 g)' })).toBe(false);
    expect(isDrinkProduct({ name: 'Olive Oil', serving: '1 tbsp (15 ml)' })).toBe(false);
    expect(isDrinkProduct({ name: 'Maple Syrup', serving: '30 ml' })).toBe(false);
    expect(isDrinkProduct({ name: 'Chicken Breast', serving: '100 g' })).toBe(false);
  });

  test('cups/tbsp servings of spoonable foods are not drinks', () => {
    expect(isDrinkProduct({ name: 'Greek Yogurt', serving: '1 cup' })).toBe(false);
    expect(isDrinkProduct({ name: 'Tomato Soup', serving: '1 cup' })).toBe(false);
    expect(isDrinkProduct({ name: 'Cottage Cheese', serving: '2 tbsp' })).toBe(false);
    expect(isDrinkProduct({ name: 'Vanilla Ice Cream', serving: '1 cup' })).toBe(false);
    expect(isDrinkProduct({ name: 'Peanut Butter', serving: '2 tbsp' })).toBe(false);
    expect(isDrinkProduct({ name: 'Hummus', serving: '2 tbsp' })).toBe(false);
    // A cup/tbsp/tsp serving alone isn't a drink signal at all.
    expect(isDrinkProduct({ name: 'Mystery Food', serving: '2 cups' })).toBe(false);
    expect(isDrinkProduct({ name: 'Mystery Food', serving: '1 tbsp' })).toBe(false);
  });

  test('pourable units and drink-y names still flag drinks', () => {
    expect(isDrinkProduct({ name: 'Mystery Beverage', serving: '500 ml' })).toBe(true);
    expect(isDrinkProduct({ name: 'Mystery Beverage', serving: '1 pint' })).toBe(true);
    // Drink keyword in the name wins even with a cooking-measure serving.
    expect(isDrinkProduct({ name: 'Orange Juice', serving: '1 cup' })).toBe(true);
    expect(isDrinkProduct({ name: 'Whole Milk', serving: '1 cup' })).toBe(true);
  });
});

describe('drinkKind', () => {
  test('maps names to liquid kinds', () => {
    expect(drinkKind('Monster Energy Zero')).toBe('energy');
    expect(drinkKind('Coca-Cola')).toBe('soda');
    expect(drinkKind('Orange Juice')).toBe('juice');
    expect(drinkKind('Iced Latte')).toBe('coffee');
    expect(drinkKind('Green Tea')).toBe('tea');
    expect(drinkKind('IPA Craft Beer')).toBe('alcohol');
    expect(drinkKind('Some Random Drink')).toBe('other');
  });

  test('seltzer, coke and nitro edge cases', () => {
    expect(drinkKind('Seltzer')).toBe('water');
    expect(drinkKind('Hard Seltzer')).toBe('alcohol');
    expect(drinkKind('Coke')).toBe('soda');
    expect(drinkKind('Diet Coke')).toBe('soda');
    // Coffee context wins over the 'nitro' energy keyword.
    expect(drinkKind('Nitro Cold Brew')).toBe('coffee');
    expect(drinkKind('Nitro Energy Drink')).toBe('energy');
  });
});
