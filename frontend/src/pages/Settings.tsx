import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import LanguageToggle from '../components/LanguageToggle';

export default function Settings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tg = window.Telegram?.WebApp;
  const tgUser = tg?.initDataUnsafe?.user;

  const isWebUser = !!localStorage.getItem('web_token');
  const webName = localStorage.getItem('user_name') || '';

  const displayName = tgUser
    ? `${tgUser.first_name}${tgUser.last_name ? ' ' + tgUser.last_name : ''}`
    : webName || t('settings.title');

  const initials = tgUser
    ? (tgUser.first_name?.[0] ?? '') + (tgUser.last_name?.[0] ?? '')
    : webName ? webName[0] : '?';

  const handleLogout = () => {
    localStorage.removeItem('web_token');
    localStorage.removeItem('staff_token');
    localStorage.removeItem('isStaff');
    localStorage.removeItem('user_name');
    navigate('/');
    window.location.reload();
  };

  return (
    <div style={styles.page}>
      {/* Header with avatar */}
      <header style={styles.hero}>
        <div style={styles.avatar}>
          <span style={styles.avatarText}>{initials.toUpperCase()}</span>
        </div>
        <h1 style={styles.heroTitle}>{displayName}</h1>
      </header>

      <div style={styles.content}>
        {/* Profile info */}
        {tgUser && (
          <section style={styles.card}>
            <h2 style={styles.sectionTitle}>{t('settings.profile')}</h2>
            <Row label={t('settings.firstName')} value={tgUser.first_name} />
            {tgUser.last_name && (
              <Row label={t('settings.lastName')} value={tgUser.last_name} />
            )}
          </section>
        )}

        {isWebUser && !tgUser && (
          <section style={styles.card}>
            <h2 style={styles.sectionTitle}>{t('settings.profile')}</h2>
            <Row label={t('settings.firstName')} value={webName} />
          </section>
        )}

        {/* Language */}
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>{t('settings.language')}</h2>
          <LanguageToggle />
        </section>

        {/* Logout for web users */}
        {isWebUser && (
          <button onClick={handleLogout} style={styles.logoutBtn}>
            {t('auth.logout', 'Chiqish')}
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
      <span style={{ fontSize: 14, color: 'var(--tg-theme-hint-color, #888)' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--tg-theme-text-color, #222)' }}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100%' },
  hero: {
    padding: '28px 16px 20px',
    background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '3px solid rgba(255,255,255,0.4)',
  },
  avatarText: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: 1,
  },
  heroTitle: {
    margin: 0,
    fontSize: 20,
    fontWeight: 700,
  },
  content: {
    padding: '12px 16px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  card: {
    padding: '14px',
    background: 'var(--tg-theme-secondary-bg-color, #f5f5f5)',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--tg-theme-hint-color, #666)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  logoutBtn: {
    padding: '14px',
    fontSize: 15,
    fontWeight: 600,
    color: '#d32f2f',
    background: '#ffeaea',
    border: 'none',
    borderRadius: 12,
    cursor: 'pointer',
    marginTop: 4,
  },
};
