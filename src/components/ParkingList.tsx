import React from 'react';
import {
  AlertCircle,
  ExternalLink,
  Eye,
  MapPin,
  Navigation,
  Plus,
  Route,
  Trash2,
} from 'lucide-react';
import type { ParkingSpot, RadiusOption, SearchOrigin, SearchStatus } from '../types/parking';
import {
  buildGoogleMapsUrl,
  buildOsmNoteUrl,
  buildStreetViewUrl,
  formatDistance,
  formatMetadataSummary,
  getCategoryLabel,
} from '../utils/geo';

interface ParkingListProps {
  spots: ParkingSpot[];
  surfaceCount: number;
  exclusiveCount: number;
  hiddenPaidCount: number;
  onlyFree: boolean;
  onToggleOnlyFree: () => void;
  includeSurface: boolean;
  onToggleIncludeSurface: () => void;
  status: SearchStatus;
  statusMessage: string;
  errorMessage: string | null;
  origin: SearchOrigin | null;
  radius: RadiusOption;
  selectedSpotId: string | null;
  routeSpotId: string | null;
  onSelectSpot: (spot: ParkingSpot) => void;
  onToggleRoute: (spot: ParkingSpot) => void;
  onExpandRadius: (nextRadius: RadiusOption) => void;
  onQuickSearchDefault: () => void;
  onStartAddSpot: () => void;
  onDeleteCommunitySpot: (spot: ParkingSpot) => void;
  onRetry?: () => void;
}

