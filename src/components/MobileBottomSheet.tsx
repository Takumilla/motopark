import React, { useRef } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type {
  ActiveRoute,
  ParkingSpot,
  RouteMode,
  SearchStatus,
  SheetSnap,
} from '../types/parking';
import { formatDistance, formatDurationMinutes } from '../utils/geo';

interface MobileBottomSheetProps {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  spots: ParkingSpot[];
  status: SearchStatus;
  activeRoute: ActiveRoute | null;
  routeLoading: boolean;
  routeMode: RouteMode;
  onRouteModeChange: (mode: RouteMode) => void;
  onClearRoute: () => void;
  children: React.ReactNode;
}

const SNAP_HEIGHT_CLASS: Record<SheetSnap, string> = {
  collapsed: 'min-h-[76px] max-h-[126px]',
  half: 'h-[48%]',
  expanded: 'h-[78%]',
};

export const MobileBottomSheet: React.FC<MobileBottomSheetProps> = ({
  snap,
  onSnapChange,
  spots,
  status,
  activeRoute,
  routeLoading,
  routeMode,
  onRouteModeChange,
  onClearRoute,
  children,
}) => {
  const touchStartYRef = useRef<number | null>(null);

  const cycleSnap = () => {
    if (snap === 'collapsed') onSnapChange('half');
    else if (snap === 'half') onSnapChange('expanded');
    else onSnapChange('collapsed');
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartYRef.current === null) return;
    const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
    touchStartYRef.current = null;

    if (deltaY < -36) {
      if (snap === 'collapsed') onSnapChange('half');
      else if (snap === 'half') onSnapChange('expanded');
    } else if (deltaY > 36) {
      if (snap === 'expanded') onSnapChange('half');
      else if (snap === 'half') onSnapChange('collapsed');
    }
  };

  const getHeaderSummary = () => {
    if (status === 'geocoding' || status === 'searching_osm') {
      return 'Buscando aparcamientos...';
    }
    if (status === 'error') {
      return 'Error en la búsqueda';
    }
    if (status === 'empty') {
      return 'Sin aparcamientos en este radio';
    }
    if (spots.length > 0) {
      const nearest = spots[0];
      return `${spots.length} ${spots.length === 1 ? 'plaza' : 'plazas'} · Más cercana a ${formatDistance(nearest.distance)}`;
    }
    return 'Listo para buscar';
  };

  return (
    <section
      aria-label="Resultados de aparcamientos"
      data-testid="mobile-bottom-sheet"
      data-snap={snap}
      className={`lg:hidden absolute bottom-0 left-0 right-0 z-[900] bg-white rounded-t-3xl border-t border-slate-200 shadow-[0_-8px_30px_rgba(15,23,42,0.14)] flex flex-col transition-[height] duration-200 ease-out ${SNAP_HEIGHT_CLASS[snap]}`}
    >
      {/* Drag Handle & Summary Header */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="shrink-0 px-4 pt-2 pb-2.5 border-b border-slate-100 select-none"
      >
        <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-2" aria-hidden="true" />

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={cycleSnap}
            aria-expanded={snap !== 'collapsed'}
            className="flex-1 min-w-0 min-h-[40px] flex items-center justify-between gap-2 text-left cursor-pointer"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">
                {getHeaderSummary()}
              </p>
              {routeLoading && (
                <p className="text-xs text-slate-500 font-medium truncate">
                  Calculando ruta por calles...
                </p>
              )}
              {!routeLoading && activeRoute && (
                <p className="text-xs text-orange-600 font-semibold font-mono-tabular truncate">
                  {activeRoute.isFallbackStraightLine ? 'Directa: ' : 'Ruta real: '}
                  {formatDistance(activeRoute.distanceMeters)} ·{' '}
                  {formatDurationMinutes(activeRoute.durationSeconds)} min
                </p>
              )}
            </div>

            <span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
              {snap === 'expanded' ? (
                <ChevronDown className="w-5 h-5" />
              ) : (
                <ChevronUp className="w-5 h-5" />
              )}
            </span>
          </button>

          {(activeRoute || routeLoading) && (
            <button
              type="button"
              onClick={onClearRoute}
              aria-label="Ocultar ruta trazada"
              className="min-w-[40px] min-h-[40px] rounded-xl bg-orange-50 text-orange-700 flex items-center justify-center shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Route Mode Switcher (only shown when a route is active) */}
        {activeRoute && !routeLoading && (
          <div
            role="group"
            aria-label="Modo de ruta"
            className="mt-2 grid grid-cols-2 gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200/80"
          >
            <button
              type="button"
              onClick={() => onRouteModeChange('foot')}
              aria-pressed={routeMode === 'foot'}
              className={`min-h-[32px] rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                routeMode === 'foot'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              A pie (peatonal)
            </button>
            <button
              type="button"
              onClick={() => onRouteModeChange('moto')}
              aria-pressed={routeMode === 'moto'}
              className={`min-h-[32px] rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                routeMode === 'moto'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              En moto (calzada)
            </button>
          </div>
        )}
      </div>

      {/* Scrollable Results Content (hidden when collapsed so sheet stays compact) */}
      {snap !== 'collapsed' && (
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      )}
    </section>
  );
};
