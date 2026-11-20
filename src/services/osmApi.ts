import type {
  ActiveRoute,
  CommunitySpotRecord,
  Coordinates,
  NominatimAddress,
  OverpassElement,
  PlaceSuggestion,
  RadiusOption,
  RouteMode,
  SearchOrigin,
} from '../types/parking';
import {
  buildOverpassQuery,
  calculateDistance,
  convertGeoJsonLineToLatLngs,
  estimateWalkMinutes,
  formatNominatimAddress,
  formatNominatimSearchLabel,
  parsePhotonFeatures,
  type PhotonRawFeature,
} from '../utils/geo';

const DIRECT_OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

const SPAIN_DEFAULT_BIAS: Coordinates = { lat: 40.4168, lon: -3.7038 };

const reverseGeocodeCache = new Map<string, string>();
const routeCache = new Map<string, Omit<ActiveRoute, 'spotId'>>();

interface NominatimSearchItem {
  lat: string;
  lon: string;
  name?: string;
  category?: string;
  type?: string;
  display_name: string;
  address?: NominatimAddress & { country_code?: string };
}

interface NominatimReverseResponse {
  address?: NominatimAddress;
}

function combineWithTimeout(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Tiempo de espera agotado')), timeoutMs);

  const onParentAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

export async function suggestPlaces(
  query: string,
  biasCoords?: Coordinates | null,
  parentSignal?: AbortSignal
): Promise<PlaceSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const bias = biasCoords ?? SPAIN_DEFAULT_BIAS;
  const { signal, cleanup } = combineWithTimeout(parentSignal, 6000);
  try {
    let response = await fetch(
      `/api/suggest?q=${encodeURIComponent(trimmed)}&lat=${bias.lat}&lon=${bias.lon}`,
      { signal }
    ).catch(() => null);

    if (
      !response ||
      !response.ok ||
      !response.headers.get('content-type')?.includes('application/json')
    ) {
      const directUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(
        trimmed
      )}&limit=8&lat=${bias.lat}&lon=${bias.lon}`;
      response = await fetch(directUrl, { signal });
    }

    if (!response.ok) return [];
    const data = (await response.json()) as { features?: PhotonRawFeature[] };
    return parsePhotonFeatures(data.features, trimmed, bias).slice(0, 6);
  } catch (err) {
    if (parentSignal?.aborted) throw err;
    return [];
  } finally {
    cleanup();
  }
}

async function geocodeNominatim(
  address: string,
  signal: AbortSignal
): Promise<SearchOrigin | null> {
  let response = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`, { signal }).catch(
    () => null
  );
  if (
    !response ||
    response.status === 404 ||
    !response.headers.get('content-type')?.includes('application/json')
  ) {
    const directUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&accept-language=es&q=${encodeURIComponent(
      address
    )}`;
    response = await fetch(directUrl, { signal }).catch(() => null);
  }

  if (!response || !response.ok) {
    return null;
  }

  const data = (await response.json()) as NominatimSearchItem[];
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  const sorted = [...data].sort((a, b) => {
    const aEs = a.address?.country_code?.toLowerCase() === 'es' ? 1 : 0;
    const bEs = b.address?.country_code?.toLowerCase() === 'es' ? 1 : 0;
    return bEs - aEs;
  });

  const first = sorted[0];
  const lat = parseFloat(first.lat);
  const lon = parseFloat(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  const label = formatNominatimSearchLabel({
    name: first.name,
    category: first.category,
    type: first.type,
    display_name: first.display_name,
    address: first.address,
    lat,
    lon,
  });

  return {
    lat,
    lon,
    label,
    source: 'address',
  };
}

export async function geocodeAddress(
  address: string,
  parentSignal?: AbortSignal,
  biasCoords?: Coordinates | null
): Promise<SearchOrigin | null> {
  const { signal, cleanup } = combineWithTimeout(parentSignal, 10000);
  try {
    const [photonList, nominatimOrigin] = await Promise.all([
      suggestPlaces(address, biasCoords, signal).catch(() => [] as PlaceSuggestion[]),
      geocodeNominatim(address, signal).catch(() => null),
    ]);

    if (parentSignal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const topPhoton = photonList[0];
    // If Photon matched a landmark/building or Nominatim had no result (e.g. rate-limit), use Photon
    if (topPhoton && (topPhoton.kind === 'landmark' || !nominatimOrigin)) {
      return {
        lat: topPhoton.lat,
        lon: topPhoton.lon,
        label: topPhoton.label,
        source: 'address',
      };
    }

    if (nominatimOrigin) {
      return nominatimOrigin;
    }

    return null;
  } finally {
    cleanup();
  }
}

export async function reverseGeocodeStreet(
  coords: Coordinates,
  parentSignal?: AbortSignal
): Promise<string> {
  const cacheKey = `${coords.lat.toFixed(5)},${coords.lon.toFixed(5)}`;
  const cached = reverseGeocodeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const { signal, cleanup } = combineWithTimeout(parentSignal, 7000);
  try {
    let response = await fetch(`/api/reverse?lat=${coords.lat}&lon=${coords.lon}`, { signal }).catch(
      () => null
    );
    if (
      !response ||
      response.status === 404 ||
      !response.headers.get('content-type')?.includes('application/json')
    ) {
      const directUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coords.lat}&lon=${coords.lon}&zoom=18&accept-language=es`;
      response = await fetch(directUrl, { signal }).catch(() => null);
    }

    if (response?.ok) {
      const data = (await response.json()) as NominatimReverseResponse;
      const formatted = formatNominatimAddress(data.address, coords);
      reverseGeocodeCache.set(cacheKey, formatted);
      return formatted;
    }

    const photonRes = await fetch(
      `https://photon.komoot.io/reverse?lat=${coords.lat}&lon=${coords.lon}`,
      { signal }
    ).catch(() => null);

    if (photonRes?.ok) {
      const photonData = (await photonRes.json()) as { features?: PhotonRawFeature[] };
      const props = photonData.features?.[0]?.properties;
      if (props) {
        const formatted = formatNominatimAddress(
          {
            road: props.street || props.name,
            house_number: props.housenumber,
            neighbourhood: props.locality || props.district,
            city: props.city,
          },
          coords
        );
        reverseGeocodeCache.set(cacheKey, formatted);
        return formatted;
      }
    }

    return `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`;
  } catch (err) {
    if (parentSignal?.aborted) {
      throw err;
    }
    return `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`;
  } finally {
    cleanup();
  }
}

