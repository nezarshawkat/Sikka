import { Link } from "wouter";
import { Bus } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background font-sans">
      <header className="sticky top-0 z-20 border-b bg-card shadow-sm">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-primary font-bold text-xl tracking-tight">
            <Bus className="h-6 w-6" />
            <span>Intercity Egypt</span>
          </Link>
        </div>
      </header>
      <main className="flex-1 w-full flex flex-col">
        {children}
      </main>
    </div>
  );
}
