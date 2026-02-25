import { useTranslation } from 'react-i18next';

type Lang = 'uz' | 'ru' | 'en';

const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'uz', label: 'UZ' },
  { code: 'ru', label: 'RU' },
  { code: 'en', label: 'EN' },
];

export default function LanguageToggle() {
  const { i18n } = useTranslation();
  const current = i18n.language as Lang;

  function handleSelect(lang: Lang) {
    i18n.changeLanguage(lang);
    localStorage.setItem('lang', lang);
  }

  return (
    <div style={styles.wrapper} aria-label="Language selector">
      {LANGUAGES.map(({ code, label }, idx) => (
        <button
          key={code}
          onClick={() => handleSelect(code)}
          style={{
            ...styles.btn,
            ...(idx === 0 ? styles.first : {}),
            ...(idx === LANGUAGES.length - 1 ? styles.last : {}),
            ...(current === code ? styles.active : styles.inactive),
          }}
          aria-pressed={current === code}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'inline-flex',
    borderRadius: 8,
    overflow: 'hidden',
    border: '1px solid var(--tg-theme-button-color, #2196f3)',
  },
  btn: {
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    border: 'none',
    borderLeft: '1px solid var(--tg-theme-button-color, #2196f3)',
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
    letterSpacing: 0.4,
  },
  first: {
    borderLeft: 'none',
  },
  last: {},
  active: {
    background: 'var(--tg-theme-button-color, #2196f3)',
    color: 'var(--tg-theme-button-text-color, #fff)',
  },
  inactive: {
    background: 'transparent',
    color: 'var(--tg-theme-text-color, #222)',
  },
};