export async function fetchMotorcycleParking(
  lat: number,
  lon: number,
  radius: RadiusOption,
  parentSignal?: AbortSignal
): Promise<OverpassElement[]> {
  const query = buildOverpassQuery(lat, lon, radius);

  // Prefer backend proxy (/api/overpass) for zero CORS/User-Agent issues and fast mirror fallback
  const proxyReq = combineWithTimeout(parentSignal, 14000);
  try {
    const proxyRes = await fetch('/api/overpass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: proxyReq.signal,
    });

    if (proxyRes.ok) {
      const payload = (await proxyRes.json()) as { elements?: OverpassElement[] };
      return Array.isArray(payload.elements) ? payload.elements : [];
    }

    // On static hosts like GitHub Pages, POST /api/overpass returns 404 or 405 Method Not Allowed
    const isJsonProxyError = proxyRes.headers
      .get('content-type')
      ?.toLowerCase()
      .includes('application/json');

    if (proxyRes.status !== 404 && proxyRes.status !== 405 && isJsonProxyError) {
      const errBody = (await proxyRes.json().catch(() => ({}))) as { error?: string };
      if (errBody.error) {
        throw new Error(errBody.error);
      }
    }
  } catch (err) {
    if (parentSignal?.aborted) {
      throw err;
    }
    if (
      err instanceof Error &&
      err.message.includes('saturados')
    ) {
      throw err;
    }
  } finally {
    proxyReq.cleanup();
  }

  // Static fallback (e.g. GitHub Pages) with strict per-endpoint timeout
  const body = `data=${encodeURIComponent(query)}`;
  let lastError: Error | null = null;

  for (const endpoint of DIRECT_OVERPASS_ENDPOINTS) {
    const directReq = combineWithTimeout(parentSignal, 8000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body,
        signal: directReq.signal,
      });

      if (!response.ok) {
        lastError = new Error(`Error del servidor cartográfico (${response.status})`);
        continue;
      }

      const payload = (await response.json()) as { elements?: OverpassElement[] };
      return Array.isArray(payload.elements) ? payload.elements : [];
    } catch (err) {
      if (parentSignal?.aborted) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error('Error de red al consultar Overpass.');
    } finally {
      directReq.cleanup();
    }
  }

  throw lastError ?? new Error('No se pudieron obtener los aparcamientos en este momento.');
}

