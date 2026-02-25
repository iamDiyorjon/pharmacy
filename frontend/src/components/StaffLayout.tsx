import { type ReactNode, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface StaffLayoutProps {
  children: ReactNode;
}

const SIDEBAR_WIDTH = 240;

export default function StaffLayout({ children }: StaffLayoutProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem('staff_token');
    localStorage.removeItem('web_token');
    localStorage.removeItem('isStaff');
    navigate('/');
    window.location.reload();
  };

  const navLinks = [
    { to: '/staff', label: t('staff.orders'), icon: '\u{1F4CB}', end: true },
    { to: '/staff/medicines', label: t('staff.medicines'), icon: '\u{1F48A}', end: false },
  ];

  return (
    <>
      {/* Injected responsive styles */}
      <style>{`
        @media (max-width: 768px) {
          .staff-sidebar { display: none !important; }
          .staff-mobile-header { display: flex !important; }
          .staff-content { margin-left: 0 !important; }
          .staff-mobile-menu { display: flex !important; }
        }
        @media (min-width: 769px) {
          .staff-sidebar { display: flex !important; }
          .staff-mobile-header { display: none !important; }
          .staff-mobile-menu { display: none !important; }
        }
        .staff-nav-link {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 16px;
          border-radius: 8px;
          text-decoration: none;
          color: #555;
          font-size: 14px;
          font-weight: 500;
          transition: background 0.15s, color 0.15s;
        }
        .staff-nav-link:hover {
          background: #e3f2fd;
          color: #1565c0;
        }
        .staff-nav-link.active {
          background: #1565c0;
          color: #fff;
        }
        .staff-nav-link.active:hover {
          background: #1256a8;
          color: #fff;
        }
      `}</style>

      {/* Mobile header */}
      <header className="staff-mobile-header" style={s.mobileHeader}>
        <button style={s.menuBtn} onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? '\u2715' : '\u2630'}
        </button>
        <span style={s.mobileTitle}>{t('staff.dashboard')}</span>
      </header>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <nav className="staff-mobile-menu" style={s.mobileMenu}>
          {navLinks.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `staff-nav-link${isActive ? ' active' : ''}`}
              onClick={() => setMobileMenuOpen(false)}
            >
              <span style={{ fontSize: 18 }}>{icon}</span>
              {label}
            </NavLink>
          ))}
          <button style={s.logoutBtn} onClick={handleLogout}>
            {t('settings.title') === 'Sozlamalar' ? 'Chiqish' : 'Logout'}
          </button>
        </nav>
      )}

      {/* Desktop sidebar */}
      <aside className="staff-sidebar" style={s.sidebar}>
        <div style={s.sidebarTop}>
          <div style={s.logo}>
            <span style={{ fontSize: 24 }}>{'\u{1F3E5}'}</span>
            <span style={s.logoText}>Pharmacy Staff</span>
          </div>

          <nav style={s.nav}>
            {navLinks.map(({ to, label, icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => `staff-nav-link${isActive ? ' active' : ''}`}
              >
                <span style={{ fontSize: 18 }}>{icon}</span>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>

        <button style={s.logoutBtn} onClick={handleLogout}>
          {'\u{1F6AA}'} {t('settings.title') === 'Sozlamalar' ? 'Chiqish' : 'Logout'}
        </button>
      </aside>

      {/* Content area */}
      <main className="staff-content" style={s.content}>
        {children}
      </main>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  sidebar: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: SIDEBAR_WIDTH,
    height: '100vh',
    background: '#f8f9fa',
    borderRight: '1px solid #e0e0e0',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '20px 12px',
    zIndex: 200,
    overflowY: 'auto',
  },
  sidebarTop: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 8px',
  },
  logoText: {
    fontSize: 16,
    fontWeight: 700,
    color: '#1565c0',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  logoutBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 16px',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    background: '#fff',
    color: '#c62828',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    width: '100%',
  },
  content: {
    marginLeft: SIDEBAR_WIDTH,
    minHeight: '100vh',
    background: '#fff',
    padding: '24px 32px',
  },
  mobileHeader: {
    display: 'none',
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    background: '#f8f9fa',
    borderBottom: '1px solid #e0e0e0',
    position: 'sticky',
    top: 0,
    zIndex: 150,
  },
  menuBtn: {
    background: 'none',
    border: 'none',
    fontSize: 22,
    cursor: 'pointer',
    padding: '4px 8px',
    color: '#333',
  },
  mobileTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#1565c0',
  },
  mobileMenu: {
    display: 'none',
    flexDirection: 'column',
    gap: 4,
    padding: '12px 16px',
    background: '#f8f9fa',
    borderBottom: '1px solid #e0e0e0',
  },
};
