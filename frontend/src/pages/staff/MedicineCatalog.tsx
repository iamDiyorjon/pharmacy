import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getMedicines,
  updateAvailability,
  uploadMedicinesExcel,
  type MedicineWithAvailability,
} from '../../services/api';

// ---------------------------------------------------------------------------
// Excel upload button
// ---------------------------------------------------------------------------
function ExcelUploadButton({ onUploaded }: { onUploaded: () => void }) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const stats = await uploadMedicinesExcel(file);
      setResult(
        `${t('staff.importSuccess')}: +${stats.new} / ~${stats.updated} / ${stats.errors} ${t('staff.importErrors')}`,
      );
      onUploaded();
    } catch {
      setError(t('errors.networkError'));
    } finally {
      setUploading(false);
      // Reset input so the same file can be re-selected
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div style={uploadStyles.wrapper}>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      <button
        style={styles.addBtn}
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? t('common.loading') : t('staff.importExcel')}
      </button>
      {result && <span style={uploadStyles.success}>{result}</span>}
      {error && <span style={uploadStyles.error}>{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MedicineCatalog page
// ---------------------------------------------------------------------------
export default function StaffMedicineCatalog() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [medicines, setMedicines] = useState<MedicineWithAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    try {
      const { medicines: data } = await getMedicines({ limit: 200 });
      setMedicines(data);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleToggle(medicineId: string, available: boolean) {
    try {
      await updateAvailability(medicineId, available);
      setMedicines((prev) =>
        prev.map((m) =>
          m.id === medicineId
            ? {
                ...m,
                availability: m.availability.map((a) => ({
                  ...a,
                  is_available: available,
                })),
              }
            : m,
        ),
      );
    } catch {
      /* silent */
    }
  }

  const filtered = search.trim()
    ? medicines.filter((m) => {
        const q = search.toLowerCase();
        return (
          m.name.toLowerCase().includes(q) ||
          m.name_ru?.toLowerCase().includes(q) ||
          m.name_uz?.toLowerCase().includes(q) ||
          m.category?.toLowerCase().includes(q)
        );
      })
    : medicines;

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>{t('staff.medicines')}</h1>
        <ExcelUploadButton onUploaded={load} />
      </header>

      {/* Search */}
      <div style={styles.searchWrapper}>
        <input
          style={styles.searchInput}
          placeholder={t('search.placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading && <p style={styles.hint}>{t('common.loading')}</p>}

      {!loading && filtered.length === 0 && (
        <p style={styles.hint}>{t('search.noResults')}</p>
      )}

      {/* Data table */}
      {!loading && filtered.length > 0 && (
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>{t('staff.medicineName')}</th>
                <th style={styles.th}>{t('staff.medicineNameRu')}</th>
                <th style={styles.th}>{t('staff.medicineNameUz')}</th>
                <th style={styles.th}>{t('staff.category')}</th>
                <th style={styles.thCenter}>Rx</th>
                <th style={styles.thCenter}>{t('medicine.availability')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const avail = m.availability[0];
                const isAvailable = avail?.is_available ?? false;
                const displayName =
                  (lang === 'uz' && m.name_uz) ||
                  (lang === 'ru' && m.name_ru) ||
                  m.name;

                return (
                  <tr key={m.id} style={styles.tr}>
                    <td style={styles.td}>
                      <span style={styles.medName}>{displayName}</span>
                    </td>
                    <td style={styles.td}>{m.name_ru ?? '—'}</td>
                    <td style={styles.td}>{m.name_uz ?? '—'}</td>
                    <td style={styles.td}>
                      {m.category ? (
                        <span style={styles.catBadge}>{m.category}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={styles.tdCenter}>
                      {m.requires_prescription && (
                        <span style={styles.rxBadge}>Rx</span>
                      )}
                    </td>
                    <td style={styles.tdCenter}>
                      <button
                        style={{
                          ...styles.toggleBtn,
                          ...(isAvailable ? styles.availableBtn : styles.unavailableBtn),
                        }}
                        onClick={() => handleToggle(m.id, !isAvailable)}
                      >
                        {isAvailable ? t('staff.available') : t('staff.unavailable')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100%' },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: { margin: 0, fontSize: 24, fontWeight: 700 },
  addBtn: {
    padding: '8px 18px',
    borderRadius: 8,
    border: 'none',
    background: '#1565c0',
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  searchWrapper: {
    marginBottom: 16,
  },
  searchInput: {
    width: '100%',
    maxWidth: 400,
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #ccc',
    fontSize: 14,
    boxSizing: 'border-box',
  },
  hint: {
    textAlign: 'center',
    color: '#999',
    padding: 24,
    margin: 0,
  },
  tableWrapper: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14,
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    fontWeight: 600,
    fontSize: 12,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    borderBottom: '1px solid #e0e0e0',
    whiteSpace: 'nowrap',
  },
  thCenter: {
    textAlign: 'center',
    padding: '10px 12px',
    fontWeight: 600,
    fontSize: 12,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    borderBottom: '1px solid #e0e0e0',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid #f0f0f0',
  },
  td: {
    padding: '12px',
    verticalAlign: 'middle',
  },
  tdCenter: {
    padding: '12px',
    verticalAlign: 'middle',
    textAlign: 'center',
  },
  medName: {
    fontWeight: 600,
    fontSize: 14,
  },
  catBadge: {
    fontSize: 12,
    padding: '2px 8px',
    borderRadius: 10,
    background: '#e3f2fd',
    color: '#1565c0',
  },
  rxBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: '#e65100',
    background: '#fff3e0',
    padding: '2px 8px',
    borderRadius: 4,
  },
  toggleBtn: {
    padding: '6px 16px',
    borderRadius: 20,
    border: 'none',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    minWidth: 90,
  },
  availableBtn: {
    background: '#e8f5e9',
    color: '#2e7d32',
  },
  unavailableBtn: {
    background: '#fce4ec',
    color: '#c62828',
  },
};

const uploadStyles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  success: {
    fontSize: 12,
    color: '#2e7d32',
    fontWeight: 500,
  },
  error: {
    fontSize: 12,
    color: '#e53935',
    fontWeight: 500,
  },
};