export async function fetchStreetRoute(
  origin: Coordinates,
  target: Coordinates,
  mode: RouteMode,
  parentSignal?: AbortSignal
): Promise<Omit<ActiveRoute, 'spotId'>> {
  const cacheKey = `${origin.lat.toFixed(5)},${origin.lon.toFixed(5)}|${target.lat.toFixed(
    5
  )},${target.lon.toFixed(5)}|${mode}`;
  const cached = routeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const { signal, cleanup } = combineWithTimeout(parentSignal, 9000);
  try {
    let latLngs: Array<[number, number]> = [];
    let distanceMeters = 0;
    let durationSeconds = 0;

    let response = await fetch(
      `/api/route?fromLat=${origin.lat}&fromLon=${origin.lon}&toLat=${target.lat}&toLon=${target.lon}&mode=${mode}`,
      { signal }
    ).catch(() => null);

    if (response?.ok && response.headers.get('content-type')?.includes('application/json')) {
      const payload = (await response.json()) as {
        distance?: number;
        duration?: number;
        coordinates?: Array<[number, number]>;
      };
      latLngs = convertGeoJsonLineToLatLngs(payload.coordinates);
      distanceMeters = Math.round(payload.distance ?? 0);
      durationSeconds = Math.round(payload.duration ?? 0);
    } else {
      const profile = mode === 'moto' ? 'routed-car' : 'routed-foot';
      const directRouteEndpoints = [
        `https://routing.openstreetmap.de/${profile}/route/v1/driving/${origin.lon},${origin.lat};${target.lon},${target.lat}?overview=full&geometries=geojson`,
        `https://router.project-osrm.org/route/v1/${
          mode === 'moto' ? 'driving' : 'foot'
        }/${origin.lon},${origin.lat};${target.lon},${target.lat}?overview=full&geometries=geojson`,
      ];

      for (const directUrl of directRouteEndpoints) {
        try {
          const directRes = await fetch(directUrl, { signal });
          if (!directRes.ok) continue;
          const directData = (await directRes.json()) as {
            code?: string;
            routes?: Array<{
              distance?: number;
              duration?: number;
              geometry?: { coordinates?: Array<[number, number]> };
            }>;
          };
          const best = directData.routes?.[0];
          if (directData.code === 'Ok' && best) {
            latLngs = convertGeoJsonLineToLatLngs(best.geometry?.coordinates);
            distanceMeters = Math.round(best.distance ?? 0);
            durationSeconds = Math.round(best.duration ?? 0);
            if (latLngs.length >= 2) break;
          }
        } catch {
          // Try next direct routing server
        }
      }
    }

    if (latLngs.length >= 2) {
      const routeData: Omit<ActiveRoute, 'spotId'> = {
        mode,
        coordinates: latLngs,
        distanceMeters:
          distanceMeters > 0
            ? distanceMeters
            : Math.round(calculateDistance(origin.lat, origin.lon, target.lat, target.lon)),
        durationSeconds:
          durationSeconds > 0
            ? durationSeconds
            : estimateWalkMinutes(distanceMeters) * 60,
        isFallbackStraightLine: false,
      };
      routeCache.set(cacheKey, routeData);
      return routeData;
    }
  } catch (err) {
    if (parentSignal?.aborted) {
      throw err;
    }
  } finally {
    cleanup();
  }

  // Fallback only if routing services are unreachable
  const straightDistance = Math.round(
    calculateDistance(origin.lat, origin.lon, target.lat, target.lon)
  );
  return {
    mode,
    coordinates: [
      [origin.lat, origin.lon],
      [target.lat, target.lon],
    ],
    distanceMeters: straightDistance,
    durationSeconds: estimateWalkMinutes(straightDistance) * 60,
    isFallbackStraightLine: true,
  };
}

const LOCAL_COMMUNITY_KEY = 'motopark_community_spots_v1';

function readLocalCommunitySpots(): CommunitySpotRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_COMMUNITY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalCommunitySpots(spots: CommunitySpotRecord[]) {
  try {
    localStorage.setItem(LOCAL_COMMUNITY_KEY, JSON.stringify(spots));
  } catch {
    // Ignore storage quota errors
  }
}

export async function fetchCommunitySpots(): Promise<CommunitySpotRecord[]> {
  const local = readLocalCommunitySpots();
  try {
    const res = await fetch('/api/community-spots');
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) {
      return local;
    }
    const data = (await res.json()) as { spots?: CommunitySpotRecord[] };
    const remote = Array.isArray(data.spots) ? data.spots : [];
    // Merge remote + any local-only items
    const seen = new Set(remote.map((r) => r.id));
    const combined = [...remote, ...local.filter((l) => !seen.has(l.id))];
    writeLocalCommunitySpots(combined);
    return combined;
  } catch {
    return local;
  }
}

export async function saveCommunitySpot(input: {
  lat: number;
  lon: number;
  name: string;
  street: string;
  capacity?: string;
  covered?: boolean;
}): Promise<CommunitySpotRecord> {
  try {
    const res = await fetch('/api/community-spots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (res.ok) {
      const data = (await res.json()) as { spot: CommunitySpotRecord };
      const existing = readLocalCommunitySpots();
      writeLocalCommunitySpots([data.spot, ...existing]);
      return data.spot;
    }
  } catch {
    // Fallback to localStorage only
  }

  const localRecord: CommunitySpotRecord = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    lat: input.lat,
    lon: input.lon,
    name: input.name || 'Plaza de moto (vecinal)',
    street: input.street,
    capacity: input.capacity,
    covered: input.covered,
    createdAt: new Date().toISOString(),
  };
  const existing = readLocalCommunitySpots();
  writeLocalCommunitySpots([localRecord, ...existing]);
  return localRecord;
}

export async function deleteCommunitySpot(id: string): Promise<void> {
  const existing = readLocalCommunitySpots().filter((s) => s.id !== id);
  writeLocalCommunitySpots(existing);
  try {
    await fetch(`/api/community-spots/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  } catch {
    // Ignore network error if static mode
  }
}

