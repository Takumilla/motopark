import React, { useEffect, useRef, useState } from 'react';
import { Building2, LocateFixed, MapPin, Search, X } from 'lucide-react';
import type {
  Coordinates,
  PlaceSuggestion,
  RadiusOption,
  SearchStatus,
} from '../types/parking';
import { suggestPlaces } from '../services/osmApi';

interface SearchControlsProps {
  address: string;
  onAddressChange: (value: string) => void;
  biasCoords?: Coordinates | null;
  onSelectSuggestion: (suggestion: PlaceSuggestion) => void;
  radius: RadiusOption;
  onRadiusChange: (radius: RadiusOption) => void;
  onSearch: () => void;
  onUseCurrentLocation: () => void;
  status: SearchStatus;
  locatingUser: boolean;
  compact?: boolean;
}

const RADIUS_OPTIONS: Array<{ value: RadiusOption; label: string }> = [
  { value: 300, label: '300 m' },
  { value: 500, label: '500 m' },
  { value: 1000, label: '1 km' },
];

export const SearchControls: React.FC<SearchControlsProps> = ({
  address,
  onAddressChange,
  biasCoords,
  onSelectSuggestion,
  radius,
  onRadiusChange,
  onSearch,
  onUseCurrentLocation,
  status,
  locatingUser,
  compact = false,
}) => {
  const isSearching = status === 'geocoding' || status === 'searching_osm';
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [openDropdown, setOpenDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const userTypedRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpenDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    if (!userTypedRef.current) return;

    const trimmed = address.trim();
    if (trimmed.length < 3) {
      abortRef.current?.abort();
      setSuggestions([]);
      setOpenDropdown(false);
      return;
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      void suggestPlaces(trimmed, biasCoords, controller.signal)
        .then((items) => {
          if (controller.signal.aborted || !userTypedRef.current) return;
          setSuggestions(items);
          setActiveIndex(-1);
          setOpenDropdown(items.length > 0);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSuggestions([]);
            setOpenDropdown(false);
          }
        });
    }, 260);

    return () => {
      clearTimeout(timer);
    };
  }, [address, biasCoords]);

  const handleInputChange = (val: string) => {
    userTypedRef.current = true;
    onAddressChange(val);
  };

  const handlePickSuggestion = (item: PlaceSuggestion) => {
    userTypedRef.current = false;
    abortRef.current?.abort();
    setOpenDropdown(false);
    setSuggestions([]);
    setActiveIndex(-1);
    onSelectSuggestion(item);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!openDropdown || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === 'Escape') {
      setOpenDropdown(false);
    } else if (e.key === 'Enter' && activeIndex >= 0 && suggestions[activeIndex]) {
      e.preventDefault();
      handlePickSuggestion(suggestions[activeIndex]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    userTypedRef.current = false;
    abortRef.current?.abort();
    setOpenDropdown(false);
    setSuggestions([]);
    onSearch();
  };

  const listboxId = compact ? 'mobile-place-suggestions' : 'desktop-place-suggestions';

  const renderSuggestionsDropdown = () => {
    if (!openDropdown || suggestions.length === 0) return null;

    return (
      <div
        id={listboxId}
        role="listbox"
        aria-label="Sugerencias de calles y edificios"
        className="absolute left-0 right-0 top-full mt-1.5 z-[1100] bg-white rounded-xl border border-slate-200 shadow-xl max-h-64 overflow-y-auto divide-y divide-slate-100"
      >
        {suggestions.map((item, idx) => {
          const isActive = idx === activeIndex;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={isActive}
              onClick={() => handlePickSuggestion(item)}
              className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors cursor-pointer ${
                isActive ? 'bg-orange-50' : 'hover:bg-slate-50'
              }`}
            >
              <span
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                  item.kind === 'landmark'
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {item.kind === 'landmark' ? (
                  <Building2 className="w-4 h-4" />
                ) : (
                  <MapPin className="w-4 h-4" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900 truncate">
                    {item.label}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                      item.kind === 'landmark'
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {item.categoryLabel}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">{item.subtitle}</p>
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  if (compact) {
    return (
      <header className="shrink-0 bg-white border-b border-slate-200 px-3 pt-2.5 pb-2.5 z-[950] relative">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            MotoPark
          </span>

          <div
            role="group"
            aria-label="Radio de búsqueda"
            className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80 shrink-0"
          >
            {RADIUS_OPTIONS.map((opt) => {
              const active = radius === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onRadiusChange(opt.value)}
                  aria-pressed={active}
                  className={`min-h-[34px] px-2.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onUseCurrentLocation}
            disabled={locatingUser || isSearching}
            aria-label="Usar mi ubicación actual"
            title="Usar mi ubicación actual"
            className="min-w-[44px] min-h-[44px] -my-1 flex items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-50 transition-colors shrink-0 cursor-pointer"
          >
            <LocateFixed className={`w-5 h-5 ${locatingUser ? 'animate-spin text-orange-600' : ''}`} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <div ref={wrapperRef} className="relative flex-1 min-w-0">
            <label htmlFor="mobile-address-input" className="sr-only">
              Dirección o edificio emblemático
            </label>
            <input
              id="mobile-address-input"
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={openDropdown}
              aria-controls={listboxId}
              value={address}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                if (suggestions.length > 0 && userTypedRef.current) {
                  setOpenDropdown(true);
                }
              }}
              placeholder="Dirección o edificio..."
              className="w-full h-11 pl-3 pr-9 rounded-xl border border-slate-300 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-orange-600 focus:ring-2 focus:ring-orange-600/15 transition-colors"
            />
            {address.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  userTypedRef.current = true;
                  onAddressChange('');
                  setSuggestions([]);
                  setOpenDropdown(false);
                }}
                aria-label="Borrar dirección"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            {renderSuggestionsDropdown()}
          </div>

          <button
            type="submit"
            disabled={isSearching}
            className="h-11 px-4 rounded-xl bg-orange-600 hover:bg-orange-700 active:scale-[0.98] disabled:bg-slate-400 text-white text-sm font-semibold flex items-center justify-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
          >
            <Search className="w-4 h-4" />
            <span>{isSearching ? 'Buscando' : 'Buscar'}</span>
          </button>
        </form>
      </header>
    );
  }

  return (
    <div className="p-5 border-b border-slate-200 bg-white shrink-0 relative z-30">
      <div className="flex items-center justify-between gap-4 mb-4">
        <span className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          MotoPark
        </span>

        <button
          type="button"
          onClick={onUseCurrentLocation}
          disabled={locatingUser || isSearching}
          className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200/80 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <LocateFixed className={`w-4 h-4 text-orange-600 ${locatingUser ? 'animate-spin' : ''}`} />
          <span>{locatingUser ? 'Localizando...' : 'Mi ubicación'}</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div ref={wrapperRef} className="relative flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <label htmlFor="desktop-address-input" className="sr-only">
              Dirección o edificio emblemático
            </label>
            <input
              id="desktop-address-input"
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={openDropdown}
              aria-controls={listboxId}
              value={address}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                if (suggestions.length > 0 && userTypedRef.current) {
                  setOpenDropdown(true);
                }
              }}
              placeholder="Dirección o edificio..."
              className="w-full h-11 pl-3.5 pr-9 rounded-xl border border-slate-300 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-orange-600 focus:ring-2 focus:ring-orange-600/15 transition-colors"
            />
            {address.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  userTypedRef.current = true;
                  onAddressChange('');
                  setSuggestions([]);
                  setOpenDropdown(false);
                }}
                aria-label="Borrar dirección"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={isSearching}
            className="h-11 px-4 rounded-xl bg-orange-600 hover:bg-orange-700 active:scale-[0.98] disabled:bg-slate-400 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
          >
            <Search className="w-4 h-4" />
            <span>{isSearching ? 'Buscando...' : 'Buscar'}</span>
          </button>

          {renderSuggestionsDropdown()}
        </div>

        <div
          role="group"
          aria-label="Radio de búsqueda"
          className="grid grid-cols-3 bg-slate-100 p-1 rounded-xl border border-slate-200/80"
        >
          {RADIUS_OPTIONS.map((opt) => {
            const active = radius === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onRadiusChange(opt.value)}
                aria-pressed={active}
                className={`h-9 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200/60'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </form>
    </div>
  );
};
