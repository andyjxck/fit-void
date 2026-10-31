/**
 * Maps the 12 canonical muscle groups to body regions on a stylized
 * front/back silhouette. Coordinates live in a 200×440 viewBox shared by
 * both views, so the same body parts render either side.
 */

export type MuscleView = 'front' | 'back';

export type RegionShape =
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotate?: number }
  | { kind: 'path'; d: string };

export interface MuscleRegion {
  muscle: string;
  view: MuscleView;
  shape: RegionShape;
}

/** The 12 canonical groups shown on the heatmap. */
export const MUSCLE_GROUPS = [
  'Chest',
  'Back',
  'Shoulders',
  'Traps',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Biceps',
  'Triceps',
  'Abs',
  'Forearms',
] as const;

/** Aliases from seed/exercise data → canonical group. */
const ALIASES: Record<string, string> = {
  Core: 'Abs',
  Lats: 'Back',
  'Lower Back': 'Back',
  'Rear Delts': 'Shoulders',
  'Rear Delt': 'Shoulders',
  'Hip Flexors': 'Abs',
  Calf: 'Calves',
  Deltoids: 'Shoulders',
  Delt: 'Shoulders',
  Abdominals: 'Abs',
  Ab: 'Abs',
  Pectorals: 'Chest',
  Pecs: 'Chest',
  Quadriceps: 'Quads',
  Hamstring: 'Hamstrings',
  Glute: 'Glutes',
  Bicep: 'Biceps',
  Tricep: 'Triceps',
  Forearm: 'Forearms',
  Trapezius: 'Traps',
};

const CANON = new Set<string>(MUSCLE_GROUPS);

/** Normalize any muscle string to one of the 12 canonical groups. */
export function normalizeMuscle(raw: string): string {
  const m = raw.trim();
  if (CANON.has(m)) return m;
  const alias = ALIASES[m];
  if (alias) return alias;
  const lower = m.toLowerCase();
  for (const [k, v] of Object.entries(ALIASES)) {
    if (lower === k.toLowerCase()) return v;
  }
  if (/chest|pec/.test(lower)) return 'Chest';
  // Shoulder before back: "lateral delts" contains 'lat' but is a delt.
  if (/shoulder|delt/.test(lower)) return 'Shoulders';
  if (/trap/.test(lower)) return 'Traps';
  // \blat\b so "lateral" doesn't hit the back rule.
  if (/\blat(s|issimus)?\b|\bback\b/.test(lower)) return 'Back';
  if (/quad/.test(lower)) return 'Quads';
  if (/hamstring/.test(lower)) return 'Hamstrings';
  if (/glute|abductor/.test(lower)) return 'Glutes';
  if (/calf|calve/.test(lower)) return 'Calves';
  if (/bicep/.test(lower)) return 'Biceps';
  if (/tricep/.test(lower)) return 'Triceps';
  // \bab\b so "abductors" doesn't map to Abs (they're a glute mover).
  if (/\bab\b|abdominal|core|oblique/.test(lower)) return 'Abs';
  if (/forearm/.test(lower)) return 'Forearms';
  return m;
}

// -- Path helpers -----------------------------------------------------------

/** Mirror an absolute-command path horizontally around x=100. */
function mirror(d: string): string {
  const tokens = d.match(/[A-Z]|-?\d*\.?\d+/g) ?? [];
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Z]$/.test(t)) {
      out.push(t);
      i++;
      continue;
    }
    // Numbers always arrive as x,y pairs in the commands we use (M/L/C/Q).
    const x = 200 - parseFloat(t);
    const y = parseFloat(tokens[i + 1]);
    out.push(String(x), String(y));
    i += 2;
  }
  return out.join(' ');
}

const path = (d: string): RegionShape => ({ kind: 'path', d });

// -- Body silhouette (200×440 viewBox) --------------------------------------
// Single continuous outline (head included) built from a left-half chain,
// mirrored for the right side. Down the outside of the arm, around the hand,
// up to the armpit, down the torso, around the foot, up the inner leg.

type Seg = [string, ...number[]];

