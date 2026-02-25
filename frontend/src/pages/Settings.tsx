import { useTranslation } from 'react-i18next';

import LanguageToggle from '../components/LanguageToggle';

export default function Settings() {
  const { t } = useTranslation();
  const tg = window.Telegram?.WebApp;
  const user = tg?.initDataUnsafe?.user;

  const initials = user
    ? (user.first_name?.[0] ?? '') + (user.last_name?.[0] ?? '')
    : '?';

  return (
    <div style={styles.page}>
      {/* Header with avatar */}
      <header style={styles.hero}>
        <div style={styles.avatar}>
          <span style={styles.avatarText}>{initials.toUpperCase()}</span>
        </div>
        <h1 style={styles.heroTitle}>
          {user ? `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}` : t('settings.title')}
        </h1>
      </header>

      <div style={styles.content}>
        {/* Profile info */}
        {user && (
          <section style={styles.card}>
            <h2 style={styles.sectionTitle}>{t('settings.profile')}</h2>
            <Row label={t('settings.firstName')} value={user.first_name} />
            {user.last_name && (
              <Row label={t('settings.lastName')} value={user.last_name} />
            )}
          </section>
        )}

        {/* Language */}
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>{t('settings.language')}</h2>
          <LanguageToggle />
        </section>
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
};
