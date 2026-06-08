import { useLocation } from "wouter";
import { SearchForm } from "@/components/search-form";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const POPULAR_ROUTES = [
  { from: "Cairo", to: "Alexandria", label: "Cairo to Alex" },
  { from: "Cairo", to: "Hurghada", label: "Cairo to Hurghada" },
  { from: "Cairo", to: "Sharm El Sheikh", label: "Cairo to Sharm" },
  { from: "Alexandria", to: "Cairo", label: "Alex to Cairo" }
];

export default function Home() {
  const [, setLocation] = useLocation();

  const handleQuickRoute = (from: string, to: string) => {
    const today = new Date().toISOString().split('T')[0];
    setLocation(`/results?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${today}`);
  };

  return (
    <div className="flex flex-col items-center">
      {/* Hero Section */}
      <section className="w-full bg-primary relative overflow-hidden flex flex-col items-center justify-center py-20 px-4 min-h-[480px]">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white to-transparent mix-blend-overlay"></div>
        
        <div className="z-10 text-center max-w-3xl mb-10">
          <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight mb-4 leading-tight">
            Egypt's first unified intercity bus search
          </h1>
          <p className="text-primary-foreground/80 text-lg md:text-xl font-medium max-w-2xl mx-auto">
            Compare SuperJet, GoBus, and BlueBus trips side by side. Fast, no-fuss, built for travelers.
          </p>
        </div>

        <div className="z-10 w-full max-w-4xl relative">
          <SearchForm />
        </div>
      </section>

      {/* Popular Routes */}
      <section className="w-full max-w-4xl px-4 py-16 mx-auto">
        <h2 className="text-2xl font-bold mb-6 text-foreground text-center">Featured Routes</h2>
        <div className="flex flex-wrap gap-4 justify-center">
          {POPULAR_ROUTES.map((route) => (
            <Button 
              key={route.label}
              variant="outline" 
              className="h-auto py-3 px-6 rounded-full border-border bg-card hover:bg-muted hover:border-primary/50 transition-all group"
              onClick={() => handleQuickRoute(route.from, route.to)}
            >
              <span className="font-medium">{route.from}</span>
              <ArrowRight className="w-4 h-4 mx-2 text-muted-foreground group-hover:text-primary transition-colors" />
              <span className="font-medium">{route.to}</span>
            </Button>
          ))}
        </div>
      </section>
    </div>
  );
}
