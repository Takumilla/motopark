import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const USER_AGENT = 'MotoParkApp/2.0 (https://github.com/takumilla/motopark)';

const OVERPASS_ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.post('/api/overpass', async (req, res) => {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query || query.length > 2000 || !query.startsWith('[out:json]')) {
      res.status(400).json({ error: 'Consulta Overpass no válida.' });
      return;
    }

    const encodedBody = `data=${encodeURIComponent(query)}`;

    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const response = await fetchWithTimeout(
          endpoint,
          {
            method: 'POST',
            headers: {
              'User-Agent': USER_AGENT,
              Accept: 'application/json, text/plain, */*',
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            body: encodedBody,
          },
          10000
        );

        if (!response.ok) {
          continue;
        }

        const data = await response.json();
        res.json(data);
        return;
      } catch {
        // Try next Overpass mirror
      }
    }

    res.status(502).json({
      error:
        'Los servidores públicos de OpenStreetMap están saturados temporalmente. Inténtalo de nuevo en unos segundos.',
    });
  });

  app.get('/api/geocode', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q || q.length > 300) {
      res.status(400).json({ error: 'Dirección no válida.' });
      return;
    }

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&accept-language=es&q=${encodeURIComponent(
        q
      )}`;
      const response = await fetchWithTimeout(
        url,
        {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
          },
        },
        8000
      );

      if (!response.ok) {
        if (response.status === 429) {
          res.json([]);
          return;
        }
        res.status(response.status).json({ error: 'Error al consultar Nominatim.' });
        return;
      }

      const data = await response.json();
      res.json(data);
    } catch {
      res.status(502).json({ error: 'No se pudo conectar con el servicio de geocodificación.' });
    }
  });

  app.get('/api/suggest', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q || q.length > 300) {
      res.status(400).json({ error: 'Consulta no válida.' });
      return;
    }

    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const biasParams =
      Number.isFinite(lat) && Number.isFinite(lon) ? `&lat=${lat}&lon=${lon}` : '';

    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8${biasParams}`;
      const response = await fetchWithTimeout(
        url,
        {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
          },
        },
        6000
      );

      if (!response.ok) {
        res.status(response.status).json({ error: 'Error al obtener sugerencias.' });
        return;
      }

      const data = await response.json();
      res.json(data);
    } catch {
      res.status(502).json({ error: 'No se pudo conectar con el servicio de sugerencias.' });
    }
  });

  app.get('/api/reverse', async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.status(400).json({ error: 'Coordenadas no válidas.' });
      return;
    }

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&accept-language=es`;
      const response = await fetchWithTimeout(
        url,
        {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
          },
        },
        5000
      );

      if (response.ok) {
        const data = await response.json();
        res.json(data);
        return;
      }

      // Fallback to Photon reverse geocoder when Nominatim rate-limits (429) or fails
      const photonRes = await fetchWithTimeout(
        `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`,
        {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
          },
        },
        5000
      );

      if (photonRes.ok) {
        const photonData = (await photonRes.json()) as {
          features?: Array<{
            properties?: {
              street?: string;
              name?: string;
              housenumber?: string;
              locality?: string;
              district?: string;
              city?: string;
            };
          }>;
        };
        const props = photonData.features?.[0]?.properties;
        if (props) {
          res.json({
            address: {
              road: props.street || props.name,
              house_number: props.housenumber,
              neighbourhood: props.locality || props.district,
              city: props.city,
            },
          });
          return;
        }
      }

      res.status(response.status).json({ error: 'Error en geocodificación inversa.' });
    } catch {
      res.status(502).json({ error: 'Error de red en geocodificación inversa.' });
    }
  });

  app.get('/api/route', async (req, res) => {
    const fromLat = Number(req.query.fromLat);
    const fromLon = Number(req.query.fromLon);
    const toLat = Number(req.query.toLat);
    const toLon = Number(req.query.toLon);
    const mode = req.query.mode === 'moto' ? 'moto' : 'foot';

    if (
      !Number.isFinite(fromLat) ||
      !Number.isFinite(fromLon) ||
      !Number.isFinite(toLat) ||
      !Number.isFinite(toLon)
    ) {
      res.status(400).json({ error: 'Coordenadas de ruta no válidas.' });
      return;
    }

    const profile = mode === 'moto' ? 'routed-car' : 'routed-foot';
    const routeEndpoints = [
      `https://routing.openstreetmap.de/${profile}/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`,
      `https://router.project-osrm.org/route/v1/${
        mode === 'moto' ? 'driving' : 'foot'
      }/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`,
    ];

    for (const url of routeEndpoints) {
      try {
        const response = await fetchWithTimeout(
          url,
          {
            headers: {
              'User-Agent': USER_AGENT,
              Accept: 'application/json',
            },
          },
          8000
        );

        if (!response.ok) {
          continue;
        }

        const data = (await response.json()) as {
          code?: string;
          routes?: Array<{
            distance?: number;
            duration?: number;
            geometry?: { coordinates?: Array<[number, number]> };
          }>;
        };

        if (data.code === 'Ok' && Array.isArray(data.routes) && data.routes.length > 0) {
          const best = data.routes[0];
          res.json({
            distance: best.distance ?? 0,
            duration: best.duration ?? 0,
            coordinates: best.geometry?.coordinates ?? [],
          });
          return;
        }
      } catch {
        // Try fallback routing server
      }
    }

    res.status(502).json({ error: 'No se pudo calcular la ruta por calle en este momento.' });
  });

  const dataDir = path.resolve(__dirname, '.data');
  const communityFile = path.join(dataDir, 'community-spots.json');

  interface StoredSpot {
    id: string;
    lat: number;
    lon: number;
    name: string;
    street: string;
    capacity?: string;
    covered?: boolean;
    createdAt: string;
  }

  const readCommunitySpots = (): StoredSpot[] => {
    try {
      if (!fs.existsSync(communityFile)) return [];
      const raw = fs.readFileSync(communityFile, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const writeCommunitySpots = (spots: StoredSpot[]) => {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(communityFile, JSON.stringify(spots, null, 2), 'utf8');
  };

  app.get('/api/community-spots', (_req, res) => {
    res.json({ spots: readCommunitySpots() });
  });

  app.post('/api/community-spots', (req, res) => {
    const lat = Number(req.body?.lat);
    const lon = Number(req.body?.lon);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
    const street = typeof req.body?.street === 'string' ? req.body.street.trim().slice(0, 120) : '';
    const capacityRaw =
      typeof req.body?.capacity === 'string' ? req.body.capacity.trim().slice(0, 8) : '';
    const capacity = /^\d+$/.test(capacityRaw) ? capacityRaw : undefined;
    const covered = typeof req.body?.covered === 'boolean' ? req.body.covered : undefined;

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      res.status(400).json({ error: 'Coordenadas no válidas.' });
      return;
    }

    const record: StoredSpot = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      lat,
      lon,
      name: name || 'Plaza de moto (vecinal)',
      street: street || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
      capacity,
      covered,
      createdAt: new Date().toISOString(),
    };

    const existing = readCommunitySpots();
    existing.unshift(record);
    writeCommunitySpots(existing.slice(0, 500));

    res.status(201).json({ spot: record });
  });

  app.delete('/api/community-spots/:id', (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ error: 'ID no válido.' });
      return;
    }
    const existing = readCommunitySpots();
    const filtered = existing.filter((s) => s.id !== id);
    writeCommunitySpots(filtered);
    res.json({ ok: true });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MotoPark server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
