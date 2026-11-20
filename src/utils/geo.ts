import type {
  CommunitySpotRecord,
  Coordinates,
  FreeStatus,
  NominatimAddress,
  OverpassElement,
  OverpassTagMap,
  ParkingMetadata,
  ParkingSpot,
  PlaceKind,
  PlaceSuggestion,
  RadiusOption,
  SpotCategory,
} from '../types/parking';

const EARTH_RADIUS_METERS = 6371000;
const WALKING_SPEED_METERS_PER_MIN = 80;
const DEDUP_DISTANCE_METERS = 8;

const CATEGORY_PRIORITY: Record<SpotCategory, number> = {
  exclusive: 0,
  community: 1,
  mixed_moto: 2,
  surface: 3,
};

/**
 * Computes the great-circle distance in meters between two WGS84 coordinates using Haversine.
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export function estimateWalkMinutes(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return 1;
  }
  return Math.max(1, Math.round(distanceMeters / WALKING_SPEED_METERS_PER_MIN));
}

export function formatDistance(distanceMeters: number): string {
  const rounded = Math.max(0, Math.round(distanceMeters));
  if (rounded >= 1000) {
    const km = (Math.round(rounded / 100) / 10).toFixed(1).replace('.', ',');
    return `${km} km`;
  }
  return `${rounded} m`;
}

/**
 * Extracts a representative coordinate from an Overpass node, way, or relation.
 */
export function extractElementCoordinates(element: OverpassElement): Coordinates | null {
  if (
    element.center &&
    typeof element.center.lat === 'number' &&
    typeof element.center.lon === 'number'
  ) {
    return { lat: element.center.lat, lon: element.center.lon };
  }

  if (
    element.type === 'node' &&
    typeof element.lat === 'number' &&
    typeof element.lon === 'number'
  ) {
    return { lat: element.lat, lon: element.lon };
  }

  if (element.type === 'way' && Array.isArray(element.geometry) && element.geometry.length > 0) {
    let latSum = 0;
    let lonSum = 0;
    let validCount = 0;
    for (const pt of element.geometry) {
      if (typeof pt.lat === 'number' && typeof pt.lon === 'number') {
        latSum += pt.lat;
        lonSum += pt.lon;
        validCount += 1;
      }
    }
    if (validCount > 0) {
      return { lat: latSum / validCount, lon: lonSum / validCount };
    }
  }

  if (element.type === 'relation' && Array.isArray(element.members)) {
    for (const member of element.members) {
      if (typeof member.lat === 'number' && typeof member.lon === 'number') {
        return { lat: member.lat, lon: member.lon };
      }
      if (Array.isArray(member.geometry) && member.geometry.length > 0) {
        const pt = member.geometry[0];
        if (typeof pt.lat === 'number' && typeof pt.lon === 'number') {
          return { lat: pt.lat, lon: pt.lon };
        }
      }
    }
  }

  return null;
}

/**
 * Queries dedicated motorcycle parking, mixed parking allowing motorcycles,
 * and nearby public surface parking bays (crucial in neighborhoods without dedicated moto tags).
 */
export function buildOverpassQuery(
  lat: number,
  lon: number,
  radius: RadiusOption | number
): string {
  const surfaceRadius = Math.min(radius, 600);
  return `[out:json][timeout:25];
(
  node["amenity"="motorcycle_parking"](around:${radius},${lat},${lon})["indoor"!="yes"];
  way["amenity"="motorcycle_parking"](around:${radius},${lat},${lon})["indoor"!="yes"];
  relation["amenity"="motorcycle_parking"](around:${radius},${lat},${lon})["indoor"!="yes"];
  node["amenity"="parking"]["motorcycle"~"yes|designated|only"](around:${radius},${lat},${lon})["indoor"!="yes"];
  way["amenity"="parking"]["motorcycle"~"yes|designated|only"](around:${radius},${lat},${lon})["indoor"!="yes"];
  node["amenity"="parking"]["parking"~"surface|street_side|lane"](around:${surfaceRadius},${lat},${lon})["access"!="private"]["indoor"!="yes"];
  way["amenity"="parking"]["parking"~"surface|street_side|lane"](around:${surfaceRadius},${lat},${lon})["access"!="private"]["indoor"!="yes"];
);
out center;`;
}

export function extractTagStreet(tags: OverpassTagMap): string | null {
  const street = tags['addr:street'] || tags.street || tags['addr:full'];
  if (!street || !street.trim()) {
    return null;
  }
  const num = tags['addr:housenumber']?.trim();
  return num ? `${street.trim()}, ${num}` : street.trim();
}

