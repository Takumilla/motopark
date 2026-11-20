import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Layers, X } from 'lucide-react';
import type {
  ActiveRoute,
  Coordinates,
  MapLayerType,
  ParkingSpot,
  RadiusOption,
  RouteMode,
  SearchOrigin,
} from '../types/parking';
import {
  buildGoogleMapsUrl,
  buildStreetViewUrl,
  calculateDistance,
  formatDistance,
  formatDurationMinutes,
  getCategoryLabel,
  getRouteMidpoint,
} from '../utils/geo';

interface MapViewProps {
  origin: SearchOrigin | null;
  radius: RadiusOption;
  spots: ParkingSpot[];
  selectedSpotId: string | null;
  activeRoute: ActiveRoute | null;
  routeLoading: boolean;
  routeMode: RouteMode;
  layerType: MapLayerType;
  isPlacingSpot: boolean;
  onLayerTypeChange: (layer: MapLayerType) => void;
  onRouteModeChange: (mode: RouteMode) => void;
  onSelectSpot: (spot: ParkingSpot) => void;
  onToggleRoute: (spot: ParkingSpot) => void;
  onClearRoute: () => void;
  onMapClickPlaceSpot: (coords: Coordinates) => void;
  onCancelPlaceSpot: () => void;
}

const DEFAULT_CENTER: [number, number] = [43.3223, -1.9839];
const DEFAULT_ZOOM = 13;

