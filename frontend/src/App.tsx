import { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { initAuth, tokenLogin } from './services/api';

const StaffLayout = lazy(() => import('./components/StaffLayout'));

// Lazy-loaded pages
const Home = lazy(() => import('./pages/Home'));
const Search = lazy(() => import('./pages/Search'));
const Order = lazy(() => import('./pages/Order'));
const OrderStatus = lazy(() => import('./pages/OrderStatus'));
const Orders = lazy(() => import('./pages/Orders'));
const Upload = lazy(() => import('./pages/Upload'));
const Settings = lazy(() => import('./pages/Settings'));
const Login = lazy(() => import('./pages/Login'));

// Staff pages
const StaffDashboard = lazy(() => import('./pages/staff/Dashboard'));
const StaffOrderDetail = lazy(() => import('./pages/staff/OrderDetail'));
const StaffMedicineCatalog = lazy(() => import('./pages/staff/MedicineCatalog'));

// ---------------------------------------------------------------------------
// Spinner fallback
// ---------------------------------------------------------------------------
function PageSpinner() {
  return (
    <div style={styles.spinner}>
      <div style={styles.spinnerInner} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom Navigation
// ---------------------------------------------------------------------------
interface NavItem {
  to: string;
  labelKey: string;
  icon: string;
}

const customerNav: NavItem[] = [
  { to: '/', labelKey: 'nav.home', icon: '🏠' },
  { to: '/search', labelKey: 'nav.search', icon: '🔍' },
  { to: '/orders', labelKey: 'nav.orders', icon: '📋' },
  { to: '/settings', labelKey: 'nav.settings', icon: '⚙️' },
];

const staffNavItem: NavItem = { to: '/staff', labelKey: 'nav.staff', icon: '👨‍⚕️' };

function BottomNav({ isStaff }: { isStaff: boolean }) {
  const { t } = useTranslation();
  const navItems = isStaff ? [...customerNav, staffNavItem] : customerNav;

  return (
    <nav style={styles.bottomNav} aria-label="Bottom navigation">
      {navItems.map(({ to, labelKey, icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          style={({ isActive }) => ({
            ...styles.navItem,
            color: isActive
              ? 'var(--tg-theme-button-color, #2196f3)'
              : 'var(--tg-theme-hint-color, #999)',
          })}
        >
          <span style={styles.navIcon} aria-hidden="true">
            {icon}
          </span>
          <span style={styles.navLabel}>{t(labelKey)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isStaff, setIsStaff] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const isTelegram = !!window.Telegram?.WebApp?.initData;
  const isStaffRoute = location.pathname.startsWith('/staff');

  // Initialize auth on mount — handle magic link token, web token, or Telegram initData
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const magicToken = params.get('token');

    if (magicToken) {
      // Staff magic-link flow: exchange token, store it, clean URL
      tokenLogin(magicToken)
        .then((res) => {
          localStorage.setItem('staff_token', res.access_token);
          if (res.is_staff) {
            setIsStaff(true);
            localStorage.setItem('isStaff', 'true');
          }
          window.history.replaceState({}, '', window.location.pathname);
          setIsAuthenticated(true);
          setAuthReady(true);
        })
        .catch(() => {
          localStorage.removeItem('staff_token');
          const stored = localStorage.getItem('isStaff');
          if (stored === 'true') setIsStaff(true);
          setAuthReady(true);
        });
      return;
    }

    // If we have a stored staff token, validate it
    const storedToken = localStorage.getItem('staff_token');
    if (storedToken) {
      tokenLogin(storedToken)
        .then((res) => {
          localStorage.setItem('staff_token', res.access_token);
          if (res.is_staff) {
            setIsStaff(true);
            localStorage.setItem('isStaff', 'true');
          } else {
            localStorage.removeItem('isStaff');
          }
          setIsAuthenticated(true);
          setAuthReady(true);
        })
        .catch(() => {
          localStorage.removeItem('staff_token');
          localStorage.removeItem('isStaff');
          setAuthReady(true);
        });
      return;
    }

    // Check for web token (phone+password login)
    const webToken = localStorage.getItem('web_token');
    if (webToken) {
      tokenLogin(webToken)
        .then((res) => {
          localStorage.setItem('web_token', res.access_token);
          if (res.is_staff) {
            setIsStaff(true);
            localStorage.setItem('isStaff', 'true');
          }
          setIsAuthenticated(true);
          setAuthReady(true);
        })
        .catch(() => {
          localStorage.removeItem('web_token');
          setAuthReady(true);
        });
      return;
    }

    // Standard Telegram Mini App flow
    if (isTelegram) {
      initAuth()
        .then((res) => {
          if (res.is_staff) {
            setIsStaff(true);
            localStorage.setItem('isStaff', 'true');
          } else {
            localStorage.removeItem('isStaff');
          }
          setIsAuthenticated(true);
          setAuthReady(true);
        })
        .catch(() => {
          const stored = localStorage.getItem('isStaff');
          if (stored === 'true') setIsStaff(true);
          setAuthReady(true);
        });
    } else {
      // Browser without Telegram — show login
      setAuthReady(true);
    }
  }, [navigate, isTelegram]);

  // Auto-redirect staff users on desktop browser to /staff
  useEffect(() => {
    if (authReady && isStaff && !isTelegram && location.pathname === '/') {
      navigate('/staff', { replace: true });
    }
  }, [authReady, isStaff, isTelegram, location.pathname, navigate]);

  if (!authReady) return <PageSpinner />;

  // In browser without auth — show login/register
  if (!isTelegram && !isAuthenticated) {
    return (
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="*" element={<Login />} />
        </Routes>
      </Suspense>
    );
  }

  // Staff desktop layout — sidebar nav, full width
  if (isStaffRoute) {
    return (
      <Suspense fallback={<PageSpinner />}>
        <StaffLayout>
          <Routes>
            <Route path="/staff" element={<StaffDashboard />} />
            <Route path="/staff/order/:id" element={<StaffOrderDetail />} />
            <Route path="/staff/medicines" element={<StaffMedicineCatalog />} />
          </Routes>
        </StaffLayout>
      </Suspense>
    );
  }

  // Customer layout — mobile 480px + bottom nav
  return (
    <div style={styles.appWrapper}>
      <main style={styles.main}>
        <Suspense fallback={<PageSpinner />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/order" element={<Order />} />
            <Route path="/order/:id" element={<OrderStatus />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Suspense>
      </main>

      <BottomNav isStaff={isStaff} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles (inline — no external CSS dependency for core layout)
// ---------------------------------------------------------------------------
const NAV_HEIGHT = 60;

const styles: Record<string, React.CSSProperties> = {
  appWrapper: {
    display: 'flex',
    flexDirection: 'column',
    height: '100dvh',
    background: 'var(--tg-theme-bg-color, #fff)',
    color: 'var(--tg-theme-text-color, #222)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    maxWidth: 480,
    margin: '0 auto',
    position: 'relative',
  },
  main: {
    flex: 1,
    overflowY: 'auto',
    paddingBottom: NAV_HEIGHT,
  },
  bottomNav: {
    position: 'fixed',
    bottom: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    width: '100%',
    maxWidth: 480,
    height: NAV_HEIGHT,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-around',
    background: 'var(--tg-theme-secondary-bg-color, #f5f5f5)',
    borderTop: '1px solid var(--tg-theme-hint-color, #ddd)',
    zIndex: 100,
    boxShadow: '0 -1px 6px rgba(0,0,0,0.08)',
  },
  navItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    textDecoration: 'none',
    flex: 1,
    padding: '6px 0',
    transition: 'color 0.15s',
  },
  navIcon: {
    fontSize: 20,
    lineHeight: 1,
  },
  navLabel: {
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: 0.2,
  },
  spinner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100dvh',
  },
  spinnerInner: {
    width: 36,
    height: 36,
    border: '3px solid var(--tg-theme-hint-color, #ddd)',
    borderTopColor: 'var(--tg-theme-button-color, #2196f3)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};
