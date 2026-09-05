import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type RouteResnapProvider = 'valhalla' | 'osrm';

interface RouteResnapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (provider: RouteResnapProvider) => void;
  loading?: boolean;
  error?: string;
}

export function RouteResnapDialog({
  open,
  onOpenChange,
  onSelect,
  loading = false,
  error,
}: RouteResnapDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[2rem]">
        <DialogHeader>
          <DialogTitle>Improve route quality</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Choose which road-matching service to try for this route.
        </p>
        <div className="flex gap-2 pt-2">
          <Button className="flex-1" disabled={loading} onClick={() => onSelect('valhalla')}>
            Valhalla
          </Button>
          <Button className="flex-1" variant="outline" disabled={loading} onClick={() => onSelect('osrm')}>
            OSRM
          </Button>
        </div>
        {error && <p className="text-xs text-red-500">Failed: {error}</p>}
      </DialogContent>
    </Dialog>
  );
}