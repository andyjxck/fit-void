import type { IngredientInput, MealInput } from '@/db/repo/meals';
import type { MealSlot } from '@/lib/types';

/**
 * Curated high-protein recipes for lifters. Ingredient macros are for the
 * stated quantity (approximate, USDA-derived). Users copy these into their
 * own library, where they become fully editable.
 */

export interface RecommendedMeal extends Omit<MealInput, 'user_id'> {
  id: string;
  ingredients: IngredientInput[];
  method: string[];
  tags: string[];
  /** Short pitch shown on the card. */
  pitch: string;
  /** Minutes, prep + cook. */
  minutes: number;
  goal: 'cut' | 'maintain' | 'bulk' | 'any';
}

export interface RecommendedPlan {
  id: string;
  name: string;
  pitch: string;
  days: number;
  goal: 'cut' | 'maintain' | 'bulk' | 'any';
  tags: string[];
  /** day_index → slot → meal id from RECOMMENDED_MEALS */
  items: { day: number; slot: MealSlot; mealId: string }[];
}

const I = (name: string, quantity: number | null, unit: string | null, kcal: number, p: number, c: number, f: number): IngredientInput => ({
  name,
  quantity,
  unit,
  calories: kcal,
  protein_g: p,
  carbs_g: c,
  fat_g: f,
});

