import { useSearch } from "wouter";
import { useState, useMemo } from "react";
import { format } from "date-fns";
import { Clock, Loader2, Info } from "lucide-react";
import { useSearchInterTrips, getSearchInterTripsQueryKey } from "@workspace/api-client-react";
import { SearchForm } from "@/components/search-form";
import { TripCard } from "@/components/trip-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Results() {
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  const date = searchParams.get("date") || "";

  const [sort, setSort] = useState("departure");
  const [operatorFilter, setOperatorFilter] = useState("all");

  const canSearch = !!from && !!to && !!date;

  const { data: results, isLoading, error } = useSearchInterTrips(
    { from, to, date },
    { query: { enabled: canSearch, queryKey: getSearchInterTripsQueryKey({ from, to, date }) } }
  );

  const filteredAndSortedTrips = useMemo(() => {
    if (!results?.trips) return [];
    
    let processed = [...results.trips];
    
    if (operatorFilter !== "all") {
      processed = processed.filter(t => t.operatorSlug === operatorFilter);
    }
    
    processed.sort((a, b) => {
      if (sort === "departure") {
        return a.departure.localeCompare(b.departure);
      } else if (sort === "price") {
        return a.priceEgp - b.priceEgp;
      } else if (sort === "duration") {
        return a.durationMinutes - b.durationMinutes;
      }
      return 0;
    });
    
    return processed;
  }, [results, sort, operatorFilter]);

  const uniqueOperators = useMemo(() => {
    if (!results?.trips) return [];
    return Array.from(new Set(results.trips.map(t => t.operatorSlug)));
  }, [results]);

  return (
    <div className="w-full bg-slate-50 min-h-[calc(100vh-64px)] pb-12">
      {/* Header with Search */}
      <div className="bg-primary pt-8 pb-16 px-4">
        <div className="max-w-5xl mx-auto">
          <SearchForm initialFrom={from} initialTo={to} initialDate={date} />
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 -mt-8">
        {!canSearch && (
          <div className="bg-card rounded-xl p-12 text-center border shadow-sm">
            <Info className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-20" />
            <h2 className="text-xl font-semibold mb-2">Please select your route</h2>
            <p className="text-muted-foreground">Select origin, destination and date to find available trips.</p>
          </div>
        )}

        {canSearch && isLoading && (
          <div className="space-y-4">
            <div className="h-10 bg-muted rounded-lg w-full max-w-sm animate-pulse"></div>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-card rounded-xl h-32 border shadow-sm animate-pulse"></div>
            ))}
          </div>
        )}

        {canSearch && error && (
          <div className="bg-destructive/10 text-destructive border-destructive/20 rounded-xl p-8 text-center border">
            <p className="font-medium">Failed to load trips. Please try again.</p>
          </div>
        )}

        {canSearch && !isLoading && !error && results && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-card p-4 rounded-xl shadow-sm border">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <span className="text-foreground font-bold text-lg">{filteredAndSortedTrips.length}</span> trips found
              </div>
              
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <Select value={operatorFilter} onValueChange={setOperatorFilter}>
                  <SelectTrigger className="w-full sm:w-[160px]">
                    <SelectValue placeholder="All Operators" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Operators</SelectItem>
                    {uniqueOperators.map(op => (
                      <SelectItem key={op} value={op} className="capitalize">
                        {op.replace('-', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger className="w-full sm:w-[160px]">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="departure">Earliest Departure</SelectItem>
                    <SelectItem value="price">Lowest Price</SelectItem>
                    <SelectItem value="duration">Fastest Trip</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {filteredAndSortedTrips.length === 0 ? (
              <div className="bg-card rounded-xl p-16 text-center border shadow-sm">
                <Clock className="h-16 w-16 text-muted-foreground mx-auto mb-6 opacity-20" />
                <h3 className="text-xl font-semibold mb-2">No trips found</h3>
                <p className="text-muted-foreground">Try selecting a different date or operator filter.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredAndSortedTrips.map((trip, idx) => (
                  <TripCard key={`${trip.operatorSlug}-${trip.departure}-${idx}`} trip={trip} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
