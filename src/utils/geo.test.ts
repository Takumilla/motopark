import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsUrl,
  buildOsmNoteUrl,
  buildOverpassQuery,
  buildStreetViewUrl,
  calculateDistance,
  classifyOverpassElement,
  classifyPhotonPoi,
  convertGeoJsonLineToLatLngs,
  estimateWalkMinutes,
  extractElementCoordinates,
  filterAndPrioritizeSpots,
  formatDistance,
  formatDurationMinutes,
  formatMetadataSummary,
  formatNominatimAddress,
  formatNominatimSearchLabel,
  getRouteMidpoint,
  getSpotFreeStatus,
  mergeSpotsWithCommunity,
  parseParkingMetadata,
  parsePhotonFeatures,
  processOverpassElements,
} from './geo';
import type { CommunitySpotRecord, OverpassElement } from '../types/parking';

test('calculateDistance returns 0 for identical coordinates and accurate meters for known span', () => {
  assert.equal(calculateDistance(43.324, -1.985, 43.324, -1.985), 0);
  // Roughly 111.19 meters per 0.001 degree latitude
  const dist = calculateDistance(43.324, -1.985, 43.325, -1.985);
  assert.ok(dist > 110 && dist < 112, `Expected ~111m, got ${dist}`);
});

test('formatDistance formats meters and kilometers cleanly', () => {
  assert.equal(formatDistance(244.6), '245 m');
  assert.equal(formatDistance(999), '999 m');
  assert.equal(formatDistance(1000), '1,0 km');
  assert.equal(formatDistance(1450), '1,5 km');
});

test('estimateWalkMinutes clamps to minimum 1 minute', () => {
  assert.equal(estimateWalkMinutes(15), 1);
  assert.equal(estimateWalkMinutes(160), 2);
  assert.equal(estimateWalkMinutes(400), 5);
});

test('extractElementCoordinates handles node, way center, way geometry centroid, and relation', () => {
  assert.deepEqual(
    extractElementCoordinates({ type: 'node', id: 1, lat: 43.32, lon: -1.98 }),
    { lat: 43.32, lon: -1.98 }
  );

  assert.deepEqual(
    extractElementCoordinates({
      type: 'way',
      id: 2,
      center: { lat: 43.321, lon: -1.981 },
      geometry: [
        { lat: 43.32, lon: -1.98 },
        { lat: 43.322, lon: -1.982 },
      ],
    }),
    { lat: 43.321, lon: -1.981 }
  );

  const wayCentroid = extractElementCoordinates({
    type: 'way',
    id: 3,
    geometry: [
      { lat: 43.32, lon: -1.98 },
      { lat: 43.34, lon: -2.0 },
    ],
  });
  assert.ok(wayCentroid);
  assert.ok(Math.abs(wayCentroid.lat - 43.33) < 1e-6);
  assert.ok(Math.abs(wayCentroid.lon - -1.99) < 1e-6);

  assert.equal(extractElementCoordinates({ type: 'way', id: 4 }), null);
});

test('processOverpassElements filters indoor, deduplicates close points, parses metadata, and sorts by distance', () => {
  const origin = { lat: 43.3245, lon: -1.9858 };
  const elements: OverpassElement[] = [
    // Tagless child node (should be ignored)
    { type: 'node', id: 10, lat: 43.3246, lon: -1.9859 },
    // Indoor parking (should be excluded)
    {
      type: 'node',
      id: 11,
      lat: 43.3246,
      lon: -1.9858,
      tags: { amenity: 'motorcycle_parking', indoor: 'yes' },
    },
    // Farther valid spot with OSM street tag and metadata
    {
      type: 'way',
      id: 12,
      center: { lat: 43.3265, lon: -1.9858 },
      tags: {
        amenity: 'motorcycle_parking',
        'addr:street': 'Paseo de Salamanca',
        'addr:housenumber': '4',
        capacity: '14',
        covered: 'no',
        fee: 'no',
      },
    },
    // Closest valid spot
    {
      type: 'node',
      id: 13,
      lat: 43.3249,
      lon: -1.9858,
      tags: {
        amenity: 'motorcycle_parking',
        name: 'Parking Boulevard',
      },
    },
    // Duplicate within 3 meters of id 13
    {
      type: 'way',
      id: 14,
      center: { lat: 43.32491, lon: -1.98581 },
      tags: {
        amenity: 'motorcycle_parking',
      },
    },
  ];

  const spots = processOverpassElements(elements, origin);
  assert.equal(spots.length, 2);
  assert.equal(spots[0].osmId, 13);
  assert.equal(spots[0].name, 'Parking Boulevard');
  assert.equal(spots[0].streetLoading, true);
  assert.equal(spots[0].freeStatus, 'free');
  assert.equal(spots[1].osmId, 12);
  assert.equal(spots[1].street, 'Paseo de Salamanca, 4');
  assert.equal(spots[1].streetLoading, false);
  assert.deepEqual(formatMetadataSummary(parseParkingMetadata(spots[1].tags), spots[1].freeStatus), [
    'Gratis',
    '14 plazas',
  ]);
  assert.ok(spots[0].distance < spots[1].distance);
});