const SILHOUETTE_LEFT: Seg[] = [
  ['M', 92, 46],
  ['C', 86, 50, 82, 56, 80, 62], // neck flares to trap
  ['C', 66, 66, 50, 72, 42, 80], // trap slope → shoulder tip
  ['C', 34, 86, 30, 96, 29, 108], // delt cap → upper arm outer
  ['C', 28, 132, 28, 156, 30, 180], // outer arm → elbow
  ['C', 32, 200, 34, 214, 36, 224], // outer forearm → wrist
  ['C', 37, 234, 44, 238, 48, 234], // hand bottom
  ['C', 51, 230, 52, 222, 52, 214], // inner wrist
  ['C', 51, 194, 50, 174, 50, 154], // inner forearm
  ['C', 50, 138, 51, 128, 54, 118], // inner upper arm → armpit
  ['C', 57, 132, 59, 150, 61, 168], // lat
  ['C', 63, 184, 63, 200, 62, 214], // waist
  ['C', 64, 228, 64, 240, 62, 252], // hip
  ['C', 60, 278, 58, 302, 57, 326], // outer thigh
  ['C', 56, 352, 55, 378, 56, 400], // outer shin → ankle
  ['C', 56, 414, 60, 422, 68, 423], // ankle → foot bottom
  ['L', 84, 423],
  ['C', 89, 421, 90, 416, 89, 408], // inner ankle
  ['C', 88, 386, 87, 362, 87, 338], // inner shin
  ['C', 87, 314, 88, 290, 90, 266], // inner thigh
  ['C', 91, 258, 94, 252, 97, 248], // → crotch
  ['L', 100, 248],
];

// Female variant: narrower shoulders, arms held closer, narrower waist,
// wider hips, and a bust contour between armpit and waist.
const SILHOUETTE_LEFT_F: Seg[] = [
  ['M', 92, 46],
  ['C', 88, 50, 84, 56, 82, 62], // neck flares to trap
  ['C', 72, 66, 60, 72, 52, 82], // trap slope → narrower shoulder tip
  ['C', 45, 88, 41, 98, 40, 110], // delt cap → upper arm outer
  ['C', 39, 134, 39, 158, 41, 182], // outer arm → elbow
  ['C', 43, 202, 45, 214, 47, 224], // outer forearm → wrist
  ['C', 48, 234, 54, 238, 57, 234], // hand bottom
  ['C', 59, 230, 59, 222, 58, 214], // inner wrist
  ['C', 57, 194, 56, 174, 56, 156], // inner forearm
  ['C', 56, 140, 57, 130, 60, 120], // inner upper arm → armpit
  ['C', 55, 132, 55, 146, 61, 158], // bust bulge
  ['C', 66, 168, 69, 180, 70, 196], // underbust → narrow waist
  ['C', 70, 208, 68, 218, 64, 228], // waist → hip flare
  ['C', 58, 240, 55, 252, 54, 266], // wide hip
  ['C', 53, 284, 54, 302, 56, 320], // outer thigh
  ['C', 58, 348, 58, 376, 58, 400], // outer shin → ankle
  ['C', 58, 414, 62, 422, 70, 423], // ankle → foot bottom
  ['L', 84, 423],
  ['C', 89, 421, 90, 416, 89, 408], // inner ankle
  ['C', 88, 386, 87, 362, 87, 338], // inner shin
  ['C', 87, 316, 88, 292, 91, 268], // inner thigh
  ['C', 93, 260, 96, 252, 98, 248], // → crotch
  ['L', 100, 248],
];

const segEnd = (s: Seg): [number, number] => (s[0] === 'C' ? [s[5], s[6]] : [s[1], s[2]]);

function buildSilhouette(leftChain: Seg[]): string {
  const mirrorX = (x: number) => 200 - x;
  const right: string[] = [];
  for (let i = leftChain.length - 1; i > 0; i--) {
    const seg = leftChain[i];
    const [px, py] = segEnd(leftChain[i - 1]);
    if (seg[0] === 'L') right.push(`L ${mirrorX(seg[1])} ${seg[2]}`);
    else right.push(`C ${mirrorX(seg[3])} ${seg[4]} ${mirrorX(seg[1])} ${seg[2]} ${mirrorX(px)} ${py}`);
  }
  const left = leftChain.map((s) => `${s[0]} ${s.slice(1).join(' ')}`).join(' ');
  // Head: near-full circle arc from the right neck point over the top.
  const head = 'A 21 21 0 1 0 92 46 Z';
  return `${left} ${right.join(' ')} ${head}`;
}

/** Whole-figure outline - single path, head included. */
export const BODY_SILHOUETTE = buildSilhouette(SILHOUETTE_LEFT);

/** Female whole-figure outline - same 200×440 viewBox. */
export const BODY_SILHOUETTE_F = buildSilhouette(SILHOUETTE_LEFT_F);

// -- Muscle regions ---------------------------------------------------------

