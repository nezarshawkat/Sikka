import { useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { ClerkProvider, useClerk } from "@clerk/react";
import { motion, AnimatePresence } from "framer-motion";
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
import TrainSearch from "./pages/TrainSearch";
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
import AdminAppSettings from "./pages/admin/AdminAppSettings";
import RequiredUpdateDialog from "./components/RequiredUpdateDialog";
import RouteDetail from "./pages/RouteDetail";
import NotFound from "./pages/NotFound";
import "./mobile-shell.css";

const queryClient = new QueryClient();
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

// Use the publishable key directly; host-derived keys are only needed for
// custom-domain proxy setups.
const DEFAULT_CLERK_PUBLISHABLE_KEY = "pk_test_Y2hhcm1lZC1nYXItMjMuY2xlcmsuYWNjb3VudHMuZGV2JA";
const clerkPubKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined) || DEFAULT_CLERK_PUBLISHABLE_KEY;

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

function StartupSplash() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-background"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          aria-label="Sikka loading"
        >
          <motion.img
            src={`${import.meta.env.BASE_URL}sikka-logo.svg`}
            alt="Sikka"
            className="h-44 w-44 object-contain sm:h-56 sm:w-56"
            initial={{ scale: 0.82, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
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
        <StartupSplash />
        <RequiredUpdateDialog />
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
          <Route path="/trains/search" element={<TrainSearch />} />
          <Route path="/travel/:mode" element={<TravelMode />} />
          <Route path="/route/:id" element={<RouteDetail />} />
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
            <Route path="app-settings" element={<AdminAppSettings />} />
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