export function parseParkingMetadata(tags: OverpassTagMap): ParkingMetadata {
  const rawCapacity = tags.capacity?.trim();
  const capacity =
    rawCapacity && /^\d+$/.test(rawCapacity) ? `${rawCapacity} plazas` : rawCapacity || null;

  let covered: boolean | null = null;
  if (tags.covered === 'yes') covered = true;
  else if (tags.covered === 'no') covered = false;

  let fee: boolean | null = null;
  if (tags.fee === 'yes') fee = true;
  else if (tags.fee === 'no') fee = false;

  let accessNote: string | null = null;
  if (tags.access === 'private' || tags.access === 'customers') {
    accessNote = tags.access === 'private' ? 'Acceso privado' : 'Solo clientes';
  }

  return { capacity, covered, fee, accessNote };
}

export function formatMetadataSummary(
  metadata: ParkingMetadata,
  freeStatus?: FreeStatus
): string[] {
  const parts: string[] = [];
  if (freeStatus === 'free' || metadata.fee === false) {
    parts.push('Gratis');
  } else if (freeStatus === 'paid' || metadata.fee === true) {
    parts.push('De pago');
  } else if (freeStatus === 'unknown') {
    parts.push('Tarifa sin confirmar');
  }
  if (metadata.capacity) parts.push(metadata.capacity);
  if (metadata.covered === true) parts.push('Cubierto');
  if (metadata.accessNote) parts.push(metadata.accessNote);
  return parts;
}

export function getSpotFreeStatus(
  category: SpotCategory,
  tags: OverpassTagMap
): FreeStatus {
  const feeTag = tags.fee?.trim().toLowerCase();
  if (feeTag === 'yes' || feeTag === 'interval' || feeTag === 'ticket') {
    return 'paid';
  }
  if (feeTag === 'no') {
    return 'free';
  }
  if (category === 'community' || category === 'exclusive') {
    return 'free';
  }
  return 'unknown';
}

export function classifyOverpassElement(tags: OverpassTagMap | undefined): SpotCategory | null {
  if (!tags || tags.indoor === 'yes' || tags.access === 'private') {
    return null;
  }
  if (tags.amenity === 'motorcycle_parking') {
    return 'exclusive';
  }
  if (tags.amenity === 'parking') {
    if (tags.motorcycle && /^(yes|designated|only)$/i.test(tags.motorcycle)) {
      return 'mixed_moto';
    }
    if (tags.parking && /^(surface|street_side|lane)$/i.test(tags.parking)) {
      return 'surface';
    }
  }
  return null;
}

export function getCategoryLabel(category: SpotCategory): string {
  switch (category) {
    case 'exclusive':
      return 'Exclusivo moto';
    case 'mixed_moto':
      return 'Parking apto motos';
    case 'surface':
      return 'Superficie pública';
    case 'community':
      return 'Aportación vecinal';
  }
}

function getDefaultSpotName(category: SpotCategory, rawName?: string): string {
  if (rawName && rawName.trim()) {
    return rawName.trim();
  }
  switch (category) {
    case 'exclusive':
      return 'Aparcamiento de motos';
    case 'mixed_moto':
      return 'Parking compartido (motos)';
    case 'surface':
      return 'Aparcamiento en superficie';
    case 'community':
      return 'Plaza de moto (comunidad)';
  }
}

/**
 * Filters, extracts, classifies, deduplicates, and sorts Overpass elements by proximity.
 */
export function processOverpassElements(
  elements: OverpassElement[],
  origin: Coordinates
): ParkingSpot[] {
  const seenIds = new Set<string>();
  const candidates: ParkingSpot[] = [];

  for (const el of elements) {
    const category = classifyOverpassElement(el.tags);
    if (!category || !el.tags) {
      continue;
    }

    const uid = `${el.type}-${el.id}`;
    if (seenIds.has(uid)) {
      continue;
    }

    const coords = extractElementCoordinates(el);
    if (!coords) {
      continue;
    }

    seenIds.add(uid);

    const distance = Math.round(
      calculateDistance(origin.lat, origin.lon, coords.lat, coords.lon)
    );
    const streetFromTag = extractTagStreet(el.tags);

    const freeStatus = getSpotFreeStatus(category, el.tags);

    candidates.push({
      id: uid,
      osmType: el.type,
      osmId: el.id,
      lat: coords.lat,
      lon: coords.lon,
      name: getDefaultSpotName(category, el.tags.name),
      street: streetFromTag,
      streetLoading: streetFromTag === null,
      distance,
      walkMinutes: estimateWalkMinutes(distance),
      category,
      freeStatus,
      tags: el.tags,
      metadata: parseParkingMetadata(el.tags),
    });
  }

  // Sort by category priority first (so deduplication keeps exclusive over surface), then distance
  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category];
  });

  const deduplicated: ParkingSpot[] = [];
  for (const spot of candidates) {
    const existingIdx = deduplicated.findIndex(
      (existing) =>
        calculateDistance(existing.lat, existing.lon, spot.lat, spot.lon) < DEDUP_DISTANCE_METERS
    );
    if (existingIdx === -1) {
      deduplicated.push(spot);
    } else if (CATEGORY_PRIORITY[spot.category] < CATEGORY_PRIORITY[deduplicated[existingIdx].category]) {
      deduplicated[existingIdx] = spot;
    }
  }

  return deduplicated;
}

