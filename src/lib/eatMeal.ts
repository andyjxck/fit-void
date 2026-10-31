import type { MealWithMacros } from '@/db/repo/meals';
import { logFood } from '@/db/repo/nutrition';
import { scaleMacros } from '@/lib/mealMath';

/** Log `servings` of a meal to today's food diary. */
export async function eatMeal(meal: MealWithMacros, servings = 1, userId: string | null = null) {
  const m = scaleMacros(meal.perServing, servings);
  await logFood({
    name: meal.name,
    ...m,
    serving: servings === 1 ? '1 serving' : `${servings} servings`,
    source: 'quick',
    user_id: userId,
  });
}
