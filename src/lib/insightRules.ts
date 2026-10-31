/**
 * Pure rules for the Void analytics tab - no DB access, so they can be unit
 * tested under Bun. `insights.ts` feeds these with SQLite results.
 */

export interface LiftProgress {
  exerciseId: string;
  name: string;
  best: number; // all-time est. 1RM (kg)
  recent: number; // best est. 1RM last 30d
  prior: number; // best est. 1RM 30-60d ago
  sessions: number; // sessions in last 42d
}

export interface MuscleSets {
  muscle: string;
  sets: number;
  lastAt: string | null;
}

export interface RecentPR {
  id: string;
  exercise_id: string;
  name: string;
  recordType: string;
  value: number;
  achievedAt: string;
}

export type MuscleCategory = 'Push' | 'Pull' | 'Legs' | 'Core';

export function muscleCategory(muscle: string): MuscleCategory {
  const m = muscle.toLowerCase();
  if (/chest|shoulder|tricep|delt/.test(m) && !/rear/.test(m)) return 'Push';
  if (/back|lat|bicep|trap|rear|forearm/.test(m)) return 'Pull';
  if (/quad|hamstring|glute|calf|calves|leg|hip/.test(m)) return 'Legs';
  return 'Core';
}

const mondayOf = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};

/** Local YYYY-MM-DD - the canonical day key. `dates` sets are built the same
 *  way (see workoutDates in insights.ts); using toISOString here would key
 *  by UTC and shift the week grid a day for non-UTC users. */
const dayKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** For the last `n` weeks (oldest first, current week last): did we train? */
export function weekHits(dates: Set<string>, n = 12): boolean[] {
  const thisMonday = mondayOf(new Date());
  const out: boolean[] = [];
  for (let w = n - 1; w >= 0; w--) {
    const start = thisMonday.getTime() - w * 7 * 86400000;
    let hit = false;
    for (let i = 0; i < 7 && !hit; i++) {
      hit = dates.has(dayKey(new Date(start + i * 86400000)));
    }
    out.push(hit);
  }
  return out;
}

/** Consecutive weeks (Mon-Sun, ending this week) with at least one session. */
export function weekStreak(dates: Set<string>): number {
  let cursor = mondayOf(new Date());
  let streak = 0;
  for (let w = 0; w < 104; w++) {
    let hit = false;
    for (let i = 0; i < 7; i++) {
      const d = dayKey(new Date(cursor.getTime() + i * 86400000));
      if (dates.has(d)) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      // Current week may still be in progress - don't break the streak on it.
      if (w === 0) {
        cursor = new Date(cursor.getTime() - 7 * 86400000);
        continue;
      }
      break;
    }
    streak++;
    cursor = new Date(cursor.getTime() - 7 * 86400000);
  }
  return streak;
}

/** "That's 3 elephants" - a tangible comparison for lifetime tonnage. */
export function tonnageComparison(kg: number): string | null {
  const refs: [number, string, string][] = [
    [180_000, 'Boeing 747', 'Boeing 747s'],
    [140_000, 'blue whale', 'blue whales'],
    [12_000, 'school bus', 'school buses'],
    [6_000, 'elephant', 'elephants'],
    [1_500, 'car', 'cars'],
    [450, 'grand piano', 'grand pianos'],
    [90, 'refrigerator', 'refrigerators'],
  ];
  for (const [w, one, many] of refs) {
    const n = kg / w;
    if (n >= 1) {
      const r = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
      return `≈ ${r} ${r === 1 ? one : many}`;
    }
  }
  return null;
}

// -- Recovery / readiness ---------------------------------------------------

export interface RecoveryInputs {
  daysSinceLastWorkout: number | null;
  sleepHours: number | null; // most recent logged night
  restingHr: number | null; // latest reading
  restingHrBaseline: number | null; // 14-day average excluding the latest
  weekVolumeKg: number;
  avgWeekVolumeKg: number; // average weekly volume over the prior 4 weeks
  lastFeel: number | null; // 1-5 rating on the last session (display only)
}