function getFreeSortTier(spot: ParkingSpot): number {
  const isCustomersOnly = spot.tags.access === 'customers';
  if (spot.freeStatus === 'paid') return 3;
  if (isCustomersOnly) return 2;
  if (spot.freeStatus === 'free') return 0;
  return 1;
}

export function sortSpotsByFreePriority(spots: ParkingSpot[]): ParkingSpot[] {
  return [...spots].sort((a, b) => {
    const tierDiff = getFreeSortTier(a) - getFreeSortTier(b);
    if (tierDiff !== 0) return tierDiff;
    if (a.distance !== b.distance) return a.distance - b.distance;
    return CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category];
  });
}

export function filterAndPrioritizeSpots(
  spots: ParkingSpot[],
  options: { includeSurface: boolean; onlyFree: boolean }
): {
  visible: ParkingSpot[];
  hiddenPaidCount: number;
  surfaceCount: number;
  nonSurfaceCount: number;
} {
  const afterFreeFilter = options.onlyFree
    ? spots.filter((s) => s.freeStatus !== 'paid')
    : spots;

  const hiddenPaidCount = spots.filter((s) => s.freeStatus === 'paid').length;
  const surfaceCount = afterFreeFilter.filter((s) => s.category === 'surface').length;
  const nonSurfaceCount = afterFreeFilter.filter((s) => s.category !== 'surface').length;

  const afterSurfaceFilter = options.includeSurface
    ? afterFreeFilter
    : afterFreeFilter.filter((s) => s.category !== 'surface');

  return {
    visible: sortSpotsByFreePriority(afterSurfaceFilter),
    hiddenPaidCount,
    surfaceCount,
    nonSurfaceCount,
  };
}

/**
 * Merges community-reported motorcycle spots within search radius with OSM spots,
 * sorted with free parking priority first, then proximity.
 */
export function mergeSpotsWithCommunity(
  osmSpots: ParkingSpot[],
  communityRecords: CommunitySpotRecord[],
  origin: Coordinates,
  radius: number
): ParkingSpot[] {
  const merged = [...osmSpots];

  for (const rec of communityRecords) {
    const distance = Math.round(
      calculateDistance(origin.lat, origin.lon, rec.lat, rec.lon)
    );
    if (distance > radius) continue;

    const tooClose = merged.some(
      (s) => calculateDistance(s.lat, s.lon, rec.lat, rec.lon) < DEDUP_DISTANCE_METERS
    );
    if (tooClose) continue;

    merged.push({
      id: `community-${rec.id}`,
      osmType: 'community',
      osmId: 0,
      lat: rec.lat,
      lon: rec.lon,
      name: rec.name || 'Plaza de moto (comunidad)',
      street: rec.street,
      streetLoading: false,
      distance,
      walkMinutes: estimateWalkMinutes(distance),
      category: 'community',
      freeStatus: 'free',
      tags: {},
      metadata: {
        capacity: rec.capacity ? `${rec.capacity} plazas` : null,
        covered: rec.covered ?? null,
        fee: false,
        accessNote: null,
      },
      createdAt: rec.createdAt,
    });
  }

  return sortSpotsByFreePriority(merged);
}

export function formatNominatimAddress(
  address: NominatimAddress | undefined | null,
  fallbackCoords?: Coordinates
): string {
  if (!address) {
    return fallbackCoords
      ? `${fallbackCoords.lat.toFixed(5)}, ${fallbackCoords.lon.toFixed(5)}`
      : 'Ubicación en mapa';
  }

  const street =
    address.road ||
    address.pedestrian ||
    address.footway ||
    address.living_street ||
    address.residential ||
    address.square ||
    address.path ||
    address.leisure ||
    address.park ||
    address.industrial ||
    address.commercial ||
    '';

  const houseNumber = address.house_number?.trim() || '';

  if (street) {
    return houseNumber ? `${street}, ${houseNumber}` : street;
  }

  const area =
    address.neighbourhood ||
    address.quarter ||
    address.suburb ||
    address.place ||
    address.town ||
    address.city ||
    address.village;

  if (area) {
    return area;
  }

  return fallbackCoords
    ? `${fallbackCoords.lat.toFixed(5)}, ${fallbackCoords.lon.toFixed(5)}`
    : 'Ubicación en mapa';
}

