/**
 * Searches the free-exercise-db (https://github.com/yuhonas/free-exercise-db)
 * for exercise images. Fetches the combined JSON once and caches it in memory.
 */

import { classifyTrackingType } from './trackingType';
import type { TrackingType } from './types';

const EXERCISES_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const IMG_BASE =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

export interface GitHubExercise {
  id: string;
  name: string;
  force: string | null;
  level: string;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  category: string;
  images: string[];
}

let cache: GitHubExercise[] | null = null;
let fetchPromise: Promise<GitHubExercise[]> | null = null;

/** Fetches the full exercise list from GitHub (cached after first call). */
export async function loadGitHubExercises(): Promise<GitHubExercise[]> {
  if (cache) return cache;
  if (fetchPromise) return fetchPromise;
  fetchPromise = fetch(EXERCISES_URL)
    .then((r) => r.json())
    .then((data: GitHubExercise[]) => {
      cache = data;
      return data;
    })
    .catch(() => {
      fetchPromise = null;
      return [];
    });
  return fetchPromise;
}

/** Normalizes a string for fuzzy matching. */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
}

/** Levenshtein distance for ranking close matches. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : prev + 1;
      prev = tmp;
    }
  }
  return dp[n];
}

export interface SearchResult {
  id: string;
  name: string;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  category: string;
  imageUrl: string;
  confidence: number; // 0-1
  trackingType: TrackingType;
}

/** Maps GitHub equipment strings to our Equipment type. */
export function mapEquipment(githubEquip: string | null): import('@/lib/types').Equipment {
  if (!githubEquip) return 'other';
  const e = githubEquip.toLowerCase();
  if (e.includes('barbell')) return 'barbell';
  if (e.includes('dumbbell')) return 'dumbbell';
  if (e.includes('cable')) return 'cable';
  if (e.includes('machine')) return 'machine';
  if (e.includes('kettlebell')) return 'kettlebell';
  if (e.includes('band')) return 'band';
  if (e === 'body only' || e === 'bodyweight') return 'bodyweight';
  return 'other';
}

/** Maps GitHub muscle names to Title Case. */
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Searches GitHub exercises by name. Returns ranked results with image URLs. */
export async function searchGitHubExercises(query: string, limit = 8): Promise<SearchResult[]> {
  const all = await loadGitHubExercises();
  if (all.length === 0) return [];
  const q = normalize(query);
  if (!q) return [];

  const scored: { ex: GitHubExercise; score: number }[] = [];
  for (const ex of all) {
    const name = normalize(ex.name);
    let score = 0;
    if (name === q) {
      score = 1;
    } else if (name.startsWith(q)) {
      score = 0.9;
    } else if (name.includes(q)) {
      score = 0.75;
    } else if (q.includes(name) && name.length > 3) {
      score = 0.6;
    } else {
      // Check word overlap
      const qWords = q.split(' ');
      const nameWords = name.split(' ');
      const overlap = qWords.filter((w) => nameWords.some((nw) => nw.includes(w) && w.length > 2));
      if (overlap.length > 0) {
        score = 0.4 + (overlap.length / Math.max(qWords.length, nameWords.length)) * 0.2;
      }
    }
    // Fuzzy fallback for short queries
    if (score === 0 && q.length > 3) {
      const d = distance(q, name);
      const maxLen = Math.max(q.length, name.length);
      const similarity = 1 - d / maxLen;
      if (similarity > 0.7) score = similarity * 0.5;
    }
    if (score > 0) scored.push({ ex, score });
  }

  scored.sort(
    (a, b) => b.score - a.score || Number(b.ex.images.length > 0) - Number(a.ex.images.length > 0)
  );
  return scored.slice(0, limit).map(({ ex, score }) => ({
    id: ex.id,
    name: ex.name,
    equipment: ex.equipment,
    primaryMuscles: ex.primaryMuscles.map(titleCase),
    secondaryMuscles: ex.secondaryMuscles.map(titleCase),
    category: ex.category,
    imageUrl: ex.images.length > 0 ? `${IMG_BASE}/${ex.images[0]}` : '',
    confidence: score,
    trackingType: classifyTrackingType(ex.category, ex.force, ex.name),
  }));
}

/** Returns the image URL for a GitHub exercise ID. */
export function getGitHubImageUrl(exerciseId: string, position: 0 | 1 = 0): string | null {
  return `${IMG_BASE}/${exerciseId}/${position}.jpg`;
}