export const MapView: React.FC<MapViewProps> = ({
  origin,
  radius,
  spots,
  selectedSpotId,
  activeRoute,
  routeLoading,
  routeMode,
  layerType,
  isPlacingSpot,
  onLayerTypeChange,
  onRouteModeChange,
  onSelectSpot,
  onToggleRoute,
  onClearRoute,
  onMapClickPlaceSpot,
  onCancelPlaceSpot,
}) => {
  const routeSpotId = activeRoute?.spotId ?? null;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const streetLayerRef = useRef<L.TileLayer | null>(null);
  const satelliteLayerRef = useRef<L.TileLayer | null>(null);
  const pnoaLayerRef = useRef<L.TileLayer | null>(null);
  const labelsLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const markerByIdRef = useRef<Map<string, L.Marker>>(new Map());
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const originLayerRef = useRef<L.LayerGroup | null>(null);

  const onSelectSpotRef = useRef(onSelectSpot);
  const onToggleRouteRef = useRef(onToggleRoute);
  const isPlacingSpotRef = useRef(isPlacingSpot);
  const onMapClickPlaceSpotRef = useRef(onMapClickPlaceSpot);
  onSelectSpotRef.current = onSelectSpot;
  onToggleRouteRef.current = onToggleRoute;
  isPlacingSpotRef.current = isPlacingSpot;
  onMapClickPlaceSpotRef.current = onMapClickPlaceSpot;

  // Initialize Leaflet map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
    });

    const streetLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 19,
      }
    );

    const satelliteLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Imagery &copy; Esri',
        maxZoom: 19,
      }
    );

    const pnoaLayer = L.tileLayer(
      'https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=OI.OrthoimageCoverage&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
      {
        attribution: 'Ortofoto PNOA &copy; IGN España',
        maxNativeZoom: 19,
        maxZoom: 20,
      }
    );

    const labelsLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 20,
        opacity: 0.85,
      }
    );

    streetLayer.addTo(map);

    const originGroup = L.layerGroup().addTo(map);
    const markersGroup = L.layerGroup().addTo(map);
    const routeGroup = L.layerGroup().addTo(map);

    mapRef.current = map;
    streetLayerRef.current = streetLayer;
    satelliteLayerRef.current = satelliteLayer;
    pnoaLayerRef.current = pnoaLayer;
    labelsLayerRef.current = labelsLayer;
    originLayerRef.current = originGroup;
    markersLayerRef.current = markersGroup;
    routeLayerRef.current = routeGroup;

    map.on('click', (ev: L.LeafletMouseEvent) => {
      if (isPlacingSpotRef.current) {
        onMapClickPlaceSpotRef.current({ lat: ev.latlng.lat, lon: ev.latlng.lng });
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Toggle crosshair cursor while placing a community spot
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.cursor = isPlacingSpot ? 'crosshair' : '';
  }, [isPlacingSpot]);

  // Switch Street / Satellite / IGN PNOA Orthophoto layers
  useEffect(() => {
    const map = mapRef.current;
    const street = streetLayerRef.current;
    const satellite = satelliteLayerRef.current;
    const pnoa = pnoaLayerRef.current;
    const labels = labelsLayerRef.current;
    if (!map || !street || !satellite || !pnoa || !labels) return;

    if (layerType === 'pnoa') {
      if (map.hasLayer(street)) map.removeLayer(street);
      if (map.hasLayer(satellite)) map.removeLayer(satellite);
      if (!map.hasLayer(pnoa)) pnoa.addTo(map);
      if (!map.hasLayer(labels)) labels.addTo(map);
    } else if (layerType === 'satellite') {
      if (map.hasLayer(street)) map.removeLayer(street);
      if (map.hasLayer(pnoa)) map.removeLayer(pnoa);
      if (!map.hasLayer(satellite)) satellite.addTo(map);
      if (!map.hasLayer(labels)) labels.addTo(map);
    } else {
      if (map.hasLayer(satellite)) map.removeLayer(satellite);
      if (map.hasLayer(pnoa)) map.removeLayer(pnoa);
      if (map.hasLayer(labels)) map.removeLayer(labels);
      if (!map.hasLayer(street)) street.addTo(map);
    }
  }, [layerType]);

  // Render search origin pin + radius perimeter
  useEffect(() => {
    const map = mapRef.current;
    const originGroup = originLayerRef.current;
    if (!map || !originGroup) return;

    originGroup.clearLayers();

    if (!origin) return;

    L.circle([origin.lat, origin.lon], {
      radius,
      color: '#ea580c',
      weight: 1.5,
      dashArray: '6, 6',
      fillColor: '#ea580c',
      fillOpacity: 0.07,
    }).addTo(originGroup);

    const originIcon = L.divIcon({
      className: '',
      html: `<div style="position:relative;width:28px;height:28px;display:flex;align-items:center;justify-content:center;">
        <span class="origin-pulse" style="position:absolute;inset:0;border-radius:9999px;background:rgba(234,88,12,0.35);"></span>
        <span style="width:16px;height:16px;border-radius:9999px;background:#0f172a;border:3px solid #ffffff;box-shadow:0 2px 8px rgba(15,23,42,0.4);"></span>
      </div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    const originMarker = L.marker([origin.lat, origin.lon], {
      icon: originIcon,
      zIndexOffset: 500,
    }).addTo(originGroup);

    originMarker.bindPopup(
      `<div style="padding:12px 14px;">
        <p style="margin:0 0 2px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#ea580c;">Punto de búsqueda</p>
        <p style="margin:0;font-size:13px;font-weight:600;color:#0f172a;">${escapeHtml(origin.label)}</p>
      </div>`
    );

    const zoomByRadius = radius === 300 ? 16 : radius === 500 ? 15.5 : 14.5;
    map.setView([origin.lat, origin.lon], Math.round(zoomByRadius), {
      animate: true,
    });
  }, [origin, radius]);

  // Render numbered parking spot markers
  useEffect(() => {
    const markersGroup = markersLayerRef.current;
    if (!markersGroup) return;

    markersGroup.clearLayers();
    markerByIdRef.current.clear();

    spots.forEach((spot, index) => {
      const isHighlighted = spot.id === selectedSpotId || spot.id === routeSpotId;
      const bg = isHighlighted
        ? '#ea580c'
        : spot.category === 'community'
        ? '#4f46e5'
        : spot.category === 'surface'
        ? '#475569'
        : '#0f766e';
      const scale = isHighlighted ? 'scale(1.14)' : 'scale(1)';
      const zOffset = isHighlighted ? 400 : 100 - index;

      const icon = L.divIcon({
        className: '',
        html: `<div style="transform:${scale};transition:transform 160ms ease;width:32px;height:32px;border-radius:9999px;background:${bg};color:#ffffff;border:2.5px solid #ffffff;box-shadow:0 4px 10px rgba(15,23,42,0.32);display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;">
          ${index + 1}
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -14],
      });

      const marker = L.marker([spot.lat, spot.lon], {
        icon,
        zIndexOffset: zOffset,
      }).addTo(markersGroup);

      const streetText = spot.street
        ? escapeHtml(spot.street)
        : spot.streetLoading
        ? 'Identificando calle...'
        : `${spot.lat.toFixed(5)}, ${spot.lon.toFixed(5)}`;

      const freeLabel =
        spot.freeStatus === 'free'
          ? '<span style="color:#047857;font-weight:700;">· Gratis</span>'
          : spot.freeStatus === 'paid'
          ? '<span style="color:#b45309;font-weight:700;">· De pago</span>'
          : '';

      const popupEl = document.createElement('div');
      popupEl.style.padding = '12px 14px';
      popupEl.innerHTML = `
        <div style="padding-right:18px;">
          <p style="margin:0;font-size:11px;font-weight:700;color:${bg};text-transform:uppercase;letter-spacing:0.03em;">${escapeHtml(
            getCategoryLabel(spot.category)
          )} ${freeLabel}</p>
          <p style="margin:2px 0 0 0;font-size:14px;font-weight:700;color:#0f172a;line-height:1.3;">${index + 1}. ${escapeHtml(spot.name)}</p>
          <p style="margin:4px 0 0 0;font-size:12px;color:#475569;font-weight:500;">${streetText}</p>
          <p style="margin:6px 0 10px 0;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600;color:#ea580c;">${formatDistance(spot.distance)} · ${spot.walkMinutes} min a pie</p>
        </div>
        <div style="display:flex;gap:6px;">
          <button type="button" data-action="route" style="flex:1;min-height:36px;padding:0 8px;border-radius:8px;border:none;background:#f1f5f9;color:#0f172a;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">
            ${spot.id === routeSpotId ? 'Ocultar' : 'Ruta'}
          </button>
          <a href="${buildStreetViewUrl(spot.lat, spot.lon)}" target="_blank" rel="noopener noreferrer" style="flex:1.25;min-height:36px;padding:0 8px;border-radius:8px;background:#eef2ff;color:#3730a3;font-size:11px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;">
            Street View
          </a>
          <a href="${buildGoogleMapsUrl(spot.lat, spot.lon)}" target="_blank" rel="noopener noreferrer" style="flex:1;min-height:36px;padding:0 8px;border-radius:8px;background:#0f172a;color:#ffffff;font-size:11px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;">
            Maps
          </a>
        </div>
      `;

      const routeBtn = popupEl.querySelector('[data-action="route"]');
      if (routeBtn) {
        routeBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onToggleRouteRef.current(spot);
        });
      }

      marker.bindPopup(popupEl, {
        autoPanPaddingTopLeft: L.point(16, 72),
        autoPanPaddingBottomRight: L.point(16, 100),
        maxWidth: 280,
      });
      marker.on('click', () => {
        onSelectSpotRef.current(spot);
      });

      markerByIdRef.current.set(spot.id, marker);
    });
  }, [spots, selectedSpotId, routeSpotId]);

  // Center map & open popup when a spot is selected (without obstructing traced route)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedSpotId || routeSpotId) return;

    const spot = spots.find((s) => s.id === selectedSpotId);
    const marker = markerByIdRef.current.get(selectedSpotId);
    if (!spot) return;

    map.setView([spot.lat, spot.lon], Math.max(map.getZoom(), 17), { animate: true });
    if (marker) {
      marker.openPopup();
    }
  }, [selectedSpotId, spots, routeSpotId]);

  // Draw real street-following route polyline + midpoint tooltip when activeRoute is set
  useEffect(() => {
    const map = mapRef.current;
    const routeGroup = routeLayerRef.current;
    if (!map || !routeGroup) return;

    routeGroup.clearLayers();

    if (!origin || !activeRoute || activeRoute.coordinates.length < 2) return;
    const target = spots.find((s) => s.id === activeRoute.spotId);
    if (!target) return;

    const coords = activeRoute.coordinates;

    // Subtle curb connectors only for short sidewalk-to-street snaps (<= 35 m)
    const firstPt = coords[0];
    const lastPt = coords[coords.length - 1];
    if (calculateDistance(origin.lat, origin.lon, firstPt[0], firstPt[1]) <= 35) {
      L.polyline([[origin.lat, origin.lon], firstPt], {
        color: '#64748b',
        weight: 2.5,
        opacity: 0.7,
        dashArray: '4, 5',
      }).addTo(routeGroup);
    }

    if (calculateDistance(lastPt[0], lastPt[1], target.lat, target.lon) <= 35) {
      L.polyline([lastPt, [target.lat, target.lon]], {
        color: '#64748b',
        weight: 2.5,
        opacity: 0.7,
        dashArray: '4, 5',
      }).addTo(routeGroup);
    }

    // Outer white halo for crisp contrast on street and satellite tiles
    L.polyline(coords, {
      color: '#ffffff',
      weight: 8,
      opacity: 0.92,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(routeGroup);

    // Primary street route line
    L.polyline(coords, {
      color: '#ea580c',
      weight: 4.5,
      opacity: 0.96,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: activeRoute.isFallbackStraightLine ? '8, 8' : undefined,
    }).addTo(routeGroup);

    const midpoint = getRouteMidpoint(coords) ?? [
      (origin.lat + target.lat) / 2,
      (origin.lon + target.lon) / 2,
    ];
    const mins = formatDurationMinutes(activeRoute.durationSeconds);
    const modeText = activeRoute.mode === 'moto' ? 'en moto' : 'a pie';

    L.tooltip({
      permanent: true,
      direction: 'center',
      className: 'route-distance-tooltip',
    })
      .setContent(`${formatDistance(activeRoute.distanceMeters)} · ${mins} min ${modeText}`)
      .setLatLng(midpoint)
      .addTo(routeGroup);

    map.closePopup();

    const bounds = L.latLngBounds([
      [origin.lat, origin.lon],
      [target.lat, target.lon],
      ...coords,
    ]);
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;
    map.fitBounds(bounds, {
      paddingTopLeft: isMobile ? [44, 72] : [64, 64],
      paddingBottomRight: isMobile ? [44, 120] : [64, 64],
      maxZoom: 18,
    });
  }, [origin, activeRoute, spots]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        data-testid="leaflet-map"
        className="w-full h-full"
        aria-label="Mapa interactivo de aparcamientos para motos"
      />

      {/* Top-right Map Layer Toggle (Callejero / Satélite / Ortofoto IGN PNOA) */}
      <div
        className="absolute top-3 right-3 z-[800] flex items-center bg-white/95 backdrop-blur-md p-1 rounded-xl border border-slate-200 shadow-md max-w-[calc(100%-64px)]"
        role="group"
        aria-label="Tipo de mapa"
      >
        <button
          type="button"
          onClick={() => onLayerTypeChange('street')}
          aria-pressed={layerType === 'street'}
          className={`min-h-[36px] px-2.5 sm:px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
            layerType === 'street'
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-3.5 h-3.5 hidden sm:block" />
          <span>Callejero</span>
        </button>
        <button
          type="button"
          onClick={() => onLayerTypeChange('satellite')}
          aria-pressed={layerType === 'satellite'}
          className={`min-h-[36px] px-2.5 sm:px-3 rounded-lg text-xs font-semibold inline-flex items-center transition-colors whitespace-nowrap cursor-pointer ${
            layerType === 'satellite'
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <span>Satélite</span>
        </button>
        <button
          type="button"
          onClick={() => onLayerTypeChange('pnoa')}
          aria-pressed={layerType === 'pnoa'}
          title="Ortofoto oficial IGN PNOA (España alta resolución)"
          className={`min-h-[36px] px-2.5 sm:px-3 rounded-lg text-xs font-semibold inline-flex items-center transition-colors whitespace-nowrap cursor-pointer ${
            layerType === 'pnoa'
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <span>IGN PNOA</span>
        </button>
      </div>

      {/* Interactive Placement Mode Banner */}
      {isPlacingSpot && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[950] flex items-center gap-3 bg-indigo-700 text-white px-4 py-2.5 rounded-xl shadow-xl border border-indigo-500 max-w-[92%]">
          <span className="text-xs font-semibold truncate">
            Toca en el mapa donde está el aparcamiento
          </span>
          <button
            type="button"
            onClick={onCancelPlaceSpot}
            className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Active Route Floating Indicator (desktop bottom-left) */}
      {(activeRoute || routeLoading) && (
        <div className="hidden lg:flex absolute bottom-5 left-5 z-[800] items-center gap-3 bg-white/95 backdrop-blur-md px-3.5 py-2 rounded-xl border border-slate-200 shadow-lg">
          {routeLoading ? (
            <span className="text-xs font-medium text-slate-700">
              Calculando ruta por calles...
            </span>
          ) : activeRoute ? (
            <>
              <div className="text-xs">
                <span className="font-semibold text-slate-900">
                  {activeRoute.isFallbackStraightLine ? 'Distancia directa: ' : 'Ruta por calle: '}
                </span>
                <span className="font-mono-tabular font-semibold text-orange-600">
                  {formatDistance(activeRoute.distanceMeters)} ·{' '}
                  {formatDurationMinutes(activeRoute.durationSeconds)} min
                </span>
              </div>

              <div
                role="group"
                aria-label="Modo de ruta"
                className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80"
              >
                <button
                  type="button"
                  onClick={() => onRouteModeChange('foot')}
                  aria-pressed={routeMode === 'foot'}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    routeMode === 'foot'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  A pie
                </button>
                <button
                  type="button"
                  onClick={() => onRouteModeChange('moto')}
                  aria-pressed={routeMode === 'moto'}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    routeMode === 'moto'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  En moto
                </button>
              </div>
            </>
          ) : null}

          <button
            type="button"
            onClick={onClearRoute}
            aria-label="Cerrar ruta"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