export interface RecoveryFactor {
  label: string;
  detail: string;
  tone: InsightTone;
}

export interface RecoveryResult {
  score: number; // 0-100
  label: string;
  factors: RecoveryFactor[];
}

/**
 * Readiness score out of 100. Four scored inputs: sleep (30), resting HR vs
 * baseline (25), days since last session (25), acute load vs 4-week avg (20).
 * Missing data scores a neutral half-weight rather than punishing gaps.
 */
export function recoveryScore(i: RecoveryInputs): RecoveryResult {
  const factors: RecoveryFactor[] = [];
  let score = 0;

  // Sleep - last logged night, up to 30 pts
  if (i.sleepHours == null) {
    score += 15;
    factors.push({ label: 'Sleep', detail: 'not logged', tone: 'info' });
  } else if (i.sleepHours >= 7) {
    score += 30;
    factors.push({ label: 'Sleep', detail: `${i.sleepHours}h`, tone: 'win' });
  } else if (i.sleepHours >= 6) {
    score += 20;
    factors.push({ label: 'Sleep', detail: `${i.sleepHours}h - a bit short`, tone: 'warn' });
  } else {
    score += 8;
    factors.push({ label: 'Sleep', detail: `${i.sleepHours}h - under 6`, tone: 'warn' });
  }

  // Resting HR vs 14-day baseline - up to 25 pts
  if (i.restingHr == null || i.restingHrBaseline == null) {
    score += 12;
    factors.push({ label: 'Resting HR', detail: i.restingHr != null ? `${i.restingHr} bpm` : 'not logged', tone: 'info' });
  } else {
    const delta = i.restingHr - i.restingHrBaseline;
    if (delta <= 3) {
      score += 25;
      factors.push({ label: 'Resting HR', detail: `${i.restingHr} bpm - normal`, tone: 'win' });
    } else if (delta <= 6) {
      score += 13;
      factors.push({ label: 'Resting HR', detail: `${i.restingHr} bpm - ${Math.round(delta)} above baseline`, tone: 'warn' });
    } else {
      score += 4;
      factors.push({ label: 'Resting HR', detail: `${i.restingHr} bpm - ${Math.round(delta)} above baseline`, tone: 'warn' });
    }
  }

  // Days since last session - up to 25 pts
  if (i.daysSinceLastWorkout == null) {
    score += 10;
    factors.push({ label: 'Last session', detail: 'none logged', tone: 'info' });
  } else if (i.daysSinceLastWorkout === 0) {
    score += 20;
    factors.push({ label: 'Last session', detail: 'today', tone: 'win' });
  } else if (i.daysSinceLastWorkout <= 3) {
    score += 25;
    factors.push({
      label: 'Last session',
      detail: `${i.daysSinceLastWorkout}d ago - recovered`,
      tone: 'win',
    });
  } else {
    score += 12;
    factors.push({
      label: 'Last session',
      detail: `${i.daysSinceLastWorkout}d ago - fresh but stale`,
      tone: 'info',
    });
  }

  // Acute load: this week's volume vs prior 4-week average - up to 20 pts
  if (i.avgWeekVolumeKg <= 0) {
    score += 10;
    factors.push({ label: 'Load', detail: 'no baseline yet', tone: 'info' });
  } else {
    const ratio = i.weekVolumeKg / i.avgWeekVolumeKg;
    if (ratio <= 1.3) {
      score += 20;
      factors.push({ label: 'Load', detail: 'in line with recent weeks', tone: 'win' });
    } else if (ratio <= 1.6) {
      score += 10;
      factors.push({ label: 'Load', detail: 'spiking vs your average', tone: 'warn' });
    } else {
      score += 5;
      factors.push({ label: 'Load', detail: 'big spike - watch fatigue', tone: 'warn' });
    }
  }

  if (i.lastFeel != null) {
    factors.push({
      label: 'Last feel',
      detail: `${i.lastFeel}/5`,
      tone: i.lastFeel <= 2 ? 'warn' : 'info',
    });
  }

  const label = score >= 75 ? 'Primed' : score >= 55 ? 'Ready' : score >= 35 ? 'Caution' : 'Recover';
  return { score, label, factors };
}