// Front - left side paths; right side is mirrored around x=100.
const DELT_L = 'M46 76 C36 82 31 92 30 104 C30 114 35 121 42 122 C48 122 50 114 50 104 C50 92 50 80 46 76 Z';
const PEC_L = 'M99 82 L70 84 C62 86 58 94 60 102 C63 110 74 115 86 115 L99 114 Z';
const BICEP_L = 'M37 110 C32 118 32 136 34 152 C36 162 44 164 48 158 C51 152 50 132 48 118 C46 109 41 105 37 110 Z';
const FOREARM_L = 'M36 168 C32 180 33 200 35 214 C37 226 44 230 48 224 C51 216 50 194 48 178 C46 167 40 162 36 168 Z';
const ABS = 'M76 120 L124 120 C126 146 124 176 118 196 C110 203 90 203 82 196 C76 176 74 146 76 120 Z';
const QUAD_L = 'M63 240 C57 252 57 278 59 302 C61 322 68 332 76 330 C84 328 86 310 86 292 C86 270 84 252 80 244 C76 236 69 236 63 240 Z';

// Back - left side paths.
const TRAP_BACK = 'M100 56 C90 58 78 64 68 74 C62 84 60 96 64 106 C70 116 84 120 100 120 C116 120 130 116 136 106 C140 96 138 84 132 74 C122 64 110 58 100 56 Z';
const LAT_L = 'M64 120 C56 128 54 144 57 160 C60 176 68 188 80 192 C88 194 94 188 94 176 L93 138 C92 126 76 112 64 120 Z';
const LOWER_BACK = 'M82 194 C80 206 81 218 86 226 C93 231 107 231 114 226 C119 218 120 206 118 194 C109 189 91 189 82 194 Z';
const GLUTE_L = 'M63 236 C57 244 57 258 61 268 C67 276 79 278 87 274 C93 270 95 260 93 250 C91 240 85 234 77 232 C71 231 67 232 63 236 Z';
const HAMSTRING_L = 'M61 274 C57 286 57 306 59 322 C61 336 69 342 77 340 C85 338 88 324 88 306 C88 290 85 278 79 272 C73 266 63 268 61 274 Z';
const CALF_L = 'M60 342 C56 356 56 378 60 394 C64 408 74 412 80 406 C86 400 86 382 84 366 C82 350 76 340 68 338 C64 336 62 338 60 342 Z';

export const MUSCLE_REGIONS: MuscleRegion[] = [
  // -- Front ------------------------------------------------------
  { muscle: 'Shoulders', view: 'front', shape: path(DELT_L) },
  { muscle: 'Shoulders', view: 'front', shape: path(mirror(DELT_L)) },
  { muscle: 'Chest', view: 'front', shape: path(PEC_L) },
  { muscle: 'Chest', view: 'front', shape: path(mirror(PEC_L)) },
  { muscle: 'Biceps', view: 'front', shape: path(BICEP_L) },
  { muscle: 'Biceps', view: 'front', shape: path(mirror(BICEP_L)) },
  { muscle: 'Forearms', view: 'front', shape: path(FOREARM_L) },
  { muscle: 'Forearms', view: 'front', shape: path(mirror(FOREARM_L)) },
  { muscle: 'Abs', view: 'front', shape: path(ABS) },
  { muscle: 'Quads', view: 'front', shape: path(QUAD_L) },
  { muscle: 'Quads', view: 'front', shape: path(mirror(QUAD_L)) },

  // -- Back -------------------------------------------------------
  { muscle: 'Traps', view: 'back', shape: path(TRAP_BACK) },
  { muscle: 'Shoulders', view: 'back', shape: path(DELT_L) },
  { muscle: 'Shoulders', view: 'back', shape: path(mirror(DELT_L)) },
  { muscle: 'Back', view: 'back', shape: path(LAT_L) },
  { muscle: 'Back', view: 'back', shape: path(mirror(LAT_L)) },
  { muscle: 'Back', view: 'back', shape: path(LOWER_BACK) },
  { muscle: 'Triceps', view: 'back', shape: path(BICEP_L) },
  { muscle: 'Triceps', view: 'back', shape: path(mirror(BICEP_L)) },
  { muscle: 'Forearms', view: 'back', shape: path(FOREARM_L) },
  { muscle: 'Forearms', view: 'back', shape: path(mirror(FOREARM_L)) },
  { muscle: 'Glutes', view: 'back', shape: path(GLUTE_L) },
  { muscle: 'Glutes', view: 'back', shape: path(mirror(GLUTE_L)) },
  { muscle: 'Hamstrings', view: 'back', shape: path(HAMSTRING_L) },
  { muscle: 'Hamstrings', view: 'back', shape: path(mirror(HAMSTRING_L)) },
  { muscle: 'Calves', view: 'back', shape: path(CALF_L) },
  { muscle: 'Calves', view: 'back', shape: path(mirror(CALF_L)) },
];