export const RECOMMENDED_MEALS: RecommendedMeal[] = [
  {
    id: 'rec-overnight-oats',
    name: 'Protein Overnight Oats',
    pitch: 'Zero-effort breakfast, 40 g protein, made the night before.',
    description: 'Slow carbs plus whey. Make three jars on Sunday and forget about breakfast until Wednesday.',
    servings: 1,
    minutes: 5,
    goal: 'any',
    tags: ['Breakfast', 'No cook', 'Meal prep', 'Vegetarian'],
    ingredients: [
      I('Rolled oats', 60, 'g', 228, 8, 40, 4),
      I('Whey protein (vanilla)', 1, 'scoop', 120, 24, 3, 1.5),
      I('Greek yoghurt 0%', 100, 'g', 59, 10, 3.6, 0.4),
      I('Semi-skimmed milk', 150, 'ml', 75, 5.4, 7.2, 2.7),
      I('Chia seeds', 10, 'g', 49, 1.7, 4.2, 3.1),
      I('Blueberries', 50, 'g', 29, 0.4, 7.3, 0.2),
    ],
    method: [
      'Stir oats, protein, yoghurt and milk together in a jar until no dry powder remains.',
      'Fold in the chia seeds.',
      'Lid on, fridge overnight (minimum 4 hours).',
      'Top with blueberries before eating. Loosen with a splash of milk if it set too thick.',
    ],
  },
  {
    id: 'rec-chicken-rice-bowl',
    name: 'Chicken & Rice Power Bowl',
    pitch: 'The meal-prep classic, done properly. Four boxes in 30 minutes.',
    description: 'Lean protein, clean carbs, real vegetables. Sauce is what makes it not boring.',
    servings: 4,
    minutes: 30,
    goal: 'any',
    tags: ['Lunch', 'Dinner', 'Meal prep', 'High protein', 'Dairy-free'],
    ingredients: [
      // Raw-weight convention like the other entries (~124 kcal, 23 g protein
      // per 100 g raw chicken breast - cooked weight would be ~165/100 g).
      I('Chicken breast', 800, 'g', 990, 186, 0, 21),
      I('Basmati rice (dry)', 300, 'g', 1065, 24, 234, 2.4),
      I('Broccoli', 400, 'g', 136, 11.2, 28, 1.6),
      I('Red pepper', 2, 'large', 74, 2.4, 14.4, 0.8),
      I('Olive oil', 1, 'tbsp', 119, 0, 0, 13.5),
      I('Soy sauce', 3, 'tbsp', 27, 4, 3, 0),
      I('Honey', 1, 'tbsp', 64, 0, 17, 0),
      I('Garlic', 3, 'clove', 13, 0.6, 3, 0),
      I('Sriracha', 1, 'tbsp', 15, 0, 3, 0),
    ],
    method: [
      'Rinse the rice and cook per packet. Steam the broccoli for 4 minutes until just tender.',
      'Dice the chicken into 2 cm pieces. Season with salt and pepper.',
      'Heat the oil in a large pan on high. Sear the chicken in one layer, 3 minutes without moving, then flip and cook through.',
      'Add sliced peppers and minced garlic, 2 minutes.',
      'Whisk soy, honey and sriracha. Pour over the pan and toss 1 minute until glossy.',
      'Divide rice, chicken and broccoli into 4 containers. Keeps 4 days chilled.',
    ],
  },
  {
    id: 'rec-egg-white-scramble',
    name: 'Cutting Scramble',
    pitch: 'Huge plate, 300 kcal, 35 g protein. Volume eating for a deficit.',
    description: 'Whole eggs for taste, whites for volume, spinach and mushrooms for bulk.',
    servings: 1,
    minutes: 10,
    goal: 'cut',
    tags: ['Breakfast', 'Low calorie', 'Quick', 'Vegetarian', 'Gluten-free'],
    ingredients: [
      I('Eggs', 2, 'large', 143, 12.6, 0.7, 9.5),
      I('Egg whites', 150, 'ml', 78, 16.5, 1.1, 0.3),
      I('Spinach', 80, 'g', 18, 2.3, 2.9, 0.3),
      I('Mushrooms', 100, 'g', 22, 3.1, 3.3, 0.3),
      I('Cherry tomatoes', 80, 'g', 14, 0.7, 3.1, 0.2),
      I('Low-fat feta', 20, 'g', 36, 3.6, 0.8, 2.2),
    ],
    method: [
      'Dry-fry the sliced mushrooms in a non-stick pan on high until browned, 4 minutes.',
      'Add spinach and halved tomatoes, wilt 1 minute.',
      'Whisk eggs and whites with salt and pepper. Pour in, drop heat to medium-low.',
      'Push gently with a spatula until just set. Crumble feta over and serve.',
    ],
  },
  {
    id: 'rec-beef-sweet-potato',
    name: 'Lean Beef & Sweet Potato Hash',
    pitch: 'Creatine, iron, and slow carbs. A proper bulking dinner.',
    description: 'One pan. Sweet potato gets crispy, beef stays juicy, everything gets covered in paprika.',
    servings: 2,
    minutes: 25,
    goal: 'bulk',
    tags: ['Dinner', 'One pan', 'High protein', 'Gluten-free', 'Dairy-free'],
    ingredients: [
      I('Lean beef mince 5%', 400, 'g', 548, 84, 0, 20),
      I('Sweet potato', 500, 'g', 430, 8, 100, 0.5),
      I('Red onion', 1, 'medium', 44, 1.2, 10, 0.1),
      I('Olive oil', 1, 'tbsp', 119, 0, 0, 13.5),
      I('Smoked paprika', 2, 'tsp', 12, 0.6, 2.4, 0.5),
      I('Kale', 100, 'g', 49, 4.3, 9, 0.9),
      I('Eggs', 2, 'large', 143, 12.6, 0.7, 9.5),
    ],
    method: [
      'Dice sweet potato into 1.5 cm cubes. Toss with oil and paprika, roast at 220 °C for 20 minutes until crisp at the edges.',
      'Brown the mince in a hot pan with the sliced onion, breaking it up. Season hard.',
      'Add kale to the pan, wilt 2 minutes. Stir in the roasted sweet potato.',
      'Make two wells, crack an egg into each, cover and cook until the whites set.',
    ],
  },
  {
    id: 'rec-tuna-pasta',
    name: 'Tuna & Cottage Cheese Pasta',
    pitch: '60 g protein per serving without touching a protein shake.',
    description: 'Cottage cheese melts into a creamy sauce. Nobody will believe how much protein is in this.',
    servings: 2,
    minutes: 15,
    goal: 'any',
    tags: ['Lunch', 'Dinner', 'Quick', 'High protein', 'Pescatarian'],
    ingredients: [
      I('Wholewheat pasta (dry)', 160, 'g', 555, 23, 104, 4),
      I('Tuna in spring water (drained)', 2, 'can', 232, 52, 0, 2),
      I('Cottage cheese', 250, 'g', 245, 28, 8, 11),
      I('Frozen peas', 150, 'g', 116, 8, 15, 0.6),
      I('Lemon', 1, 'whole', 17, 0.6, 5.4, 0.2),
      I('Parmesan', 20, 'g', 84, 7.6, 0.7, 5.6),
    ],
    method: [
      'Cook the pasta. Throw the peas in for the last 2 minutes. Drain, keep a mug of the water.',
      'Back in the pan on low: pasta, peas, cottage cheese, flaked tuna, lemon zest and juice.',
      'Stir with a splash of the pasta water until the cottage cheese loosens into a sauce.',
      'Black pepper, parmesan, done.',
    ],
  },
  {
    id: 'rec-greek-yog-bowl',
    name: 'Pre-Bed Casein Bowl',
    pitch: 'Slow-digesting protein before sleep. Tastes like dessert.',
    description: 'Greek yoghurt is mostly casein - it drips amino acids through the night.',
    servings: 1,
    minutes: 3,
    goal: 'any',
    tags: ['Snack', 'No cook', 'Pre-bed', 'Vegetarian', 'Gluten-free'],
    ingredients: [
      I('Greek yoghurt 0%', 250, 'g', 148, 25, 9, 1),
      I('Peanut butter', 15, 'g', 89, 3.8, 3, 7.5),
      I('Dark chocolate 85%', 10, 'g', 60, 1, 2, 5),
      I('Cinnamon', 1, 'tsp', 6, 0.1, 2, 0),
    ],
    method: [
      'Spoon yoghurt into a bowl.',
      'Swirl in the peanut butter - do not fully mix.',
      'Grate the chocolate over, dust with cinnamon.',
    ],
  },
  {
    id: 'rec-turkey-chilli',
    name: 'Turkey Chilli (Big Batch)',
    pitch: 'Six portions, freezer-friendly, 45 g protein each.',
    description: 'Cheap, filling, and better on day two. The beans push fibre through the roof.',
    servings: 6,
    minutes: 45,
    goal: 'any',
    tags: ['Dinner', 'Meal prep', 'Freezer', 'Batch cook', 'Gluten-free', 'Dairy-free'],
    ingredients: [
      I('Turkey mince 2%', 1000, 'g', 1120, 220, 0, 20),
      I('Kidney beans (drained)', 2, 'can', 460, 30, 80, 2),
      I('Chopped tomatoes', 2, 'can', 160, 8, 32, 0.8),
      I('Onion', 2, 'medium', 88, 2.4, 20, 0.2),
      I('Red pepper', 2, 'large', 74, 2.4, 14.4, 0.8),
      I('Garlic', 4, 'clove', 18, 0.8, 4, 0),
      I('Olive oil', 1, 'tbsp', 119, 0, 0, 13.5),
      I('Chilli powder', 2, 'tbsp', 48, 2, 8, 2.6),
      I('Cumin', 2, 'tsp', 16, 0.8, 1.9, 0.9),
      I('Beef stock', 300, 'ml', 15, 2, 1, 0),
    ],
    method: [
      'Soften diced onion and pepper in the oil, 6 minutes. Add garlic for 1 minute.',
      'Add turkey and brown, breaking it up. Season with salt.',
      'Stir in chilli powder and cumin, toast 1 minute.',
      'Add tomatoes, beans and stock. Simmer uncovered 30 minutes, stirring now and then, until thick.',
      'Portion into 6. Fridge 4 days or freezer 3 months. Serve with rice or over a jacket potato.',
    ],
  },
  {
    id: 'rec-salmon-quinoa',
    name: 'Salmon, Quinoa & Greens',
    pitch: 'Omega-3s for joints, complete protein from the quinoa. Recovery on a plate.',
    description: 'Fifteen minutes, one tray, restaurant-looking.',
    servings: 2,
    minutes: 20,
    goal: 'maintain',
    tags: ['Dinner', 'Omega-3', 'Quick', 'Gluten-free', 'Dairy-free', 'Pescatarian'],
    ingredients: [
      I('Salmon fillet', 2, 'piece', 412, 40, 0, 26),
      I('Quinoa (dry)', 120, 'g', 443, 17, 77, 7),
      I('Asparagus', 200, 'g', 40, 4.4, 7.8, 0.2),
      I('Lemon', 1, 'whole', 17, 0.6, 5.4, 0.2),
      I('Olive oil', 1, 'tsp', 40, 0, 0, 4.5),
      I('Dill', 1, 'handful', 4, 0.3, 0.7, 0.1),
    ],
    method: [
      'Rinse quinoa, simmer in 240 ml water 15 minutes until the tails pop. Fluff.',
      'Oven at 200 °C. Salmon and asparagus on a tray, oil, salt, pepper, lemon slices on top. 12 minutes.',
      'Fold chopped dill and lemon juice through the quinoa. Plate salmon on top.',
    ],
  },
];

