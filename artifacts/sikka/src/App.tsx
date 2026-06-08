import { useEffect, useRef, type ReactNode } from "react";
import maplibregl from "maplibre-gl";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { ClerkProvider, useClerk } from "@clerk/react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, GuestAuthProvider } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
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

// GitHub APK builds can run without repository secrets. Do not crash the whole
// WebView in that case; render the rider experience in local guest mode instead.
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const hasClerkConfig = Boolean(clerkPubKey);

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

function OfflineAuthPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-5 text-center">
      <img
        src={`${import.meta.env.BASE_URL}sikka-logo.svg`}
        alt="Sikka"
        className="h-24 w-auto mb-6"
      />
      <h1 className="text-2xl font-bold text-foreground">Sikka is ready</h1>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">
        This APK was built without the Clerk key, so it is running in guest mode. Add the GitHub secrets to enable phone login.
      </p>
      <Button className="mt-6" onClick={() => navigate('/', { replace: true })}>
        Open Sikka
      </Button>
    </div>
  );
}

function AppRouteElements({ authEnabled }: { authEnabled: boolean }) {
  const authElement = authEnabled ? <Auth /> : <OfflineAuthPage />;
  const signInElement = authEnabled ? <SignInPage /> : <OfflineAuthPage />;
  const signUpElement = authEnabled ? <SignUpPage /> : <OfflineAuthPage />;

  return (
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/splash" element={<Splash />} />
      <Route path="/auth" element={authElement} />
      <Route path="/sign-in/*" element={signInElement} />
      <Route path="/sign-up/*" element={signUpElement} />
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
  );
}

function AppChrome({ children }: { children: ReactNode }) {
  return (
    <>
      <MapLibreRtlPluginLoader />
      <Toaster />
      <Sonner />
      {children}
    </>
  );
}

function ClerkAppRoutes() {
  const navigate = useNavigate();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey!}
      proxyUrl={clerkProxyUrl}
      signInUrl={`${basename}/sign-in`}
      signUpUrl={`${basename}/sign-up`}
      routerPush={(to) => navigate(stripBase(to))}
      routerReplace={(to) => navigate(stripBase(to), { replace: true })}
    >
      <ClerkQueryClientCacheInvalidator />
      <AuthProvider>
        <AppChrome>
          <AppRouteElements authEnabled />
        </AppChrome>
      </AuthProvider>
    </ClerkProvider>
  );
}

function GuestAppRoutes() {
  return (
    <GuestAuthProvider>
      <AppChrome>
        <AppRouteElements authEnabled={false} />
      </AppChrome>
    </GuestAuthProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter basename={basename}>
        {hasClerkConfig ? <ClerkAppRoutes /> : <GuestAppRoutes />}
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