const LANDMARK_OSM_KEYS = new Set([
  'amenity',
  'tourism',
  'leisure',
  'historic',
  'building',
  'railway',
  'aeroway',
  'shop',
  'office',
  'healthcare',
  'public_transport',
]);

export interface PhotonRawFeature {
  properties?: {
    osm_type?: string;
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    type?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    locality?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
  };
  geometry?: {
    coordinates?: [number, number];
  };
}

export function classifyPhotonPoi(
  osmKey?: string,
  osmValue?: string,
  hasName?: boolean
): { kind: PlaceKind; categoryLabel: string } {
  const key = (osmKey || '').toLowerCase();
  const val = (osmValue || '').toLowerCase();

  if (val === 'hospital' || val === 'clinic' || key === 'healthcare') {
    return { kind: 'landmark', categoryLabel: 'Hospital / Salud' };
  }
  if (val === 'hotel' || val === 'hostel' || val === 'guest_house' || val === 'motel') {
    return { kind: 'landmark', categoryLabel: 'Hotel' };
  }
  if (
    val === 'museum' ||
    val === 'theatre' ||
    val === 'arts_centre' ||
    val === 'attraction' ||
    val === 'monument' ||
    val === 'castle' ||
    val === 'cathedral' ||
    key === 'historic'
  ) {
    return { kind: 'landmark', categoryLabel: 'Edificio emblemático' };
  }
  if (
    key === 'railway' ||
    key === 'aeroway' ||
    val === 'bus_station' ||
    val === 'station' ||
    val === 'ferry_terminal'
  ) {
    return { kind: 'landmark', categoryLabel: 'Estación / Transporte' };
  }
  if (val === 'stadium' || val === 'sports_centre') {
    return { kind: 'landmark', categoryLabel: 'Estadio / Deporte' };
  }
  if (val === 'university' || val === 'college' || val === 'school') {
    return { kind: 'landmark', categoryLabel: 'Centro educativo' };
  }
  if (val === 'mall' || val === 'department_store' || val === 'supermarket' || key === 'shop') {
    return { kind: 'landmark', categoryLabel: 'Comercio / Centro' };
  }
  if (val === 'townhall' || val === 'courthouse' || val === 'public_building') {
    return { kind: 'landmark', categoryLabel: 'Edificio público' };
  }
  if (LANDMARK_OSM_KEYS.has(key) && hasName) {
    return { kind: 'landmark', categoryLabel: 'Lugar de interés' };
  }
  return { kind: 'address', categoryLabel: 'Dirección' };
}

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function rankPlaceSuggestions(
  suggestions: PlaceSuggestion[],
  query: string,
  biasCoords?: Coordinates | null
): PlaceSuggestion[] {
  const normQuery = normalizeSearchText(query);

  return [...suggestions].sort((a, b) => {
    const score = (s: PlaceSuggestion): number => {
      let val = 0;
      const normLabel = normalizeSearchText(s.label);

      if (s.kind === 'landmark') val += 25;
      if (normQuery && normLabel === normQuery) val += 50;
      else if (normQuery && normLabel.startsWith(normQuery)) val += 30;
      else if (normQuery && normLabel.includes(normQuery)) val += 15;

      if (s.countryCode?.toUpperCase() === 'ES') val += 40;

      if (biasCoords) {
        const km = calculateDistance(biasCoords.lat, biasCoords.lon, s.lat, s.lon) / 1000;
        if (km < 5) val += 35;
        else if (km < 25) val += 20;
        else if (km < 150) val += 10;
      }
      return val;
    };

    return score(b) - score(a);
  });
}