/**
 * Curated meal plans built from the recommended meals above.
 * Users copy these into their own library where they become fully editable.
 */
export const RECOMMENDED_PLANS: RecommendedPlan[] = [
  {
    id: 'rec-plan-cut-week',
    name: 'Cut Week',
    pitch: 'Seven days of high-protein, calorie-controlled eating. ~1,575 kcal/day, ~145 g protein.',
    days: 7,
    goal: 'cut',
    tags: ['Fat loss', 'High protein', '7-day'],
    items: [
      { day: 0, slot: 'breakfast', mealId: 'rec-overnight-oats' },
      { day: 0, slot: 'lunch', mealId: 'rec-tuna-pasta' },
      { day: 0, slot: 'dinner', mealId: 'rec-turkey-chilli' },
      { day: 1, slot: 'breakfast', mealId: 'rec-egg-white-scramble' },
      { day: 1, slot: 'lunch', mealId: 'rec-chicken-rice-bowl' },
      { day: 1, slot: 'dinner', mealId: 'rec-salmon-quinoa' },
      { day: 2, slot: 'breakfast', mealId: 'rec-overnight-oats' },
      { day: 2, slot: 'lunch', mealId: 'rec-chicken-rice-bowl' },
      { day: 2, slot: 'dinner', mealId: 'rec-beef-sweet-potato' },
      { day: 3, slot: 'breakfast', mealId: 'rec-egg-white-scramble' },
      { day: 3, slot: 'lunch', mealId: 'rec-tuna-pasta' },
      { day: 3, slot: 'dinner', mealId: 'rec-turkey-chilli' },
      { day: 4, slot: 'breakfast', mealId: 'rec-overnight-oats' },
      { day: 4, slot: 'lunch', mealId: 'rec-salmon-quinoa' },
      { day: 4, slot: 'dinner', mealId: 'rec-chicken-rice-bowl' },
      { day: 5, slot: 'breakfast', mealId: 'rec-egg-white-scramble' },
      { day: 5, slot: 'lunch', mealId: 'rec-beef-sweet-potato' },
      { day: 5, slot: 'dinner', mealId: 'rec-tuna-pasta' },
      { day: 6, slot: 'breakfast', mealId: 'rec-overnight-oats' },
      { day: 6, slot: 'lunch', mealId: 'rec-chicken-rice-bowl' },
      { day: 6, slot: 'dinner', mealId: 'rec-salmon-quinoa' },
    ],
  },
  {
    id: 'rec-plan-bulk-day',
    name: 'Bulk Day',
    pitch: 'A single day stacked with calorie-dense, protein-heavy meals. ~2,800 kcal, ~250 g protein.',
    days: 1,
    goal: 'bulk',
    tags: ['Mass', 'High calorie', '1-day'],
    items: [
      { day: 0, slot: 'breakfast', mealId: 'rec-overnight-oats' },
      { day: 0, slot: 'snack', mealId: 'rec-greek-yog-bowl' },
      { day: 0, slot: 'lunch', mealId: 'rec-beef-sweet-potato' },
      { day: 0, slot: 'dinner', mealId: 'rec-chicken-rice-bowl' },
      { day: 0, slot: 'snack', mealId: 'rec-tuna-pasta' },
    ],
  },
  {
    id: 'rec-plan-maintain-3day',
    name: 'Maintain 3-Day',
    pitch: 'A balanced three-day rotation hitting maintenance calories with varied protein sources.',
    days: 3,
    goal: 'maintain',
    tags: ['Balanced', 'Maintenance', '3-day'],
    items: [
      { day: 0, slot: 'breakfast', mealId: 'rec-egg-white-scramble' },
      { day: 0, slot: 'lunch', mealId: 'rec-chicken-rice-bowl' },
      { day: 0, slot: 'dinner', mealId: 'rec-salmon-quinoa' },
      { day: 1, slot: 'breakfast', mealId: 'rec-overnight-oats' },
      { day: 1, slot: 'lunch', mealId: 'rec-tuna-pasta' },
      { day: 1, slot: 'dinner', mealId: 'rec-beef-sweet-potato' },
      { day: 2, slot: 'breakfast', mealId: 'rec-greek-yog-bowl' },
      { day: 2, slot: 'lunch', mealId: 'rec-turkey-chilli' },
      { day: 2, slot: 'dinner', mealId: 'rec-chicken-rice-bowl' },
    ],
  },
];
