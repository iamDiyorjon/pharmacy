import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { getPharmacies, type Pharmacy } from '../services/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatTime(t: string): string {
  return t.slice(0, 5);
}

// ---------------------------------------------------------------------------
// PharmacyCard
// ---------------------------------------------------------------------------
interface PharmacyCardProps {
  pharmacy: Pharmacy;
  onSearch: () => void;
}

function PharmacyCard({ pharmacy, onSearch }: PharmacyCardProps) {
  const { t } = useTranslation();

  return (
    <article style={cardStyles.card}>
      {/* Header row */}
      <div style={cardStyles.header}>
        <div style={cardStyles.headerLeft}>
          <div style={{
            ...cardStyles.iconCircle,
            ...(pharmacy.is_open ? { background: '#e8f5e9' } : { background: '#fce4ec' }),
          }}>
            <span style={cardStyles.icon}>{'\uD83C\uDFE5'}</span>
          </div>
          <div style={cardStyles.headerInfo}>
            <h2 style={cardStyles.name}>{pharmacy.name}</h2>
            <span
              style={{
                ...cardStyles.badge,
                ...(pharmacy.is_open ? cardStyles.badgeOpen : cardStyles.badgeClosed),
              }}
            >
              {pharmacy.is_open ? t('home.open') : t('home.closed')}
            </span>
          </div>
        </div>
      </div>

      {/* Details */}
      <div style={cardStyles.details}>
        <div style={cardStyles.detailRow}>
          <span style={cardStyles.detailIcon}>{'\uD83D\uDCCD'}</span>
          <span style={cardStyles.detailText}>{pharmacy.address}</span>
        </div>
        <div style={cardStyles.detailRow}>
          <span style={cardStyles.detailIcon}>{'\uD83D\uDD50'}</span>
          <span style={cardStyles.detailText}>
            {formatTime(pharmacy.opens_at)} {'\u2013'} {formatTime(pharmacy.closes_at)}
          </span>
        </div>
        {pharmacy.phone && (
          <div style={cardStyles.detailRow}>
            <span style={cardStyles.detailIcon}>{'\uD83D\uDCDE'}</span>
            <a href={`tel:${pharmacy.phone}`} style={cardStyles.phoneLink}>
              {pharmacy.phone}
            </a>
          </div>
        )}
      </div>

      {/* Action */}
      <button
        style={{
          ...cardStyles.btn,
          ...cardStyles.btnOpen,
        }}
        onClick={onSearch}
      >
        {t('home.searchMedicines')}
      </button>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Add to Home Screen banner (Telegram WebApp API + Browser PWA)
// ---------------------------------------------------------------------------
const HOME_SCREEN_DISMISSED_KEY = 'home_screen_banner_dismissed';

// Store the browser beforeinstallprompt event globally so the banner can use it
let deferredPwaPrompt: BeforeInstallPromptEvent | null = null;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaPrompt = e as BeforeInstallPromptEvent;
  });
}

function AddToHomeScreenBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<'telegram' | 'browser' | null>(null);

  useEffect(() => {
    if (localStorage.getItem(HOME_SCREEN_DISMISSED_KEY)) return;

    const tg = window.Telegram?.WebApp;

    // Check Telegram first
    if (tg) {
      if (typeof tg.checkHomeScreenStatus === 'function') {
        tg.checkHomeScreenStatus((status: string) => {
          if (status === 'unsupported' || status === 'added') return;
          setMode('telegram');
          setVisible(true);
        });
        return;
      }
      if (typeof tg.addToHomeScreen === 'function') {
        setMode('telegram');
        setVisible(true);
        return;
      }
    }

    // Browser PWA install prompt
    if (deferredPwaPrompt) {
      setMode('browser');
      setVisible(true);
      return;
    }

    // Listen for the event if it hasn't fired yet
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPwaPrompt = e as BeforeInstallPromptEvent;
      if (!localStorage.getItem(HOME_SCREEN_DISMISSED_KEY)) {
        setMode('browser');
        setVisible(true);
      }
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleAdd = useCallback(async () => {
    if (mode === 'telegram') {
      window.Telegram?.WebApp?.addToHomeScreen?.();
    } else if (mode === 'browser' && deferredPwaPrompt) {
      await deferredPwaPrompt.prompt();
      const { outcome } = await deferredPwaPrompt.userChoice;
      if (outcome === 'accepted') {
        deferredPwaPrompt = null;
      }
    }
    setVisible(false);
    localStorage.setItem(HOME_SCREEN_DISMISSED_KEY, '1');
  }, [mode]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    localStorage.setItem(HOME_SCREEN_DISMISSED_KEY, '1');
  }, []);

  if (!visible) return null;

  return (
    <div style={bannerStyles.wrapper}>
      <div style={bannerStyles.content}>
        <span style={bannerStyles.icon}>{'\uD83D\uDCF2'}</span>
        <div style={bannerStyles.text}>
          <span style={bannerStyles.title}>{t('home.addToHomeScreen')}</span>
          <span style={bannerStyles.hint}>{t('home.addToHomeScreenHint')}</span>
        </div>
      </div>
      <div style={bannerStyles.actions}>
        <button style={bannerStyles.addBtn} onClick={handleAdd}>
          {t('home.addToHomeScreen')}
        </button>
        <button style={bannerStyles.dismissBtn} onClick={handleDismiss}>
          {'\u2715'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Home page
// ---------------------------------------------------------------------------
export default function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getPharmacies()
      .then((data) => {
        if (!cancelled) setPharmacies(data);
      })
      .catch(() => {
        if (!cancelled) setError(t('errors.networkError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  function handleSearchAtPharmacy(pharmacyId: string) {
    navigate(`/search?pharmacy_id=${pharmacyId}`);
  }

  return (
    <div style={styles.page}>
      {/* Hero */}
      <header style={styles.hero}>
        <h1 style={styles.heroTitle}>{t('home.title')}</h1>
        <p style={styles.heroSubtitle}>{t('home.subtitle')}</p>
      </header>

      {/* Add to home screen */}
      <AddToHomeScreenBanner />

      {/* Quick actions */}
      <div style={styles.quickActions}>
        <button style={styles.quickBtn} onClick={() => navigate('/search')}>
          <span style={styles.quickIcon}>{'\uD83D\uDD0D'}</span>
          <span style={styles.quickLabel}>{t('nav.search')}</span>
        </button>
        <button style={styles.quickBtn} onClick={() => navigate('/upload')}>
          <span style={styles.quickIcon}>{'\uD83D\uDCCB'}</span>
          <span style={styles.quickLabel}>{t('upload.title')}</span>
        </button>
        <button style={styles.quickBtn} onClick={() => navigate('/orders')}>
          <span style={styles.quickIcon}>{'\uD83D\uDCE6'}</span>
          <span style={styles.quickLabel}>{t('nav.orders')}</span>
        </button>
      </div>

      {/* Content */}
      <section style={styles.content}>
        {loading && (
          <div style={styles.center}>
            <div style={styles.spinner} />
          </div>
        )}

        {error && !loading && (
          <div style={styles.center}>
            <p style={styles.errorText}>{error}</p>
            <button
              style={styles.retryBtn}
              onClick={() => {
                setError(null);
                setLoading(true);
                getPharmacies()
                  .then((data) => setPharmacies(data))
                  .catch(() => setError(t('errors.networkError')))
                  .finally(() => setLoading(false));
              }}
            >
              {t('common.retry')}
            </button>
          </div>
        )}

        {!loading && !error && pharmacies.length === 0 && (
          <div style={styles.center}>
            <p style={styles.hint}>{t('common.error')}</p>
          </div>
        )}

        {!loading &&
          !error &&
          pharmacies.map((p) => (
            <PharmacyCard
              key={p.id}
              pharmacy={p}
              onSearch={() => handleSearchAtPharmacy(p.id)}
            />
          ))}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100%',
  },
  hero: {
    padding: '24px 16px 18px',
    background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)',
    color: '#fff',
  },
  heroTitle: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: -0.3,
  },
  heroSubtitle: {
    margin: '6px 0 0',
    fontSize: 14,
    opacity: 0.9,
  },
  quickActions: {
    display: 'flex',
    gap: 10,
    padding: '14px 16px 0',
  },
  quickBtn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    padding: '14px 8px',
    borderRadius: 12,
    border: 'none',
    background: 'var(--tg-theme-secondary-bg-color, #f5f5f5)',
    cursor: 'pointer',
    transition: 'transform 0.1s',
  },
  quickIcon: {
    fontSize: 22,
    lineHeight: 1,
  },
  quickLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--tg-theme-text-color, #333)',
  },
  content: {
    padding: '12px 16px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: 40,
    gap: 12,
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid var(--tg-theme-hint-color, #ddd)',
    borderTopColor: 'var(--tg-theme-button-color, #2196f3)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  hint: {
    color: 'var(--tg-theme-hint-color, #999)',
    margin: 0,
    fontSize: 14,
  },
  errorText: {
    color: '#e53935',
    margin: 0,
    fontSize: 14,
    textAlign: 'center',
  },
  retryBtn: {
    padding: '10px 24px',
    background: 'var(--tg-theme-button-color, #2196f3)',
    color: 'var(--tg-theme-button-text-color, #fff)',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
};

const bannerStyles: Record<string, React.CSSProperties> = {
  wrapper: {
    margin: '12px 16px 0',
    padding: '12px 14px',
    borderRadius: 12,
    background: 'linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  content: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  icon: {
    fontSize: 24,
    flexShrink: 0,
  },
  text: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  title: {
    fontSize: 13,
    fontWeight: 700,
    color: '#1565c0',
  },
  hint: {
    fontSize: 11,
    color: '#1976d2',
    opacity: 0.8,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  addBtn: {
    padding: '7px 14px',
    borderRadius: 8,
    border: 'none',
    background: '#1976d2',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  dismissBtn: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    border: 'none',
    background: 'transparent',
    color: '#1565c0',
    fontSize: 14,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
};

const cardStyles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--tg-theme-secondary-bg-color, #f9f9f9)',
    borderRadius: 14,
    padding: '16px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  icon: {
    fontSize: 22,
  },
  headerInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  name: {
    margin: 0,
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--tg-theme-text-color, #222)',
  },
  badge: {
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 12,
    width: 'fit-content',
  },
  badgeOpen: {
    background: '#e8f5e9',
    color: '#2e7d32',
  },
  badgeClosed: {
    background: '#fce4ec',
    color: '#c62828',
  },
  details: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  detailRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  detailIcon: {
    fontSize: 14,
    width: 18,
    textAlign: 'center',
    flexShrink: 0,
  },
  detailText: {
    fontSize: 13,
    color: 'var(--tg-theme-hint-color, #666)',
    lineHeight: 1.3,
  },
  phoneLink: {
    fontSize: 13,
    color: 'var(--tg-theme-link-color, #2196f3)',
    textDecoration: 'none',
    fontWeight: 500,
  },
  btn: {
    padding: '11px 0',
    borderRadius: 10,
    border: 'none',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
    transition: 'opacity 0.15s',
  },
  btnOpen: {
    background: 'var(--tg-theme-button-color, #2196f3)',
    color: 'var(--tg-theme-button-text-color, #fff)',
  },
  btnDisabled: {
    background: 'var(--tg-theme-hint-color, #ccc)',
    color: '#fff',
    cursor: 'not-allowed',
    opacity: 0.7,
  },
};
