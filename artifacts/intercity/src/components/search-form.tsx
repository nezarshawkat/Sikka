import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { Calendar as CalendarIcon, ArrowRightLeft, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useListInterCities, getListInterCitiesQueryKey } from "@workspace/api-client-react";

export function SearchForm({ 
  initialFrom = "", 
  initialTo = "", 
  initialDate = "" 
}: { 
  initialFrom?: string; 
  initialTo?: string; 
  initialDate?: string;
}) {
  const [, setLocation] = useLocation();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [date, setDate] = useState<Date | undefined>(initialDate ? new Date(initialDate) : new Date());
  
  const { data: cities } = useListInterCities({ query: { queryKey: getListInterCitiesQueryKey() } });
  
  const sortedCities = useMemo(() => {
    if (!cities) return [];
    return [...cities].sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  }, [cities]);

  const handleSwap = () => {
    setFrom(to);
    setTo(from);
  };

  const handleSearch = () => {
    if (!from || !to || !date) return;
    const formattedDate = format(date, "yyyy-MM-dd");
    setLocation(`/results?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${formattedDate}`);
  };

  const isValid = !!from && !!to && !!date && from !== to;

  return (
    <div className="bg-card p-4 sm:p-6 rounded-xl shadow-lg border border-border w-full">
      <div className="flex flex-col sm:flex-row items-stretch gap-4 sm:gap-2">
        <div className="relative flex-1 flex flex-col sm:flex-row items-center gap-2">
          <div className="w-full flex-1">
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger className="w-full h-14 bg-muted/50 border-transparent hover:border-border transition-colors">
                <div className="flex items-center gap-2 text-left">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">From</span>
                    <span className="truncate">{from ? cities?.find(c => c.nameEn === from)?.nameEn : "Origin city"}</span>
                  </div>
                </div>
              </SelectTrigger>
              <SelectContent>
                {sortedCities.map((city) => (
                  <SelectItem key={city.id} value={city.nameEn}>
                    {city.nameEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <Button 
            variant="outline" 
            size="icon" 
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 rounded-full h-8 w-8 shadow-sm border-border bg-card hidden sm:flex hover:bg-muted"
            onClick={handleSwap}
            type="button"
          >
            <ArrowRightLeft className="h-4 w-4" />
          </Button>
          
          <div className="w-full flex-1">
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger className="w-full h-14 bg-muted/50 border-transparent hover:border-border transition-colors">
                <div className="flex items-center gap-2 text-left">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">To</span>
                    <span className="truncate">{to ? cities?.find(c => c.nameEn === to)?.nameEn : "Destination"}</span>
                  </div>
                </div>
              </SelectTrigger>
              <SelectContent>
                {sortedCities.map((city) => (
                  <SelectItem key={city.id} value={city.nameEn}>
                    {city.nameEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="w-full sm:w-[220px]">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={`w-full h-14 justify-start text-left font-normal bg-muted/50 border-transparent hover:border-border transition-colors ${!date && "text-muted-foreground"}`}
              >
                <div className="flex items-center gap-2">
                  <CalendarIcon className="h-5 w-5 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Date</span>
                    <span>{date ? format(date, "PPP") : "Pick a date"}</span>
                  </div>
                </div>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={date}
                onSelect={setDate}
                initialFocus
                disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
              />
            </PopoverContent>
          </Popover>
        </div>

        <Button 
          size="lg" 
          className="h-14 px-8 text-base font-semibold w-full sm:w-auto shrink-0" 
          onClick={handleSearch}
          disabled={!isValid}
        >
          Search Buses
        </Button>
      </div>
    </div>
  );
}
