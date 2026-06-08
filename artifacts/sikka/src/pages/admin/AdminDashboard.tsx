import { useEffect } from 'react';
import { useNavigate, Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Train, MapPin, Route, Star, BarChart3, Map, Flag, Compass } from 'lucide-react';

const AdminDashboard = () => {
  const { isAdmin, isLoading, language } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      navigate('/');
    }
  }, [isAdmin, isLoading, navigate]);

  if (isLoading) return null;

  const tabs = [
    { path: '/admin/map', label: 'Map', icon: Map },
    { path: '/admin/transport', label: t('transportTypes', language), icon: Train },
    { path: '/admin/locations', label: t('locations', language), icon: MapPin },
    { path: '/admin/routes', label: t('routes', language), icon: Route },
    { path: '/admin/reviews', label: t('reviews', language), icon: Star },
    { path: '/admin/reports', label: t('reports', language), icon: Flag },
    { path: '/admin/discovery', label: t('routeDiscovery', language), icon: Compass },
    { path: '/admin/analytics', label: t('analytics', language), icon: BarChart3 },
  ];

  const isMapPage = location.pathname === '/admin' || location.pathname === '/admin/map';

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-card/95 backdrop-blur-sm border-b z-20 p-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="font-semibold text-lg flex-1">{t('dashboard', language)}</h1>
      </div>

      <div className="border-b overflow-x-auto sticky top-[65px] bg-card/95 backdrop-blur-sm z-10">
        <div className="flex p-2 gap-1 min-w-max">
          {tabs.map(({ path, label, icon: Icon }) => (
            <Link key={path} to={path}>
              <Button
                variant={location.pathname === path || (path === '/admin/map' && location.pathname === '/admin') ? 'default' : 'ghost'}
                size="sm"
                className="gap-1.5 whitespace-nowrap"
              >
                <Icon className="h-4 w-4" />
                {label}
              </Button>
            </Link>
          ))}
        </div>
      </div>

      <div className={isMapPage ? 'p-4' : 'p-4'}>
        <Outlet />
      </div>
    </div>
  );
};

export default AdminDashboard;
