import { Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { openNativeShareSheet, openNativeDestinationChooser } from '@/lib/nativeShare';

interface TaxiAppButtonProps {
  fromName: string;
  toName: string;
  /** Destination coordinates, when known -- lets the Android geo chooser
   *  pre-fill an exact pin instead of relying on the app to geocode a name. */
  toLat?: number;
  toLng?: number;
  label: string;
  className?: string;
}

function routeShareUrl(fromName: string, toName: string): string {
  const origin = encodeURIComponent(fromName || 'Current location');
  const destination = encodeURIComponent(toName || 'Destination');
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
}

export default function TaxiAppButton({ fromName, toName, toLat, toLng, label, className }: TaxiAppButtonProps) {
  const shareRoute = async () => {
    try {
      const hasCoords = typeof toLat === 'number' && typeof toLng === 'number' && Number.isFinite(toLat) && Number.isFinite(toLng);
      // Android: hand the destination to the OS geo chooser so the rider
      // picks any installed taxi/maps app themselves.
      if (await openNativeDestinationChooser({
        latitude: hasCoords ? toLat : undefined,
        longitude: hasCoords ? toLng : undefined,
        name: toName,
      })) return;

      // Web / older native builds: fall back to the previous share-sheet flow.
      const url = routeShareUrl(fromName, toName);
      const text = `${fromName || 'Pickup'} -> ${toName || 'Destination'}`;
      if (await openNativeShareSheet({ title: 'Sikka taxi route', text, url })) return;
      if (navigator.share) {
        await navigator.share({ title: 'Sikka taxi route', text, url });
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      toast.error('Could not open the share sheet');
    }
  };

  return (
    <Button className={className ?? 'w-full h-11 rounded-[2rem] gap-2'} onClick={shareRoute}>
      <Share2 className="h-4 w-4" /> {label}
    </Button>
  );
}
