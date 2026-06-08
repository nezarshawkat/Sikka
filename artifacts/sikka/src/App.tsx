import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { ClerkProvider, useClerk } from "@clerk/react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import Index from "./pages/Index";
import Splash from "./pages/Splash";
import Auth from "./pages/Auth";
import SignInPage from "./pages/SignIn";
import SignUpPage from "./pages/SignUp";
import Profile from "./pages/Profile";
import TripPlan from "./pages/TripPlan";
import PlanSetup from "./pages/PlanSetup";
import DiscoverTrip from "./pages/DiscoverTrip";
import TripResult from "./pages/TripResult";
import Intercity from "./pages/Intercity";
import TravelMode from "./pages/TravelMode";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminTransport from "./pages/admin/AdminTransport";
import AdminLocations from "./pages/admin/AdminLocations";
import AdminRoutes from "./pages/admin/AdminRoutes";
import AdminReviews from "./pages/admin/AdminReviews";
import AdminReports from "./pages/admin/AdminReports";
import AdminDiscovery from "./pages/admin/AdminDiscovery";
import AdminAnalytics from "./pages/admin/AdminAnalytics";
import AdminMap from "./pages/admin/AdminMap";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

// Use the publishable key directly; host-derived keys are only needed for
// custom-domain proxy setups.
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

// proxyUrl is only set in production by the platform; leave undefined in dev
// so Clerk loads from its own CDN using the URL embedded in the publishable key.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL || undefined;

function stripBase(path: string): string {
  return basename && path.startsWith(basename)
    ? path.slice(basename.length) || "/"
    : path;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}


function MapLibreRtlPluginLoader() {
  useEffect(() => {
    try {
      const maybeMapLibre = maplibregl as typeof maplibregl & {
        getRTLTextPluginStatus?: () => string;
        setRTLTextPlugin?: (url: string, callback: ((error?: Error) => void) | null, lazy?: boolean) => void;
      };
      const status = maybeMapLibre.getRTLTextPluginStatus?.();
      if (status === 'unavailable' || status === undefined) {
        maybeMapLibre.setRTLTextPlugin?.(
          'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js',
          null,
          true,
        );
      }
    } catch (err) {
      console.warn('Unable to load RTL map text plugin', err);
    }
  }, []);
  return null;
}

function AppRoutes() {
  const navigate = useNavigate();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      signInUrl={`${basename}/sign-in`}
      signUpUrl={`${basename}/sign-up`}
      routerPush={(to) => navigate(stripBase(to))}
      routerReplace={(to) => navigate(stripBase(to), { replace: true })}
    >
      <ClerkQueryClientCacheInvalidator />
      <AuthProvider>
        <MapLibreRtlPluginLoader />
        <Toaster />
        <Sonner />
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/splash" element={<Splash />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/sign-in/*" element={<SignInPage />} />
          <Route path="/sign-up/*" element={<SignUpPage />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/plan" element={<TripPlan />} />
          <Route path="/plan/setup" element={<PlanSetup />} />
          <Route path="/discover-trip" element={<DiscoverTrip />} />
          <Route path="/trip-result" element={<TripResult />} />
          <Route path="/intercity" element={<Intercity />} />
          <Route path="/travel/:mode" element={<TravelMode />} />
          <Route path="/admin" element={<AdminDashboard />}>
            <Route index element={<AdminMap />} />
            <Route path="map" element={<AdminMap />} />
            <Route path="transport" element={<AdminTransport />} />
            <Route path="locations" element={<AdminLocations />} />
            <Route path="routes" element={<AdminRoutes />} />
            <Route path="reviews" element={<AdminReviews />} />
            <Route path="reports" element={<AdminReports />} />
            <Route path="discovery" element={<AdminDiscovery />} />
            <Route path="analytics" element={<AdminAnalytics />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </ClerkProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter basename={basename}>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