// -- Female muscle regions ---------------------------------------------------
// Same muscle keys/views fitted to the female silhouette (narrower shoulders,
// bust contour, wider hips). Male paths reused where the shape still reads
// correctly (traps, lats, lower back, abs, hamstrings, calves).

const DELT_F_L = 'M56 80 C48 86 43 96 42 108 C42 118 46 124 52 124 C57 124 58 116 58 106 C58 94 59 84 56 80 Z';
const PEC_F_L = 'M99 82 L72 84 C62 88 58 98 62 108 C66 118 78 123 90 122 L99 120 Z';
const BICEP_F_L = 'M45 112 C40 120 40 138 42 154 C44 164 51 166 55 160 C58 154 57 134 55 120 C53 111 48 107 45 112 Z';
const FOREARM_F_L = 'M44 170 C40 182 41 200 43 214 C45 226 52 230 56 224 C58 216 57 194 55 180 C53 169 47 165 44 170 Z';
const QUAD_F_L = 'M60 244 C54 258 55 282 58 304 C61 322 68 332 76 330 C84 328 86 310 86 292 C86 272 84 254 80 246 C74 238 66 238 60 244 Z';
const GLUTE_F_L = 'M60 238 C53 248 54 262 59 272 C66 280 79 281 87 276 C93 271 95 260 92 250 C89 240 82 234 74 233 C68 232 64 234 60 238 Z';

export const MUSCLE_REGIONS_F: MuscleRegion[] = [
  // -- Front ------------------------------------------------------
  { muscle: 'Shoulders', view: 'front', shape: path(DELT_F_L) },
  { muscle: 'Shoulders', view: 'front', shape: path(mirror(DELT_F_L)) },
  { muscle: 'Chest', view: 'front', shape: path(PEC_F_L) },
  { muscle: 'Chest', view: 'front', shape: path(mirror(PEC_F_L)) },
  { muscle: 'Biceps', view: 'front', shape: path(BICEP_F_L) },
  { muscle: 'Biceps', view: 'front', shape: path(mirror(BICEP_F_L)) },
  { muscle: 'Forearms', view: 'front', shape: path(FOREARM_F_L) },
  { muscle: 'Forearms', view: 'front', shape: path(mirror(FOREARM_F_L)) },
  { muscle: 'Abs', view: 'front', shape: path(ABS) },
  { muscle: 'Quads', view: 'front', shape: path(QUAD_F_L) },
  { muscle: 'Quads', view: 'front', shape: path(mirror(QUAD_F_L)) },

  // -- Back -------------------------------------------------------
  { muscle: 'Traps', view: 'back', shape: path(TRAP_BACK) },
  { muscle: 'Shoulders', view: 'back', shape: path(DELT_F_L) },
  { muscle: 'Shoulders', view: 'back', shape: path(mirror(DELT_F_L)) },
  { muscle: 'Back', view: 'back', shape: path(LAT_L) },
  { muscle: 'Back', view: 'back', shape: path(mirror(LAT_L)) },
  { muscle: 'Back', view: 'back', shape: path(LOWER_BACK) },
  { muscle: 'Triceps', view: 'back', shape: path(BICEP_F_L) },
  { muscle: 'Triceps', view: 'back', shape: path(mirror(BICEP_F_L)) },
  { muscle: 'Forearms', view: 'back', shape: path(FOREARM_F_L) },
  { muscle: 'Forearms', view: 'back', shape: path(mirror(FOREARM_F_L)) },
  { muscle: 'Glutes', view: 'back', shape: path(GLUTE_F_L) },
  { muscle: 'Glutes', view: 'back', shape: path(mirror(GLUTE_F_L)) },
  { muscle: 'Hamstrings', view: 'back', shape: path(HAMSTRING_L) },
  { muscle: 'Hamstrings', view: 'back', shape: path(mirror(HAMSTRING_L)) },
  { muscle: 'Calves', view: 'back', shape: path(CALF_L) },
  { muscle: 'Calves', view: 'back', shape: path(mirror(CALF_L)) },
];
