import { Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface TaxiAppButtonProps {
  fromName: string;
  toName: string;
  label: string;
  className?: string;
}

function routeShareUrl(fromName: string, toName: string): string {
  const origin = encodeURIComponent(fromName || 'Current location');
  const destination = encodeURIComponent(toName || 'Destination');
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
}

export default function TaxiAppButton({ fromName, toName, label, className }: TaxiAppButtonProps) {
  const shareRoute = async () => {
    const url = routeShareUrl(fromName, toName);
    const text = `${fromName || 'Pickup'} -> ${toName || 'Destination'}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Sikka taxi route', text, url });
        return;
      }
      toast.error('Sharing is not available on this device');
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