test('formatNominatimAddress prioritizes street + number and falls back cleanly', () => {
  assert.equal(
    formatNominatimAddress({ road: 'Calle 31 de Agosto', house_number: '12', city: 'Donostia' }),
    'Calle 31 de Agosto, 12'
  );
  assert.equal(
    formatNominatimAddress({ pedestrian: 'Plaza de la Constitución', suburb: 'Parte Vieja' }),
    'Plaza de la Constitución'
  );
  assert.equal(formatNominatimAddress({ neighbourhood: 'Gros', city: 'Donostia' }), 'Gros');
  assert.equal(
    formatNominatimAddress(undefined, { lat: 43.324567, lon: -1.985812 }),
    '43.32457, -1.98581'
  );
});

test('buildOverpassQuery, Google Maps, and Street View URLs produce valid strings', () => {
  const q = buildOverpassQuery(43.32, -1.98, 500);
  assert.ok(q.includes('around:500,43.32,-1.98'));
  assert.ok(q.includes('out center;'));
  assert.equal(
    buildGoogleMapsUrl(43.32, -1.98),
    'https://www.google.com/maps/search/?api=1&query=43.32,-1.98'
  );
  assert.equal(
    buildStreetViewUrl(43.32, -1.98),
    'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=43.32,-1.98'
  );
  assert.ok(
    buildGoogleMapsDirectionsUrl({ lat: 43.3, lon: -1.9 }, { lat: 43.32, lon: -1.98 }).includes(
      'travelmode=walking'
    )
  );
});

test('convertGeoJsonLineToLatLngs swaps lon/lat and filters invalid entries', () => {
  const latLngs = convertGeoJsonLineToLatLngs([
    [-1.985, 43.324],
    [-1.986, 43.323],
  ]);
  assert.deepEqual(latLngs, [
    [43.324, -1.985],
    [43.323, -1.986],
  ]);
  assert.deepEqual(convertGeoJsonLineToLatLngs(null), []);
});

test('formatDurationMinutes and getRouteMidpoint compute accurate street path center', () => {
  assert.equal(formatDurationMinutes(158), 3);
  assert.equal(formatDurationMinutes(12), 1);

  const mid = getRouteMidpoint([
    [43.32, -1.98],
    [43.33, -1.98],
    [43.33, -1.97],
  ]);
  assert.ok(mid);
  assert.ok(mid[0] > 43.325 && mid[0] <= 43.33);
});

test('classifyOverpassElement and getSpotFreeStatus classify fee and category accurately', () => {
  assert.equal(classifyOverpassElement({ amenity: 'motorcycle_parking' }), 'exclusive');
  assert.equal(
    classifyOverpassElement({ amenity: 'parking', motorcycle: 'designated' }),
    'mixed_moto'
  );
  assert.equal(
    classifyOverpassElement({ amenity: 'parking', parking: 'surface' }),
    'surface'
  );
  assert.equal(
    classifyOverpassElement({ amenity: 'parking', parking: 'surface', access: 'private' }),
    null
  );

  assert.equal(getSpotFreeStatus('exclusive', {}), 'free');
  assert.equal(getSpotFreeStatus('exclusive', { fee: 'yes' }), 'paid');
  assert.equal(getSpotFreeStatus('surface', { fee: 'no' }), 'free');
  assert.equal(getSpotFreeStatus('surface', {}), 'unknown');
  assert.equal(getSpotFreeStatus('community', {}), 'free');
});