export function parsePhotonFeatures(
  features: PhotonRawFeature[] | undefined | null,
  query = '',
  biasCoords?: Coordinates | null
): PlaceSuggestion[] {
  if (!Array.isArray(features)) return [];
  const parsed: PlaceSuggestion[] = [];

  for (let i = 0; i < features.length; i++) {
    const feat = features[i];
    const coords = feat.geometry?.coordinates;
    const props = feat.properties;
    if (
      !props ||
      !Array.isArray(coords) ||
      coords.length < 2 ||
      typeof coords[0] !== 'number' ||
      typeof coords[1] !== 'number' ||
      !Number.isFinite(coords[0]) ||
      !Number.isFinite(coords[1])
    ) {
      continue;
    }

    const lon = coords[0];
    const lat = coords[1];
    const name = props.name?.trim() || '';
    const streetWithNum = props.street
      ? props.housenumber
        ? `${props.street}, ${props.housenumber}`
        : props.street
      : '';

    const label = name || streetWithNum || props.city || props.locality || '';
    if (!label) continue;

    const { kind, categoryLabel } = classifyPhotonPoi(
      props.osm_key,
      props.osm_value,
      Boolean(name)
    );

    const subtitleParts: string[] = [];
    if (name && streetWithNum && streetWithNum !== name) {
      subtitleParts.push(streetWithNum);
    }
    const cityText = props.city || props.locality || props.district || props.county || props.state;
    if (cityText && cityText !== label) {
      subtitleParts.push(cityText);
    }
    if (props.country && props.country !== label) {
      subtitleParts.push(props.country);
    }

    const isDuplicate = parsed.some(
      (existing) =>
        normalizeSearchText(existing.label) === normalizeSearchText(label) &&
        calculateDistance(existing.lat, existing.lon, lat, lon) < 80
    );
    if (isDuplicate) continue;

    parsed.push({
      id: `${props.osm_type || 'p'}-${props.osm_id || i}-${lat.toFixed(4)}`,
      label,
      subtitle: subtitleParts.join(' · ') || categoryLabel,
      categoryLabel,
      kind,
      lat,
      lon,
      countryCode: props.countrycode,
    });
  }

  return rankPlaceSuggestions(parsed, query, biasCoords);
}

export function formatNominatimSearchLabel(item: {
  name?: string;
  category?: string;
  type?: string;
  display_name?: string;
  address?: NominatimAddress;
  lat: number;
  lon: number;
}): string {
  const cleanName = item.name?.trim();
  const isPoiCategory =
    Boolean(item.category && LANDMARK_OSM_KEYS.has(item.category.toLowerCase()));

  if (cleanName && isPoiCategory) {
    return cleanName;
  }
  if (item.address) {
    return formatNominatimAddress(item.address, { lat: item.lat, lon: item.lon });
  }
  if (cleanName) return cleanName;
  return item.display_name?.split(',').slice(0, 2).join(',').trim() || `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}`;
}

export function buildGoogleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

export function buildStreetViewUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;
}

export function buildGoogleMapsDirectionsUrl(
  origin: Coordinates,
  target: Coordinates
): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lon}&destination=${target.lat},${target.lon}&travelmode=walking`;
}

export function buildOsmNoteUrl(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/note/new#map=19/${lat.toFixed(6)}/${lon.toFixed(6)}`;
}

/**
 * Converts GeoJSON [lon, lat] coordinates into Leaflet [lat, lon] tuples.
 */
export function convertGeoJsonLineToLatLngs(
  coords: Array<[number, number]> | undefined | null
): Array<[number, number]> {
  if (!Array.isArray(coords)) return [];
  const result: Array<[number, number]> = [];
  for (const pair of coords) {
    if (
      Array.isArray(pair) &&
      pair.length >= 2 &&
      typeof pair[0] === 'number' &&
      typeof pair[1] === 'number' &&
      Number.isFinite(pair[0]) &&
      Number.isFinite(pair[1])
    ) {
      result.push([pair[1], pair[0]]);
    }
  }
  return result;
}

export function formatDurationMinutes(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 1;
  }
  return Math.max(1, Math.round(durationSeconds / 60));
}

/**
 * Finds the coordinate along a polyline closest to half of its cumulative distance.
 */
export function getRouteMidpoint(coords: Array<[number, number]>): [number, number] | null {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (coords.length === 1) return coords[0];
  if (coords.length === 2) {
    return [(coords[0][0] + coords[1][0]) / 2, (coords[0][1] + coords[1][1]) / 2];
  }

  let total = 0;
  const segLengths: number[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const len = calculateDistance(
      coords[i][0],
      coords[i][1],
      coords[i + 1][0],
      coords[i + 1][1]
    );
    segLengths.push(len);
    total += len;
  }

  if (total === 0) return coords[0];

  const half = total / 2;
  let walked = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const seg = segLengths[i];
    if (walked + seg >= half && seg > 0) {
      const ratio = (half - walked) / seg;
      const a = coords[i];
      const b = coords[i + 1];
      return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
    }
    walked += seg;
  }

  return coords[Math.floor(coords.length / 2)];
}
