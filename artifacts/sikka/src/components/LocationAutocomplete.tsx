import { useState, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Search, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Language } from '@/lib/i18n';

export interface Suggestion {
  id: string;
  place_name: string;
  center: [number, number];
  text: string;
}

interface LocationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: Suggestion) => void;
  placeholder?: string;
  className?: string;
  trailingAction?: 'clear' | 'cancelTrip';
  onTrailingAction?: () => void;
  trailingLabel?: string;
  readOnlyDisplay?: string;
  language?: Language;
}

const langForSearch = (language?: Language) => {
  if (!language) return 'en';
  if (language === 'zh') return 'zh-CN';
  return language;
};

const EGYPT_VIEWBOX = '24.7,31.9,36.9,21.6';

/** Geocode a free-text query via Nominatim and return the best single result. */
async function geocodeQuery(query: string, language?: Language): Promise<Suggestion | null> {
  const searchLanguage = langForSearch(language);
  const trimmed = query.trim();
  if (!trimmed) return null;

  const nominatimUrl =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=eg&bounded=1&viewbox=${EGYPT_VIEWBOX}&limit=1&accept-language=${encodeURIComponent(searchLanguage)}&q=${encodeURIComponent(trimmed)}`;

  interface OsmFeature {
    display_name: string;
    lat: string;
    lon: string;
    name?: string;
    osm_type: string;
    osm_id: number;
  }

  try {
    const res = await fetch(nominatimUrl, {
      headers: { 'Accept-Language': searchLanguage },
    });
    const data = (await res.json()) as OsmFeature[];
    const f = Array.isArray(data) && data.length ? data[0] : null;
    if (!f) return null;

    return {
      id: `osm.${f.osm_type}.${f.osm_id}`,
      place_name: f.display_name,
      center: [Number(f.lon), Number(f.lat)],
      text: f.name || f.display_name.split(',')[0],
    };
  } catch {
    return null;
  }
}

const LocationAutocomplete = ({
  value, onChange, onSelect, placeholder, className,
  trailingAction, onTrailingAction, trailingLabel, readOnlyDisplay, language,
}: LocationAutocompleteProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback(async () => {
    const q = value.trim();
    if (!q || readOnlyDisplay) return;
    setIsLoading(true);
    try {
      const result = await geocodeQuery(q, language);
      if (result) {
        onSelect(result);
        onChange(result.place_name);
      }
    } catch (err) {
      console.error('Geocoding error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [value, language, readOnlyDisplay, onSelect, onChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSearch();
    }
  };

  const displayValue = readOnlyDisplay
    ? (readOnlyDisplay.length > 34 ? readOnlyDisplay.slice(0, 34).trimEnd() + '...' : readOnlyDisplay)
    : value;

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        {/* Search icon — clickable to trigger search */}
        <button
          type="button"
          onClick={() => { if (!readOnlyDisplay) void handleSearch(); }}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 p-0.5 rounded"
          aria-label="Search"
          tabIndex={-1}
        >
          {isLoading
            ? <Loader2 className="h-4 w-4 text-primary animate-spin" />
            : <Search className="h-4 w-4 text-muted-foreground hover:text-primary transition-colors" />
          }
        </button>

        {trailingAction === 'cancelTrip' && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTrailingAction?.(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-10 px-5 rounded-full bg-destructive hover:bg-destructive/90 text-white text-sm font-semibold shadow-lg transition-colors flex items-center justify-center"
            aria-label="Cancel current trip"
          >
            {trailingLabel || 'Cancel'}
          </button>
        )}
        {trailingAction === 'clear' && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTrailingAction?.(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-muted/70 hover:bg-muted text-muted-foreground border border-border shadow-sm transition-colors flex items-center justify-center"
            aria-label="Clear search"
          >
            <X className="h-5 w-5" strokeWidth={2.5} />
          </button>
        )}

        <Input
          ref={inputRef}
          placeholder={placeholder}
          value={displayValue}
          readOnly={!!readOnlyDisplay}
          title={readOnlyDisplay ?? undefined}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className={cn(
            'pl-11 shadow-xl border border-white/20 h-14 text-base rounded-[2rem] glass-panel truncate',
            trailingAction === 'cancelTrip' ? 'pr-28' : trailingAction === 'clear' ? 'pr-14' : '',
          )}
        />
      </div>
      {/* No dropdown suggestions — search-and-confirm flow like Google Maps */}
    </div>
  );
};

export default LocationAutocomplete;
