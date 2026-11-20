import React, { useEffect, useState } from 'react';
import { ExternalLink, MapPin, X } from 'lucide-react';
import type { Coordinates } from '../types/parking';
import { reverseGeocodeStreet } from '../services/osmApi';
import { buildOsmNoteUrl } from '../utils/geo';

interface AddSpotModalProps {
  coords: Coordinates | null;
  onClose: () => void;
  onSave: (input: {
    lat: number;
    lon: number;
    name: string;
    street: string;
    capacity?: string;
    covered?: boolean;
  }) => Promise<void>;
}

export const AddSpotModal: React.FC<AddSpotModalProps> = ({
  coords,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [street, setStreet] = useState('');
  const [capacity, setCapacity] = useState('');
  const [covered, setCovered] = useState(false);
  const [loadingStreet, setLoadingStreet] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!coords) return;
    let active = true;
    setLoadingStreet(true);
    setStreet('');
    setName('');
    setCapacity('');
    setCovered(false);

    reverseGeocodeStreet(coords)
      .then((resolved) => {
        if (active) setStreet(resolved);
      })
      .catch(() => {
        if (active) setStreet(`${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`);
      })
      .finally(() => {
        if (active) setLoadingStreet(false);
      });

    return () => {
      active = false;
    };
  }, [coords]);

  if (!coords) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        lat: coords.lat,
        lon: coords.lon,
        name: name.trim() || 'Plaza de moto (vecinal)',
        street: street.trim() || `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`,
        capacity: capacity.trim() || undefined,
        covered,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1200] bg-slate-950/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-spot-title"
    >
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <MapPin className="w-5 h-5 text-indigo-600 shrink-0" />
            <h2 id="add-spot-title" className="text-base font-bold text-slate-900 truncate">
              Añadir aparcamiento de moto
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar formulario"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="spot-street" className="block text-xs font-semibold text-slate-700">
              Calle o referencia detectada
            </label>
            <input
              id="spot-street"
              type="text"
              value={loadingStreet ? 'Obteniendo calle...' : street}
              onChange={(e) => setStreet(e.target.value)}
              required
              className="w-full h-11 px-3 rounded-xl border border-slate-300 bg-slate-50 text-sm text-slate-900 focus:outline-none focus:bg-white focus:border-indigo-600"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="spot-name" className="block text-xs font-semibold text-slate-700">
              Descripción breve (opcional)
            </label>
            <input
              id="spot-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Batería de motos frente al portal 14"
              maxLength={80}
              className="w-full h-11 px-3 rounded-xl border border-slate-300 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <label htmlFor="spot-capacity" className="block text-xs font-semibold text-slate-700">
                Plazas aprox.
              </label>
              <input
                id="spot-capacity"
                type="number"
                min={1}
                max={200}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="Ej: 6"
                className="w-full h-11 px-3 rounded-xl border border-slate-300 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600"
              />
            </div>

            <label className="h-11 px-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center gap-2.5 text-sm font-medium text-slate-800 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={covered}
                onChange={(e) => setCovered(e.target.checked)}
                className="w-4 h-4 accent-indigo-600 rounded"
              />
              <span>Cubierto</span>
            </label>
          </div>

          <div className="pt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
            <span>Se guarda en MotoPark para futuras búsquedas.</span>
            <a
              href={buildOsmNoteUrl(coords.lat, coords.lon)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline whitespace-nowrap shrink-0"
            >
              <span>Avisar a OSM</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="flex items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[44px] px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-semibold transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || loadingStreet}
              className="flex-1 min-h-[44px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              {saving ? 'Guardando...' : 'Guardar plaza'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
