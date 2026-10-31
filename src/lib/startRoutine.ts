import type { useRouter } from 'expo-router';

import { listRoutineTabs } from '@/db/repo/routines';
import { useActiveWorkout } from '@/store/activeWorkout';
import { useSettings } from '@/store/settings';

/**
 * Starts a routine the right way: routines that are shared with collaborators
 * or have tabs go through the lobby (tab pick + all-ready gate); everything
 * else starts a solo workout immediately.
 */
export async function openRoutineWorkout(
  router: ReturnType<typeof useRouter>,
  routine: { id: string; title: string; is_shared?: number }
): Promise<void> {
  const me = useSettings.getState().supabase_user_id;
  const tabs = await listRoutineTabs(routine.id);
  if (me && (routine.is_shared === 1 || tabs.length > 0)) {
    router.push(`/workout/lobby/${routine.id}`);
    return;
  }
  await useActiveWorkout.getState().startWorkout({ routineId: routine.id, title: routine.title });
  router.push('/workout/active');
}
