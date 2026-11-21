import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddSpotModal } from './components/AddSpotModal';
import { MapView } from './components/MapView';
import { MobileBottomSheet } from './components/MobileBottomSheet';
import { ParkingList } from './components/ParkingList';
import { SearchControls } from './components/SearchControls';
import {
  deleteCommunitySpot,
  fetchCommunitySpots,
  fetchMotorcycleParking,
  fetchStreetRoute,
  geocodeAddress,
  reverseGeocodeStreet,
  saveCommunitySpot,
} from './services/osmApi';
import type {
  ActiveRoute,
  CommunitySpotRecord,
  Coordinates,
  MapLayerType,
  ParkingSpot,
  PlaceSuggestion,
  RadiusOption,
  RouteMode,
  SearchOrigin,
  SearchStatus,
  SheetSnap,
} from './types/parking';
import {
  filterAndPrioritizeSpots,
  mergeSpotsWithCommunity,
  processOverpassElements,
} from './utils/geo';

export default function App() {
  const [address, setAddress] = useState<string>('');
  const [radius, setRadius] = useState<RadiusOption>(300);
  const [origin, setOrigin] = useState<SearchOrigin | null>(null);
  const [rawOsmSpots, setRawOsmSpots] = useState<ParkingSpot[]>([]);
  const [communityRecords, setCommunityRecords] = useState<CommunitySpotRecord[]>([]);
  const [includeSurface, setIncludeSurface] = useState<boolean>(false);
  const [onlyFree, setOnlyFree] = useState<boolean>(true);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [statusMessage, setStatusMessage] = useState<string>(
    'Escribe una calle o edificio emblemático, o usa tu ubicación actual.'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null);
  const [activeRoute, setActiveRoute] = useState<ActiveRoute | null>(null);
  const [routeMode, setRouteMode] = useState<RouteMode>('foot');
  const [routeLoading, setRouteLoading] = useState<boolean>(false);
  const [layerType, setLayerType] = useState<MapLayerType>('street');
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('collapsed');
  const [locatingUser, setLocatingUser] = useState<boolean>(false);
  const [isPlacingSpot, setIsPlacingSpot] = useState<boolean>(false);
  const [pendingSpotCoords, setPendingSpotCoords] = useState<Coordinates | null>(null);

  const searchAbortRef = useRef<AbortController | null>(null);
  const enrichAbortRef = useRef<AbortController | null>(null);
  const routeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void fetchCommunitySpots().then(setCommunityRecords);
    return () => {
      searchAbortRef.current?.abort();
      enrichAbortRef.current?.abort();
      routeAbortRef.current?.abort();
    };
  }, []);

  const allMergedSpots = useMemo(() => {
    if (!origin) return [];
    return mergeSpotsWithCommunity(rawOsmSpots, communityRecords, origin, radius);
  }, [communityRecords, origin, radius, rawOsmSpots]);

  const {
    visible: visibleSpots,
    hiddenPaidCount,
    surfaceCount,
    nonSurfaceCount: exclusiveCount,
  } = useMemo(
    () => filterAndPrioritizeSpots(allMergedSpots, { includeSurface, onlyFree }),
    [allMergedSpots, includeSurface, onlyFree]
  );

  const enrichSpotStreets = useCallback(
    async (initialSpots: ParkingSpot[], signal: AbortSignal) => {
      const pending = initialSpots.filter((s) => s.street === null);
      for (let i = 0; i < pending.length; i++) {
        if (signal.aborted) return;
        const spot = pending[i];
        try {
          const streetName = await reverseGeocodeStreet(
            { lat: spot.lat, lon: spot.lon },
            signal
          );
          if (signal.aborted) return;
          setRawOsmSpots((prev) =>
            prev.map((item) =>
              item.id === spot.id
                ? { ...item, street: streetName, streetLoading: false }
                : item
            )
          );
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') return;
          setRawOsmSpots((prev) =>
            prev.map((item) =>
              item.id === spot.id ? { ...item, streetLoading: false } : item
            )
          );
        }

        if (i < pending.length - 1) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 350);
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true }
            );
          });
        }
      }
    },
    []
  );

  const executeSearch = useCallback(
    async (opts?: {
      overrideOrigin?: SearchOrigin;
      overrideRadius?: RadiusOption;
      overrideAddress?: string;
    }) => {
      const targetRadius = opts?.overrideRadius ?? radius;
      const targetAddress = (opts?.overrideAddress ?? address).trim();

      if (!opts?.overrideOrigin && !targetAddress) {
        setStatus('error');
        setErrorMessage('Escribe una dirección completa o usa el botón de ubicación GPS.');
        setSheetSnap('half');
        return;
      }

      searchAbortRef.current?.abort();
      enrichAbortRef.current?.abort();
      routeAbortRef.current?.abort();

      const controller = new AbortController();
      searchAbortRef.current = controller;

      setSelectedSpotId(null);
      setActiveRoute(null);
      setRouteLoading(false);
      setErrorMessage(null);

      try {
        let resolvedOrigin = opts?.overrideOrigin ?? null;

        if (!resolvedOrigin) {
          setStatus('geocoding');
          setStatusMessage('Localizando dirección o edificio...');
          resolvedOrigin = await geocodeAddress(targetAddress, controller.signal, origin);

          if (!resolvedOrigin) {
            setStatus('error');
            setErrorMessage(
              'No encontramos esa dirección ni edificio. Añade la ciudad para afinar la búsqueda.'
            );
            setRawOsmSpots([]);
            setSheetSnap('half');
            return;
          }
        }

        setOrigin(resolvedOrigin);
        setStatus('searching_osm');
        setStatusMessage(
          `Buscando plazas de moto en ${targetRadius === 1000 ? '1 km' : `${targetRadius} m`}...`
        );

        const [rawElements, latestCommunity] = await Promise.all([
          fetchMotorcycleParking(
            resolvedOrigin.lat,
            resolvedOrigin.lon,
            targetRadius,
            controller.signal
          ),
          fetchCommunitySpots(),
        ]);

        setCommunityRecords(latestCommunity);

        const processedOsm = processOverpassElements(rawElements, resolvedOrigin);
        setRawOsmSpots(processedOsm);

        const combined = mergeSpotsWithCommunity(
          processedOsm,
          latestCommunity,
          resolvedOrigin,
          targetRadius
        );
        const freeCandidates = onlyFree
          ? combined.filter((s) => s.freeStatus !== 'paid')
          : combined;
        const nonSurfaceCount = freeCandidates.filter((s) => s.category !== 'surface').length;
        const surfCount = freeCandidates.filter((s) => s.category === 'surface').length;

        // Smart Barrio Fallback: if 0 dedicated free moto bays exist, automatically enable surface parkings
        if (nonSurfaceCount === 0 && surfCount > 0) {
          setIncludeSurface(true);
        } else if (nonSurfaceCount > 0) {
          setIncludeSurface(false);
        }

        if (combined.length === 0) {
          setStatus('empty');
          setStatusMessage('Sin plazas encontradas en este radio.');
          setSheetSnap('half');
          return;
        }

        setStatus('success');
        setStatusMessage(`${combined.length} resultados encontrados.`);
        setSheetSnap('half');

        const enrichController = new AbortController();
        enrichAbortRef.current = enrichController;
        void enrichSpotStreets(processedOsm, enrichController.signal);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          return;
        }
        setStatus('error');
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Ha ocurrido un error al consultar el mapa.'
        );
        setSheetSnap('half');
      }
    },
    [address, enrichSpotStreets, onlyFree, origin, radius]
  );

  const handleSelectSuggestion = useCallback(
    (suggestion: PlaceSuggestion) => {
      setAddress(suggestion.label);
      void executeSearch({
        overrideOrigin: {
          lat: suggestion.lat,
          lon: suggestion.lon,
          label: suggestion.label,
          source: 'address',
        },
        overrideAddress: suggestion.label,
      });
    },
    [executeSearch]
  );

  const handleRadiusChange = useCallback(
    (nextRadius: RadiusOption) => {
      setRadius(nextRadius);
      if (origin) {
        void executeSearch({ overrideOrigin: origin, overrideRadius: nextRadius });
      }
    },
    [executeSearch, origin]
  );

  const handleUseCurrentLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('error');
      setErrorMessage('Tu navegador no admite geolocalización.');
      setSheetSnap('half');
      return;
    }

    setLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        };
        let label = 'Tu ubicación actual';
        try {
          const street = await reverseGeocodeStreet(coords);
          if (street) {
            label = street;
            setAddress(street);
          }
        } catch {
          // Keep generic label
        } finally {
          setLocatingUser(false);
        }

        void executeSearch({
          overrideOrigin: { ...coords, label, source: 'geolocation' },
        });
      },
      (geoErr) => {
        setLocatingUser(false);
        setStatus('error');
        setErrorMessage(
          geoErr.code === geoErr.PERMISSION_DENIED
            ? 'Permiso de ubicación denegado. Puedes escribir tu dirección manualmente.'
            : 'No se pudo obtener tu posición GPS en este momento.'
        );
        setSheetSnap('half');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }, [executeSearch]);

  const handleSelectSpot = useCallback((spot: ParkingSpot) => {
    setSelectedSpotId(spot.id);
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setSheetSnap('collapsed');
    }
  }, []);

  const loadStreetRoute = useCallback(
    async (spot: ParkingSpot, mode: RouteMode) => {
      if (!origin) return;

      routeAbortRef.current?.abort();
      const controller = new AbortController();
      routeAbortRef.current = controller;

      setSelectedSpotId(spot.id);
      setRouteLoading(true);

      if (typeof window !== 'undefined' && window.innerWidth < 1024) {
        setSheetSnap('collapsed');
      }

      try {
        const routeData = await fetchStreetRoute(
          origin,
          { lat: spot.lat, lon: spot.lon },
          mode,
          controller.signal
        );
        if (controller.signal.aborted) return;
        setActiveRoute({
          spotId: spot.id,
          ...routeData,
        });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      } finally {
        if (!controller.signal.aborted) {
          setRouteLoading(false);
        }
      }
    },
    [origin]
  );

  const handleToggleRoute = useCallback(
    (spot: ParkingSpot) => {
      if (activeRoute?.spotId === spot.id) {
        routeAbortRef.current?.abort();
        setActiveRoute(null);
        setRouteLoading(false);
        return;
      }
      void loadStreetRoute(spot, routeMode);
    },
    [activeRoute?.spotId, loadStreetRoute, routeMode]
  );

  const handleRouteModeChange = useCallback(
    (nextMode: RouteMode) => {
      setRouteMode(nextMode);
      if (activeRoute) {
        const spot = visibleSpots.find((s) => s.id === activeRoute.spotId);
        if (spot) {
          void loadStreetRoute(spot, nextMode);
        }
      }
    },
    [activeRoute, loadStreetRoute, visibleSpots]
  );

  const handleClearRoute = useCallback(() => {
    routeAbortRef.current?.abort();
    setActiveRoute(null);
    setRouteLoading(false);
  }, []);

  const handleStartAddSpot = useCallback(() => {
    setIsPlacingSpot(true);
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setSheetSnap('collapsed');
    }
  }, []);

  const handleMapClickPlaceSpot = useCallback((coords: Coordinates) => {
    setIsPlacingSpot(false);
    setPendingSpotCoords(coords);
  }, []);

  const handleSaveCommunitySpot = useCallback(
    async (input: {
      lat: number;
      lon: number;
      name: string;
      street: string;
      capacity?: string;
      covered?: boolean;
    }) => {
      const saved = await saveCommunitySpot(input);
      setCommunityRecords((prev) => [saved, ...prev]);
      setPendingSpotCoords(null);
      if (!origin) {
        setOrigin({
          lat: saved.lat,
          lon: saved.lon,
          label: saved.street,
          source: 'address',
        });
      }
      setStatus('success');
      setSelectedSpotId(`community-${saved.id}`);
      if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
        // Keep desktop sidebar visible
      } else {
        setSheetSnap('half');
      }
    },
    [origin]
  );

  const handleDeleteCommunitySpot = useCallback(
    async (spot: ParkingSpot) => {
      const recordId = spot.id.replace(/^community-/, '');
      await deleteCommunitySpot(recordId);
      setCommunityRecords((prev) => prev.filter((r) => r.id !== recordId));
      if (activeRoute?.spotId === spot.id) {
        setActiveRoute(null);
      }
      if (selectedSpotId === spot.id) {
        setSelectedSpotId(null);
      }
    },
    [activeRoute?.spotId, selectedSpotId]
  );

  const routeSpotId = activeRoute?.spotId ?? null;

  return (
    <div className="h-[100dvh] w-full flex flex-col overflow-hidden bg-slate-50 text-slate-900">
      {/* Compact Mobile Header (shown < 1024px) */}
      <div className="lg:hidden shrink-0">
        <SearchControls
          compact
          address={address}
          onAddressChange={setAddress}
          biasCoords={origin}
          onSelectSuggestion={handleSelectSuggestion}
          radius={radius}
          onRadiusChange={handleRadiusChange}
          onSearch={() => void executeSearch()}
          onUseCurrentLocation={handleUseCurrentLocation}
          status={status}
          locatingUser={locatingUser}
        />
      </div>

      {/* Main Workspace */}
      <main className="flex-1 min-h-0 flex relative">
        {/* Desktop Sidebar (shown >= 1024px) */}
        <aside
          aria-label="Buscador y resultados"
          className="hidden lg:flex lg:w-[400px] xl:w-[420px] shrink-0 h-full flex-col bg-white border-r border-slate-200 z-10"
        >
          <SearchControls
            address={address}
            onAddressChange={setAddress}
            biasCoords={origin}
            onSelectSuggestion={handleSelectSuggestion}
            radius={radius}
            onRadiusChange={handleRadiusChange}
            onSearch={() => void executeSearch()}
            onUseCurrentLocation={handleUseCurrentLocation}
            status={status}
            locatingUser={locatingUser}
          />
          <div className="flex-1 overflow-y-auto">
            <ParkingList
              spots={visibleSpots}
              surfaceCount={surfaceCount}
              exclusiveCount={exclusiveCount}
              hiddenPaidCount={hiddenPaidCount}
              onlyFree={onlyFree}
              onToggleOnlyFree={() => setOnlyFree((prev) => !prev)}
              includeSurface={includeSurface}
              onToggleIncludeSurface={() => setIncludeSurface((prev) => !prev)}
              status={status}
              statusMessage={statusMessage}
              errorMessage={errorMessage}
              origin={origin}
              radius={radius}
              selectedSpotId={selectedSpotId}
              routeSpotId={routeSpotId}
              onSelectSpot={handleSelectSpot}
              onToggleRoute={handleToggleRoute}
              onExpandRadius={(next) => handleRadiusChange(next)}
              onUseCurrentLocation={handleUseCurrentLocation}
              locatingUser={locatingUser}
              onStartAddSpot={handleStartAddSpot}
              onDeleteCommunitySpot={(spot) => void handleDeleteCommunitySpot(spot)}
              onRetry={() => void executeSearch()}
            />
          </div>
        </aside>

        {/* Map Canvas + Mobile Bottom Sheet */}
        <div className="flex-1 relative h-full min-w-0">
          <MapView
            origin={origin}
            radius={radius}
            spots={visibleSpots}
            selectedSpotId={selectedSpotId}
            activeRoute={activeRoute}
            routeLoading={routeLoading}
            routeMode={routeMode}
            layerType={layerType}
            isPlacingSpot={isPlacingSpot}
            onLayerTypeChange={setLayerType}
            onRouteModeChange={handleRouteModeChange}
            onSelectSpot={handleSelectSpot}
            onToggleRoute={handleToggleRoute}
            onClearRoute={handleClearRoute}
            onMapClickPlaceSpot={handleMapClickPlaceSpot}
            onCancelPlaceSpot={() => setIsPlacingSpot(false)}
          />

          <MobileBottomSheet
            snap={sheetSnap}
            onSnapChange={setSheetSnap}
            spots={visibleSpots}
            status={status}
            activeRoute={activeRoute}
            routeLoading={routeLoading}
            routeMode={routeMode}
            onRouteModeChange={handleRouteModeChange}
            onClearRoute={handleClearRoute}
          >
            <ParkingList
              spots={visibleSpots}
              surfaceCount={surfaceCount}
              exclusiveCount={exclusiveCount}
              hiddenPaidCount={hiddenPaidCount}
              onlyFree={onlyFree}
              onToggleOnlyFree={() => setOnlyFree((prev) => !prev)}
              includeSurface={includeSurface}
              onToggleIncludeSurface={() => setIncludeSurface((prev) => !prev)}
              status={status}
              statusMessage={statusMessage}
              errorMessage={errorMessage}
              origin={origin}
              radius={radius}
              selectedSpotId={selectedSpotId}
              routeSpotId={routeSpotId}
              onSelectSpot={handleSelectSpot}
              onToggleRoute={handleToggleRoute}
              onExpandRadius={(next) => handleRadiusChange(next)}
              onUseCurrentLocation={handleUseCurrentLocation}
              locatingUser={locatingUser}
              onStartAddSpot={handleStartAddSpot}
              onDeleteCommunitySpot={(spot) => void handleDeleteCommunitySpot(spot)}
              onRetry={() => void executeSearch()}
            />
          </MobileBottomSheet>
        </div>
      </main>

      <AddSpotModal
        coords={pendingSpotCoords}
        onClose={() => setPendingSpotCoords(null)}
        onSave={handleSaveCommunitySpot}
      />
    </div>
  );
}
