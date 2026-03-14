import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  getPharmacies,
  createOrder,
  uploadPrescription,
  type Pharmacy,
} from '../services/api';

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png'];

export default function Upload() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [pharmacyId, setPharmacyId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPharmacies().then((data) => setPharmacies(data)).catch(() => {});
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (!ALLOWED_TYPES.includes(selected.type)) {
      setError(t('errors.invalidFileType'));
      return;
    }
    if (selected.size > MAX_SIZE_BYTES) {
      setError(t('errors.fileTooLarge'));
      return;
    }

    setError(null);
    setFile(selected);
    const url = URL.createObjectURL(selected);
    setPreview(url);
  }

  function removeFile() {
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSubmit() {
    if (!pharmacyId) { setError(t('upload.selectPharmacy')); return; }
    if (!file) { setError(t('upload.selectFile')); return; }

    setError(null);
    setSubmitting(true);
    try {
      const order = await createOrder({
        pharmacy_id: pharmacyId,
        order_type: 'prescription',
      });
      await uploadPrescription(order.id, file);
      navigate(`/order/${order.id}`);
    } catch {
      setError(t('errors.networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.page}>
      {/* Hero */}
      <header style={styles.hero}>
        <span style={styles.heroIcon}>{'\uD83D\uDCCB'}</span>
        <h1 style={styles.heroTitle}>{t('upload.title')}</h1>
        <p style={styles.heroSubtitle}>{t('upload.instructions')}</p>
      </header>

      <div style={styles.form}>
        {/* Pharmacy selector */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>{t('upload.selectPharmacy')}</label>
          <select
            style={styles.select}
            value={pharmacyId}
            onChange={(e) => setPharmacyId(e.target.value)}
          >
            <option value="">{t('upload.selectPharmacy')}</option>
            {pharmacies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* File picker */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>{t('upload.selectFile')}</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {!preview ? (
            <button
              style={styles.uploadArea}
              onClick={() => fileInputRef.current?.click()}
            >
              <span style={styles.uploadIcon}>{'\uD83D\uDCF7'}</span>
              <span style={styles.uploadText}>{t('upload.selectFile')}</span>
              <span style={styles.uploadHint}>
                {t('upload.allowedFormats')} {'\u00B7'} {t('upload.maxSize')}
              </span>
            </button>
          ) : (
            <div style={styles.previewCard}>
              <img src={preview} alt={t('upload.preview')} style={styles.previewImg} />
              <div style={styles.previewOverlay}>
                <button style={styles.changeBtn} onClick={() => fileInputRef.current?.click()}>
                  {'\uD83D\uDD04'}
                </button>
                <button style={styles.removeBtn} onClick={removeFile}>
                  {'\u00D7'}
                </button>
              </div>
              {file && (
                <div style={styles.fileInfo}>
                  <span style={styles.fileName}>{file.name}</span>
                  <span style={styles.fileSize}>
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div style={styles.errorBox}>
            <p style={styles.errorText}>{error}</p>
          </div>
        )}

        <button
          style={{
            ...styles.submitBtn,
            opacity: submitting || !file ? 0.6 : 1,
          }}
          onClick={handleSubmit}
          disabled={submitting || !file}
        >
          {submitting ? t('upload.submitting') : t('upload.submit')}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100%', paddingBottom: 16 },
  hero: {
    padding: '24px 16px 20px',
    background: 'linear-gradient(135deg, #7b1fa2 0%, #6a1b9a 100%)',
    color: '#fff',
    textAlign: 'center',
  },
  heroIcon: { fontSize: 36, display: 'block', marginBottom: 8 },
  heroTitle: { margin: 0, fontSize: 22, fontWeight: 700 },
  heroSubtitle: { margin: '6px 0 0', fontSize: 14, opacity: 0.9 },
  form: { padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--tg-theme-hint-color, #666)',
  },
  select: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    border: '1.5px solid var(--tg-theme-hint-color, #ddd)',
    fontSize: 14,
    background: 'var(--tg-theme-secondary-bg-color, #f5f5f5)',
    color: 'var(--tg-theme-text-color, #222)',
  },
  uploadArea: {
    padding: '32px 16px',
    borderRadius: 14,
    border: '2px dashed var(--tg-theme-button-color, #7b1fa2)',
    background: 'var(--tg-theme-secondary-bg-color, #faf5ff)',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  uploadIcon: { fontSize: 36, opacity: 0.7 },
  uploadText: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--tg-theme-button-color, #7b1fa2)',
  },
  uploadHint: {
    fontSize: 12,
    color: 'var(--tg-theme-hint-color, #999)',
    textAlign: 'center',
  },
  previewCard: {
    borderRadius: 14,
    overflow: 'hidden',
    border: '1.5px solid var(--tg-theme-hint-color, #ddd)',
    position: 'relative',
  },
  previewImg: {
    width: '100%',
    maxHeight: 280,
    objectFit: 'cover',
    display: 'block',
  },
  previewOverlay: {
    position: 'absolute',
    top: 10,
    right: 10,
    display: 'flex',
    gap: 6,
  },
  changeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    border: 'none',
    background: 'rgba(0,0,0,0.5)',
    color: '#fff',
    fontSize: 16,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    border: 'none',
    background: 'rgba(198,40,40,0.85)',
    color: '#fff',
    fontSize: 20,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  },
  fileInfo: {
    padding: '10px 14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'var(--tg-theme-secondary-bg-color, #f5f5f5)',
  },
  fileName: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--tg-theme-text-color, #333)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  fileSize: {
    fontSize: 12,
    color: 'var(--tg-theme-hint-color, #888)',
    flexShrink: 0,
    marginLeft: 8,
  },
  errorBox: {
    padding: '10px 14px',
    background: '#ffebee',
    borderRadius: 10,
    borderLeft: '4px solid #e53935',
  },
  errorText: {
    color: '#c62828',
    fontSize: 13,
    margin: 0,
    fontWeight: 500,
  },
  submitBtn: {
    marginTop: 4,
    padding: '14px 0',
    borderRadius: 12,
    border: 'none',
    background: 'linear-gradient(135deg, #7b1fa2 0%, #6a1b9a 100%)',
    color: '#fff',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
};
