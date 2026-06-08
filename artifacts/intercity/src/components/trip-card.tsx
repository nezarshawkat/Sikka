import { InterTrip } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, MapPin, ExternalLink, Armchair } from "lucide-react";

export function TripCard({ trip }: { trip: InterTrip }) {
  // Brand color mapping
  const getOperatorBadgeClass = (slug: string) => {
    switch (slug.toLowerCase()) {
      case 'superjet':
        return 'bg-blue-900 hover:bg-blue-900/90 text-white border-blue-900';
      case 'gobus':
        return 'bg-green-600 hover:bg-green-600/90 text-white border-green-600';
      case 'bluebus':
        return 'bg-sky-500 hover:bg-sky-500/90 text-white border-sky-500';
      default:
        return 'bg-secondary text-secondary-foreground border-secondary';
    }
  };

  const formatDuration = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  };

  return (
    <div className="bg-card hover:border-primary/30 transition-colors rounded-xl border border-border shadow-sm overflow-hidden flex flex-col md:flex-row items-stretch">
      {/* Operator & Time Section */}
      <div className="p-5 flex-1 flex flex-col justify-between border-b md:border-b-0 md:border-r border-border bg-slate-50/50">
        <div className="flex justify-between items-start mb-4">
          <Badge className={`px-3 py-1 text-sm font-semibold rounded-full ${getOperatorBadgeClass(trip.operatorSlug)}`}>
            {trip.operator}
          </Badge>
          {trip.busType && (
            <Badge variant="outline" className="text-xs font-medium text-muted-foreground bg-card">
              {trip.busType}
            </Badge>
          )}
        </div>
        
        <div className="flex items-center justify-between">
          <div className="text-center">
            <span className="block text-2xl font-bold tracking-tight">{trip.departure}</span>
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">Depart</span>
          </div>
          
          <div className="flex-1 px-4 flex flex-col items-center">
            <span className="text-xs font-medium text-muted-foreground mb-1">{formatDuration(trip.durationMinutes)}</span>
            <div className="w-full relative flex items-center justify-center">
              <div className="h-[2px] w-full bg-border absolute top-1/2 -translate-y-1/2"></div>
              <Clock className="w-4 h-4 text-muted-foreground relative z-10 bg-slate-50" />
            </div>
          </div>
          
          <div className="text-center">
            <span className="block text-2xl font-bold tracking-tight">{trip.arrival}</span>
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">Arrive</span>
          </div>
        </div>
      </div>

      {/* Stations & Details */}
      <div className="p-5 flex-[1.5] flex flex-col justify-between">
        <div className="space-y-3 mb-6">
          <div className="flex gap-3">
            <MapPin className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm leading-none">{trip.fromStation}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <MapPin className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm leading-none">{trip.toStation}</p>
            </div>
          </div>
        </div>
        
        <div className="flex items-center justify-between mt-auto">
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            {trip.availableSeats !== null && trip.availableSeats !== undefined ? (
              <>
                <Armchair className="w-4 h-4" />
                <span className={trip.availableSeats < 10 ? "text-orange-500" : ""}>
                  {trip.availableSeats} seats left
                </span>
              </>
            ) : (
              <span className="text-xs">Availability unknown</span>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-xs text-muted-foreground font-medium uppercase">Price</span>
              <div className="text-xl font-bold text-primary">{trip.priceEgp} EGP</div>
            </div>
            
            <Button 
              size="lg" 
              className="rounded-full px-6 shadow-sm"
              asChild
            >
              <a href={trip.bookingUrl || "#"} target="_blank" rel="noopener noreferrer">
                Book
                <ExternalLink className="w-4 h-4 ml-2" />
              </a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