export const ParkingList: React.FC<ParkingListProps> = ({
  spots,
  surfaceCount,
  exclusiveCount,
  hiddenPaidCount,
  onlyFree,
  onToggleOnlyFree,
  includeSurface,
  onToggleIncludeSurface,
  status,
  statusMessage,
  errorMessage,
  origin,
  radius,
  selectedSpotId,
  routeSpotId,
  onSelectSpot,
  onToggleRoute,
  onExpandRadius,
  onQuickSearchDefault,
  onStartAddSpot,
  onDeleteCommunitySpot,
  onRetry,
}) => {
  const isLoading = status === 'geocoding' || status === 'searching_osm';

  if (isLoading) {
    return (
      <div className="p-4 space-y-3" aria-busy="true" aria-live="polite">
        <div className="flex items-center justify-between text-xs font-medium text-slate-600 pb-1">
          <span>{statusMessage}</span>
        </div>
        {[1, 2, 3, 4].map((n) => (
          <div
            key={n}
            className="p-3.5 rounded-xl border border-slate-200 bg-white animate-pulse space-y-2.5"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="h-4 bg-slate-200 rounded w-3/5" />
              <div className="h-4 bg-slate-200 rounded w-14" />
            </div>
            <div className="h-3.5 bg-slate-100 rounded w-4/5" />
            <div className="flex gap-2 pt-1">
              <div className="h-9 bg-slate-100 rounded-lg flex-1" />
              <div className="h-9 bg-slate-100 rounded-lg flex-1" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="p-5">
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-900 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold">No se pudo completar la búsqueda</p>
              <p className="text-xs text-red-700 leading-relaxed">
                {errorMessage || 'Comprueba la dirección escrita o inténtalo de nuevo.'}
              </p>
            </div>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="w-full min-h-[40px] px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              Reintentar búsqueda
            </button>
          )}
        </div>
      </div>
    );
  }

  if (status === 'idle') {
    return (
      <div className="p-5 space-y-4">
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5">
          <div className="flex items-center gap-2 text-slate-900">
            <MapPin className="w-4 h-4 text-orange-600 shrink-0" />
            <h2 className="text-sm font-semibold">Aparca gratis donde vayas</h2>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Busca cualquier dirección o usa tu GPS para localizar plazas de moto gratuitas,
            inspeccionar la calle real con Street View u Ortofoto IGN PNOA y trazar la ruta.
          </p>
          <button
            type="button"
            onClick={onQuickSearchDefault}
            className="w-full min-h-[44px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Buscar en la dirección actual
          </button>
        </div>
      </div>
    );
  }

  if (status === 'empty' || spots.length === 0) {
    const nextRadius: RadiusOption | null =
      radius === 300 ? 500 : radius === 500 ? 1000 : null;

    return (
      <div className="p-5 space-y-3">
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
          <p className="text-sm font-semibold text-slate-900">
            {onlyFree && hiddenPaidCount > 0
              ? `Sin plazas gratuitas en ${radius === 1000 ? '1 km' : `${radius} m`}`
              : `Sin plazas registradas en ${radius === 1000 ? '1 km' : `${radius} m`}`}
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">
            {onlyFree && hiddenPaidCount > 0
              ? `Hay ${hiddenPaidCount} ${hiddenPaidCount === 1 ? 'parking de pago oculto' : 'parkings de pago ocultos'} por el filtro gratuito.`
              : `En muchos barrios los mapas abiertos aún no tienen etiquetadas todas las reservas de moto${origin ? ` cerca de ${origin.label}` : ''}. Puedes ampliar el radio o añadir una plaza que conozcas.`}
          </p>
          <div className="flex flex-col gap-2">
            {onlyFree && hiddenPaidCount > 0 && (
              <button
                type="button"
                onClick={onToggleOnlyFree}
                className="w-full min-h-[44px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Mostrar también de pago ({hiddenPaidCount})
              </button>
            )}
            {nextRadius && (
              <button
                type="button"
                onClick={() => onExpandRadius(nextRadius)}
                className="w-full min-h-[44px] px-4 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Ampliar búsqueda a {nextRadius === 1000 ? '1 km' : `${nextRadius} m`}
              </button>
            )}
            <button
              type="button"
              onClick={onStartAddSpot}
              className="w-full min-h-[44px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Añadir plaza que falta en este barrio</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-200/80">
      {/* Summary + Free Priority / Surface Filters & Add Spot Bar */}
      <div className="px-4 py-2.5 bg-slate-50/90 space-y-2">
        <div className="hidden lg:flex items-center justify-between gap-2 text-xs text-slate-600">
          <span className="font-medium truncate">
            {spots.length} {spots.length === 1 ? 'resultado' : 'resultados'} cerca
            {origin ? ` de ${origin.label}` : ''}
          </span>
          <span className="font-mono-tabular text-slate-500 shrink-0">
            {radius === 1000 ? '1 km' : `${radius} m`}
          </span>
        </div>

        {exclusiveCount === 0 && surfaceCount > 0 && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200/80 rounded-lg px-2.5 py-1.5 leading-snug">
            Sin reservas exclusivas de moto en este radio; mostrando aparcamientos públicos en superficie.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleOnlyFree}
              aria-pressed={onlyFree}
              className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer border ${
                onlyFree
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {onlyFree
                ? hiddenPaidCount > 0
                  ? `Solo gratis (${hiddenPaidCount} pago ocultos)`
                  : 'Solo gratis'
                : 'Gratis y pago'}
            </button>

            {surfaceCount > 0 && (
              <button
                type="button"
                onClick={onToggleIncludeSurface}
                aria-pressed={includeSurface}
                className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer border ${
                  includeSurface
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {includeSurface ? `Superficie (${surfaceCount})` : `+ Superficie (${surfaceCount})`}
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onStartAddSpot}
            className="min-h-[34px] px-2.5 rounded-lg text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Añadir plaza</span>
          </button>
        </div>
      </div>

      <ul className="divide-y divide-slate-200/70" aria-label="Resultados de aparcamientos">
        {spots.map((spot, idx) => {
          const isSelected = spot.id === selectedSpotId;
          const isRouteActive = spot.id === routeSpotId;
          const metaParts = [
            getCategoryLabel(spot.category),
            ...formatMetadataSummary(spot.metadata, spot.freeStatus),
          ];

          const badgeColor =
            isSelected || isRouteActive
              ? 'bg-orange-600 text-white'
              : spot.category === 'community'
              ? 'bg-indigo-600 text-white'
              : spot.category === 'surface'
              ? 'bg-slate-600 text-white'
              : 'bg-teal-700 text-white';

          return (
            <li
              key={spot.id}
              className={`p-4 transition-colors ${
                isSelected ? 'bg-orange-50/70' : 'bg-white hover:bg-slate-50/80'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectSpot(spot)}
                className="w-full text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 rounded-lg"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-6 h-6 rounded-full text-xs font-bold font-mono-tabular flex items-center justify-center shrink-0 ${badgeColor}`}
                    >
                      {idx + 1}
                    </span>
                    <span className="text-sm font-semibold text-slate-900 truncate">
                      {spot.name}
                    </span>
                  </div>

                  <div className="text-right shrink-0 whitespace-nowrap">
                    <span className="font-mono-tabular text-sm font-semibold text-slate-900">
                      {formatDistance(spot.distance)}
                    </span>
                    <span className="text-xs text-slate-500 ml-1.5">
                      · {spot.walkMinutes} min
                    </span>
                  </div>
                </div>

                <div className="mt-1.5 pl-8.5 space-y-1">
                  <p className="text-xs font-medium text-slate-700 truncate">
                    {spot.street
                      ? spot.street
                      : spot.streetLoading
                      ? 'Identificando calle...'
                      : `${spot.lat.toFixed(5)}, ${spot.lon.toFixed(5)}`}
                  </p>

                  <p className="text-xs text-slate-500 truncate">
                    <span
                      className={`font-semibold ${
                        spot.freeStatus === 'free'
                          ? 'text-emerald-700'
                          : spot.freeStatus === 'paid'
                          ? 'text-amber-700'
                          : 'text-slate-600'
                      }`}
                    >
                      {metaParts[1]}
                    </span>
                    <span> · {metaParts[0]}</span>
                    {metaParts.length > 2 && <span> · {metaParts.slice(2).join(' · ')}</span>}
                  </p>
                </div>
              </button>

              <div className="mt-3 pl-8.5 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onToggleRoute(spot)}
                  aria-pressed={isRouteActive}
                  className={`flex-1 min-h-[40px] px-2.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap cursor-pointer ${
                    isRouteActive
                      ? 'bg-orange-600 text-white hover:bg-orange-700'
                      : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                  }`}
                >
                  <Route className="w-3.5 h-3.5 shrink-0" />
                  <span>{isRouteActive ? 'Ocultar' : 'Ver ruta'}</span>
                </button>

                <a
                  href={buildStreetViewUrl(spot.lat, spot.lon)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Ver calle en Street View de ${spot.name}`}
                  className="flex-1 min-h-[40px] px-2.5 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-800 hover:bg-indigo-100 inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap"
                >
                  <Eye className="w-3.5 h-3.5 shrink-0" />
                  <span>Street View</span>
                </a>

                <a
                  href={buildGoogleMapsUrl(spot.lat, spot.lon)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Abrir en Google Maps ${spot.name}`}
                  className="min-h-[40px] px-2.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0"
                >
                  <Navigation className="w-3.5 h-3.5 shrink-0" />
                  <span>Maps</span>
                  <ExternalLink className="w-3 h-3 opacity-70 hidden sm:inline" />
                </a>

                {spot.category === 'community' && (
                  <button
                    type="button"
                    onClick={() => onDeleteCommunitySpot(spot)}
                    aria-label={`Eliminar ${spot.name}`}
                    title="Eliminar aportación"
                    className="min-w-[40px] min-h-[40px] rounded-lg bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-600 inline-flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {spot.category === 'community' && (
                <div className="mt-2 pl-8.5">
                  <a
                    href={buildOsmNoteUrl(spot.lat, spot.lon)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 hover:underline"
                  >
                    <span>Proponer en OpenStreetMap</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