test('filterAndPrioritizeSpots hides paid by default and puts confirmed free spots first', () => {
  const origin = { lat: 43.3145, lon: -1.932 };
  const elements: OverpassElement[] = [
    // Closest, but paid surface parking (50m)
    {
      type: 'node',
      id: 1,
      lat: 43.31495,
      lon: -1.932,
      tags: { amenity: 'parking', parking: 'surface', fee: 'yes', name: 'Zona Azul' },
    },
    // Closer surface parking with unknown fee (80m)
    {
      type: 'node',
      id: 2,
      lat: 43.31522,
      lon: -1.932,
      tags: { amenity: 'parking', parking: 'surface', name: 'Parking Plaza' },
    },
    // Confirmed free exclusive moto parking slightly farther (130m)
    {
      type: 'node',
      id: 3,
      lat: 43.31567,
      lon: -1.932,
      tags: { amenity: 'motorcycle_parking', name: 'Motos Centro' },
    },
  ];

  const processed = processOverpassElements(elements, origin);
  const freeOnlyResult = filterAndPrioritizeSpots(processed, {
    includeSurface: true,
    onlyFree: true,
  });

  assert.equal(freeOnlyResult.hiddenPaidCount, 1);
  assert.equal(freeOnlyResult.visible.length, 2);
  assert.equal(freeOnlyResult.visible[0].name, 'Motos Centro');
  assert.equal(freeOnlyResult.visible[1].name, 'Parking Plaza');

  const withPaidResult = filterAndPrioritizeSpots(processed, {
    includeSurface: true,
    onlyFree: false,
  });
  assert.equal(withPaidResult.visible.length, 3);
  assert.equal(withPaidResult.visible[2].name, 'Zona Azul');
});

test('mergeSpotsWithCommunity merges community spots within radius and deduplicates', () => {
  const origin = { lat: 43.3145, lon: -1.932 };
  const community: CommunitySpotRecord[] = [
    {
      id: 'c1',
      lat: 43.315,
      lon: -1.932,
      name: 'Batería motos Plaza Harrobieta',
      street: 'Plaza Harrobieta, 2',
      capacity: '8',
      covered: false,
      createdAt: '2026-11-20T12:00:00Z',
    },
    {
      id: 'far',
      lat: 43.35,
      lon: -1.932,
      name: 'Lejos',
      street: 'Otra zona',
      createdAt: '2026-11-20T12:00:00Z',
    },
  ];

  const merged = mergeSpotsWithCommunity([], community, origin, 500);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].category, 'community');
  assert.equal(merged[0].freeStatus, 'free');
  assert.equal(merged[0].metadata.capacity, '8 plazas');
  assert.ok(buildOsmNoteUrl(43.315, -1.932).includes('openstreetmap.org/note/new'));
});

test('classifyPhotonPoi and parsePhotonFeatures extract and prioritize Spanish landmarks cleanly', () => {
  assert.deepEqual(classifyPhotonPoi('amenity', 'hospital', true), {
    kind: 'landmark',
    categoryLabel: 'Hospital / Salud',
  });
  assert.deepEqual(classifyPhotonPoi('tourism', 'hotel', true), {
    kind: 'landmark',
    categoryLabel: 'Hotel',
  });
  assert.deepEqual(classifyPhotonPoi('highway', 'residential', false), {
    kind: 'address',
    categoryLabel: 'Dirección',
  });

  const features = [
    {
      properties: {
        osm_type: 'W',
        osm_id: 1,
        osm_key: 'tourism',
        osm_value: 'hotel',
        name: 'Hotel Maria Cristina',
        street: 'Calle Río Lerma',
        city: 'Ciudad de México',
        country: 'México',
        countrycode: 'MX',
      },
      geometry: { coordinates: [-99.1631, 19.4315] as [number, number] },
    },
    {
      properties: {
        osm_type: 'W',
        osm_id: 2,
        osm_key: 'tourism',
        osm_value: 'hotel',
        name: 'Hotel María Cristina',
        street: 'Argentinako Errepublika pasealekua',
        housenumber: '4',
        city: 'Donostia / San Sebastián',
        country: 'España',
        countrycode: 'ES',
      },
      geometry: { coordinates: [-1.9801, 43.3217] as [number, number] },
    },
  ];

  const ranked = parsePhotonFeatures(features, 'Hotel Maria Cristina', {
    lat: 43.322,
    lon: -1.983,
  });

  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].label, 'Hotel María Cristina');
  assert.equal(ranked[0].kind, 'landmark');
  assert.equal(ranked[0].categoryLabel, 'Hotel');
  assert.ok(ranked[0].subtitle.includes('Donostia'));
  assert.equal(ranked[0].countryCode, 'ES');

  assert.equal(
    formatNominatimSearchLabel({
      name: 'Hospital Universitario Donostia',
      category: 'amenity',
      type: 'hospital',
      address: { road: 'Paseo Doctor Begiristain', city: 'San Sebastián' },
      lat: 43.292,
      lon: -1.97,
    }),
    'Hospital Universitario Donostia'
  );
});
