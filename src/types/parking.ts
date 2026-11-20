export type RadiusOption = 300 | 500 | 1000;

export type MapLayerType = 'street' | 'satellite' | 'pnoa';

export type FreeStatus = 'free' | 'paid' | 'unknown';

export type SheetSnap = 'collapsed' | 'half' | 'expanded';

export type RouteMode = 'foot' | 'moto';

export interface ActiveRoute {
  spotId: string;
  mode: RouteMode;
  coordinates: Array<[number, number]>;
  distanceMeters: number;
  durationSeconds: number;
  isFallbackStraightLine: boolean;
}

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface SearchOrigin extends Coordinates {
  label: string;
  source: 'address' | 'geolocation';
}

export type PlaceKind = 'landmark' | 'address';

export interface PlaceSuggestion {
  id: string;
  label: string;
  subtitle: string;
  categoryLabel: string;
  kind: PlaceKind;
  lat: number;
  lon: number;
  countryCode?: string;
}

export interface OverpassTagMap {
  amenity?: string;
  name?: string;
  indoor?: string;
  capacity?: string;
  covered?: string;
  fee?: string;
  access?: string;
  surface?: string;
  operator?: string;
  'addr:street'?: string;
  'addr:housenumber'?: string;
  'addr:full'?: string;
  street?: string;
  [key: string]: string | undefined;
}

export interface OverpassMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role?: string;
  lat?: number;
  lon?: number;
  geometry?: Array<{ lat: number; lon: number }>;
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: Array<{ lat: number; lon: number }>;
  members?: OverpassMember[];
  tags?: OverpassTagMap;
}

export interface ParkingMetadata {
  capacity: string | null;
  covered: boolean | null;
  fee: boolean | null;
  accessNote: string | null;
}

export type SpotCategory = 'exclusive' | 'mixed_moto' | 'surface' | 'community';

export interface ParkingSpot {
  id: string;
  osmType: 'node' | 'way' | 'relation' | 'community';
  osmId: number;
  lat: number;
  lon: number;
  name: string;
  street: string | null;
  streetLoading: boolean;
  distance: number;
  walkMinutes: number;
  category: SpotCategory;
  freeStatus: FreeStatus;
  tags: OverpassTagMap;
  metadata: ParkingMetadata;
  createdAt?: string;
}

export interface CommunitySpotRecord {
  id: string;
  lat: number;
  lon: number;
  name: string;
  street: string;
  capacity?: string;
  covered?: boolean;
  createdAt: string;
}

export type SearchStatus =
  | 'idle'
  | 'geocoding'
  | 'searching_osm'
  | 'success'
  | 'empty'
  | 'error';

export interface NominatimAddress {
  road?: string;
  pedestrian?: string;
  footway?: string;
  residential?: string;
  living_street?: string;
  path?: string;
  square?: string;
  leisure?: string;
  park?: string;
  industrial?: string;
  commercial?: string;
  house_number?: string;
  neighbourhood?: string;
  suburb?: string;
  quarter?: string;
  place?: string;
  town?: string;
  city?: string;
  village?: string;
}
