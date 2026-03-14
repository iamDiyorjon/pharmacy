import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { webLogin } from '../services/api';

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await webLogin(phone, password);
      localStorage.setItem('web_token', res.access_token);
      localStorage.setItem('user_name', res.first_name || '');
      if (res.is_staff) {
        localStorage.setItem('isStaff', 'true');
      }
      navigate('/', { replace: true });
      window.location.reload();
    } catch {
      setError(t('auth.invalidCredentials', 'Telefon yoki parol noto\'g\'ri'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.logo}>+</div>
        <h1 style={styles.title}>Pharmacy</h1>
        <p style={styles.subtitle}>{t('auth.loginSubtitle', 'Hisobingizga kiring')}</p>
      </div>

      <form onSubmit={handleSubmit} style={styles.form}>
        {error && <div style={styles.error}>{error}</div>}

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
          <div style={styles.passwordWrapper}>
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="****"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ ...styles.input, width: '100%', paddingRight: 44 }}
              required
              minLength={4}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              style={styles.eyeButton}
            >
              {showPassword ? (
                <svg width="20" height="20" fill="none" stroke="#888" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18" />
                </svg>
              ) : (
                <svg width="20" height="20" fill="none" stroke="#888" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <button type="submit" style={styles.button} disabled={loading}>
          {loading ? '...' : t('auth.login', 'Kirish')}
        </button>

        <p style={styles.hint}>
          {t('auth.staffOnly', 'Faqat apteka xodimlari uchun')}
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
  passwordWrapper: {
    position: 'relative',
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
  },
  hint: {
    textAlign: 'center',
    fontSize: 13,
    color: '#aaa',
    margin: 0,
  },
};
