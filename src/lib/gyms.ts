/**
 * Gym search for check-ins / post tagging. Key-free sources only:
 *  - Overpass (OpenStreetMap) for gyms near a coordinate + name regex search
 *  - Nominatim (OpenStreetMap) for name search, biased by a viewbox
 * https://wiki.openstreetmap.org/wiki/Overpass_API
 * https://nominatim.org/release-docs/latest/api/Search/
 */

export interface GymPlace {
  name: string;
  /** null = name-only tag, no coordinates. */
  lat: number | null;
  lng: number | null;
  /** Straight-line distance in metres when a reference point is known. */
  distance_m?: number;
}

const UA = { 'User-Agent': 'GymVoid/1.0 (ios; contact: app)' };

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371e3;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: { name?: string };
}

/** Elements from an Overpass `out center` response -> GymPlace (nearest first). */
function overpassToGyms(
  elements: OverpassElement[],
  near: { lat: number; lng: number }
): GymPlace[] {
  const out: GymPlace[] = [];
  for (const e of elements) {
    const lat = e.center?.lat ?? e.lat;
    const lng = e.center?.lon ?? e.lon;
    const name = e.tags?.name;
    if (!name || lat == null || lng == null) continue;
    out.push({
      name: name.trim(),
      lat,
      lng,
      distance_m: Math.round(haversine(near, { lat, lng })),
    });
  }
  return out;
}

/** Dedupe by lowercased name + coords rounded to ~11m. */
function dedupe(gyms: GymPlace[]): GymPlace[] {
  const seen = new Set<string>();
  return gyms.filter((g) => {
    const key = `${g.name.toLowerCase()}|${(g.lat ?? 0).toFixed(4)}|${(g.lng ?? 0).toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const around = (r: number, near: { lat: number; lng: number }) => `(around:${r},${near.lat},${near.lng})`;

/** Overpass selector set for all gym-ish features, across node/way/relation. */
function gymSelectors(suffix: string): string {
  return (
    `node["leisure"~"^(fitness_centre|sports_centre)$"]${suffix};` +
    `way["leisure"~"^(fitness_centre|sports_centre)$"]${suffix};` +
    `relation["leisure"~"^(fitness_centre|sports_centre)$"]${suffix};` +
    `node["amenity"="gym"]${suffix};` +
    `way["amenity"="gym"]${suffix};` +
    `relation["amenity"="gym"]${suffix};`
  );
}

async function overpassQuery(q: string): Promise<OverpassElement[]> {
  const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`, {
    headers: UA,
  });
  if (!res.ok) {
    console.warn('[gyms] overpass http', res.status);
    return [];
  }
  const json = (await res.json()) as { elements?: OverpassElement[] };
  return json.elements ?? [];
}

/** Gyms within `radiusM` of a point, nearest first. */
export async function nearbyGyms(
  near: { lat: number; lng: number },
  radiusM = 5000
): Promise<GymPlace[]> {
  try {
    const q = `[out:json];(${gymSelectors(around(radiusM, near))});out center 40;`;
    const elements = await overpassQuery(q);
    return dedupe(overpassToGyms(elements, near)).sort(
      (a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0)
    );
  } catch {
    return [];
  }
}

/** Name search: Nominatim globally + Overpass name-regex around `near`, merged. */
export async function searchGyms(
  query: string,
  near?: { lat: number; lng: number } | null
): Promise<GymPlace[]> {
  const q = query.trim();
  if (!q) return [];

  const tasks: Promise<GymPlace[]>[] = [
    (async () => {
      try {
        let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=8&addressdetails=0`;
        if (near) {
          const d = 0.3; // ~30km box
          url += `&viewbox=${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}&bounded=0`;
        }
        const res = await fetch(url, { headers: UA });
        if (!res.ok) return [];
        const json = (await res.json()) as {
          display_name?: string;
          name?: string;
          lat: string;
          lon: string;
        }[];
        return json
          .map((r) => ({
            name: (r.name || r.display_name?.split(',')[0] || q).trim(),
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lon),
            distance_m: near
              ? Math.round(haversine(near, { lat: parseFloat(r.lat), lng: parseFloat(r.lon) }))
              : undefined,
          }))
          .filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lng));
      } catch {
        return [];
      }
    })(),
  ];

  // Overpass name-regex search near the user - catches gyms Nominatim misses.
  if (near) {
    tasks.push(
      (async () => {
        try {
          // Strip regex-special chars so the query can't break the pattern.
          const safe = q.replace(/[\\^$.|?*+()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
          if (!safe) return [];
          const R = 20000; // 20km name-search radius
          const sel =
            `nwr["leisure"~"^(fitness_centre|sports_centre)$"]["name"~"${safe}",i]${around(R, near)};` +
            `nwr["amenity"="gym"]["name"~"${safe}",i]${around(R, near)};`;
          const elements = await overpassQuery(`[out:json];(${sel});out center 20;`);
          return overpassToGyms(elements, near);
        } catch {
          return [];
        }
      })()
    );
  }

  const merged = dedupe((await Promise.all(tasks)).flat());
  return merged.sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity));
}

export function formatDistance(m?: number, unit: 'km' | 'mi' = 'km'): string {
  if (m == null) return '';
  if (unit === 'mi') {
    const mi = m / 1609.344;
    return mi < 0.1 ? `${Math.round(m * 3.28084)} ft` : `${mi.toFixed(1)} mi`;
  }
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}