// -- Insight generation ----------------------------------------------------

export type InsightTone = 'win' | 'warn' | 'info';

export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  body: string;
}

export interface InsightInputs {
  lifts: LiftProgress[];
  weekSets: MuscleSets[];
  neglected: { muscle: string; daysAgo: number }[];
  split: Record<MuscleCategory, number>;
  streak: number;
  prs: RecentPR[];
  score: { now: number; prior: number; relative: boolean };
  workoutsThisWeek: number;
  /** Average daily fluid intake over the last 7 days (ml); 0 = nothing logged. */
  waterAvgMl?: number;
  /** Days in the last 7 that reached the hydration target. */
  waterDaysOnTarget?: number;
  /** Personal daily hydration target (ml). */
  waterTargetMl?: number;
  /** Total sugar logged today (g), food + drink. */
  sugarToday?: number;
  /** Subset of sugarToday that came from drinks (g). */
  drinkSugarToday?: number;
  /** Calories consumed as drinks today. */
  drinkKcalToday?: number;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : 0);

export function buildInsights(i: InsightInputs): Insight[] {
  const out: Insight[] = [];

  // Strength trend
  if (i.score.prior > 0 && i.score.now > 0) {
    const d = pct(i.score.now, i.score.prior);
    if (d >= 3) {
      out.push({
        id: 'score-up',
        tone: 'win',
        title: `${d}% stronger than last month`,
        body: 'Your combined estimated 1RM across your top lifts is climbing. Keep the progression going.',
      });
    } else if (d <= -3) {
      out.push({
        id: 'score-down',
        tone: 'warn',
        title: `Strength down ${Math.abs(d)}% vs last month`,
        body: 'Could be fatigue, sleep, or a cut. If it persists two weeks, consider a deload.',
      });
    }
  }

  // Individual lift movements
  for (const l of i.lifts) {
    if (l.recent > 0 && l.prior > 0) {
      const d = pct(l.recent, l.prior);
      if (d >= 5) {
        out.push({
          id: `up-${l.exerciseId}`,
          tone: 'win',
          title: `${l.name} up ${d}%`,
          body: `Estimated 1RM moved from ${Math.round(l.prior)} to ${Math.round(l.recent)} kg this month.`,
        });
      } else if (l.sessions >= 4 && d <= 0) {
        out.push({
          id: `stall-${l.exerciseId}`,
          tone: 'warn',
          title: `${l.name} has stalled`,
          body: `${l.sessions} sessions in six weeks with no 1RM gain. Try a new rep range, add a back-off set, or take a light week.`,
        });
      }
    }
  }

  // Neglected muscles
  const worst = i.neglected[0];
  if (worst && worst.daysAgo >= 7) {
    out.push({
      id: `neglect-${worst.muscle}`,
      tone: 'warn',
      title: `${worst.muscle} untouched for ${worst.daysAgo} days`,
      body:
        i.neglected.length > 1
          ? `Also overdue: ${i.neglected.slice(1, 3).map((n) => n.muscle).join(', ')}. Slot them into your next session.`
          : 'Everything else is on schedule - just this one slipping.',
    });
  }

  // Volume zones
  const inZone = i.weekSets.filter((m) => m.sets >= 10 && m.sets <= 20);
  const high = i.weekSets.filter((m) => m.sets > 22);
  if (high.length > 0) {
    out.push({
      id: 'vol-high',
      tone: 'info',
      title: `${high[0].muscle}: ${high[0].sets} sets this week`,
      body: 'That is above the typical 10-20 productive range. Fine occasionally, but watch recovery.',
    });
  } else if (inZone.length >= 2) {
    out.push({
      id: 'vol-zone',
      tone: 'win',
      title: `${inZone.length} muscle groups in the growth zone`,
      body: `${inZone.map((m) => m.muscle).slice(0, 4).join(', ')} all landed 10-20 hard sets this week.`,
    });
  }

  // Push / pull balance
  const { Push, Pull, Legs } = i.split;
  const upper = Push + Pull;
  if (upper >= 20) {
    const r = Push / Math.max(1, Pull);
    if (r >= 1.5) {
      out.push({
        id: 'push-heavy',
        tone: 'warn',
        title: 'Push-dominant month',
        body: `${Push} push sets vs ${Pull} pull. Add rows or pull-ups to protect your shoulders and posture.`,
      });
    } else if (r <= 0.66) {
      out.push({
        id: 'pull-heavy',
        tone: 'info',
        title: 'Pull-dominant month',
        body: `${Pull} pull sets vs ${Push} push. Not a problem, just something to know.`,
      });
    }
  }
  if (upper >= 24 && Legs < upper * 0.35) {
    out.push({
      id: 'legs',
      tone: 'warn',
      title: 'Legs are falling behind',
      body: `${Legs} leg sets vs ${upper} upper-body sets over four weeks. Squats and hinges pay off everywhere.`,
    });
  }

  // Consistency
  if (i.streak >= 4) {
    out.push({
      id: 'streak',
      tone: 'win',
      title: `${i.streak}-week streak`,
      body: 'Consistency is the only variable that always works. This is the one that matters most.',
    });
  } else if (i.streak === 0 && i.workoutsThisWeek === 0) {
    out.push({
      id: 'restart',
      tone: 'info',
      title: 'Nothing logged this week yet',
      body: 'One session keeps the streak alive. Doesn’t need to be a big one.',
    });
  }

  // Hydration - only when the user actually logs drinks.
  if (i.waterAvgMl != null && i.waterAvgMl > 0 && i.waterTargetMl != null && i.waterTargetMl > 0) {
    const days = i.waterDaysOnTarget ?? 0;
    const litres = (i.waterAvgMl / 1000).toFixed(1);
    if (days >= 6) {
      out.push({
        id: 'hydration-good',
        tone: 'win',
        title: 'Hydration on target all week',
        body: `Averaging ${litres}L a day against a ${(i.waterTargetMl / 1000).toFixed(1)}L goal. Keep it up.`,
      });
    } else if (i.waterAvgMl < i.waterTargetMl * 0.6) {
      out.push({
        id: 'hydration-low',
        tone: 'warn',
        title: 'Running dry',
        body: `Averaging ${litres}L a day - well under your ${(i.waterTargetMl / 1000).toFixed(1)}L target. Dehydration costs you reps.`,
      });
    }
  }

  // Sugar - WHO guidance suggests keeping free sugars under ~50 g/day.
  if (i.sugarToday != null && i.sugarToday > 50) {
    const drinkG = i.drinkSugarToday ?? 0;
    out.push({
      id: 'sugar-high',
      tone: 'warn',
      title: `${Math.round(i.sugarToday)}g sugar today`,
      body:
        drinkG >= i.sugarToday * 0.5 && drinkG > 0
          ? `${Math.round(drinkG)}g of it came from drinks - liquid sugar stacks up fast.`
          : 'That is over the ~50g daily guidance. Worth watching if it becomes a pattern.',
    });
  } else if ((i.drinkKcalToday ?? 0) >= 250) {
    out.push({
      id: 'drink-kcal',
      tone: 'info',
      title: `${Math.round(i.drinkKcalToday ?? 0)} kcal from drinks today`,
      body: 'Liquid calories barely register as fullness. Easy to forget on a cut - the tracker did not.',
    });
  }

  // PRs
  if (i.prs.length >= 3) {
    out.push({
      id: 'prs',
      tone: 'win',
      title: `${i.prs.length} PRs in the last 30 days`,
      body: `Latest: ${i.prs[0].name}. You are in a progression phase - ride it.`,
    });
  }

  // Order: warnings first (things to act on), then wins, then info.
  const rank: Record<InsightTone, number> = { warn: 0, win: 1, info: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, 6);
}
