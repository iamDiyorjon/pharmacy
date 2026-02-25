import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { webRegister } from '../services/api';

export default function Register() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await webRegister(phone, password, firstName);
      localStorage.setItem('web_token', res.access_token);
      localStorage.setItem('user_name', res.first_name || '');
      navigate('/', { replace: true });
      window.location.reload();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (detail === 'Phone number already registered') {
        setError(t('auth.phoneExists', 'Bu telefon raqam allaqachon ro\'yxatdan o\'tgan'));
      } else {
        setError(t('auth.registerError', 'Xatolik yuz berdi'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.logo}>+</div>
        <h1 style={styles.title}>Pharmacy</h1>
        <p style={styles.subtitle}>{t('auth.registerSubtitle', 'Yangi hisob yarating')}</p>
      </div>

      <form onSubmit={handleSubmit} style={styles.form}>
        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.field}>
          <label style={styles.label}>{t('auth.firstName', 'Ismingiz')}</label>
          <input
            type="text"
            placeholder="Diyorjon"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            style={styles.input}
            required
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>{t('auth.phone', 'Telefon raqam')}</label>
          <input
            type="tel"
            placeholder="+998901234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={styles.input}
            required
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>{t('auth.password', 'Parol')}</label>
          <input
            type="password"
            placeholder="Kamida 4 ta belgi"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            required
            minLength={4}
          />
        </div>

        <button type="submit" style={styles.button} disabled={loading}>
          {loading ? '...' : t('auth.register', 'Ro\'yxatdan o\'tish')}
        </button>

        <p style={styles.link}>
          {t('auth.hasAccount', 'Hisobingiz bormi?')}{' '}
          <Link to="/login" style={styles.linkText}>
            {t('auth.login', 'Kirish')}
          </Link>
        </p>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    background: '#fff',
  },
  header: {
    textAlign: 'center',
    marginBottom: 32,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #1976d2, #1565c0)',
    color: '#fff',
    fontSize: 32,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 12px',
  },
  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    color: '#222',
  },
  subtitle: {
    margin: '4px 0 0',
    fontSize: 14,
    color: '#888',
  },
  form: {
    width: '100%',
    maxWidth: 360,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: '#555',
  },
  input: {
    padding: '12px 14px',
    fontSize: 16,
    border: '1.5px solid #ddd',
    borderRadius: 10,
    outline: 'none',
    background: '#fafafa',
  },
  button: {
    padding: '14px',
    fontSize: 16,
    fontWeight: 600,
    color: '#fff',
    background: 'linear-gradient(135deg, #1976d2, #1565c0)',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    marginTop: 4,
  },
  error: {
    padding: '10px 14px',
    background: '#ffeaea',
    color: '#d32f2f',
    borderRadius: 8,
    fontSize: 14,
  },
  link: {
    textAlign: 'center',
    fontSize: 14,
    color: '#888',
    margin: 0,
  },
  linkText: {
    color: '#1976d2',
    fontWeight: 600,
    textDecoration: 'none',
  },
};
