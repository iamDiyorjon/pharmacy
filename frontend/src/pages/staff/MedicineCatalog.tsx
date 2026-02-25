import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getMedicines,
  addMedicine,
  updateAvailability,
  type MedicineWithAvailability,
  type CreateMedicineRequest,
} from '../../services/api';

// ---------------------------------------------------------------------------
// Add medicine form
// ---------------------------------------------------------------------------
const EMPTY_FORM: CreateMedicineRequest = {
  name: '',
  name_ru: '',
  name_uz: '',
  description: '',
  category: '',
  requires_prescription: false,
  is_available: true,
};

function AddMedicineForm({ onAdded }: { onAdded: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CreateMedicineRequest>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof CreateMedicineRequest>(
    key: K,
    value: CreateMedicineRequest[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await addMedicine({
        ...form,
        name_ru: form.name_ru || undefined,
        name_uz: form.name_uz || undefined,
        description: form.description || undefined,
        category: form.category || undefined,
      });
      setForm(EMPTY_FORM);
      onAdded();
    } catch {
      setError(t('errors.networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={formStyles.wrapper}>
      <h3 style={formStyles.title}>{t('staff.addMedicine')}</h3>
      <div style={formStyles.row}>
        {[
          { key: 'name' as const, label: t('staff.medicineName'), required: true },
          { key: 'name_ru' as const, label: t('staff.medicineNameRu') },
          { key: 'name_uz' as const, label: t('staff.medicineNameUz') },
          { key: 'category' as const, label: t('staff.category') },
        ].map(({ key, label, required }) => (
          <div key={key} style={formStyles.field}>
            <label style={formStyles.label}>
              {label}
              {required && ' *'}
            </label>
            <input
              style={formStyles.input}
              value={(form[key] as string) ?? ''}
              onChange={(e) => set(key, e.target.value)}
              placeholder={label}
            />
          </div>
        ))}
      </div>
      <div style={formStyles.field}>
        <label style={formStyles.label}>{t('staff.description')}</label>
        <input
          style={formStyles.input}
          value={form.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
          placeholder={t('staff.description')}
        />
      </div>
      <div style={formStyles.bottomRow}>
        <div style={formStyles.checkRow}>
          <input
            id="rx-check"
            type="checkbox"
            checked={form.requires_prescription}
            onChange={(e) => set('requires_prescription', e.target.checked)}
          />
          <label htmlFor="rx-check" style={formStyles.checkLabel}>
            {t('staff.requiresPrescription')}
          </label>
        </div>
        {error && <p style={formStyles.error}>{error}</p>}
        <button
          style={formStyles.submitBtn}
          onClick={handleSubmit}
          disabled={submitting || !form.name.trim()}
        >
          {submitting ? t('common.loading') : t('staff.addMedicine')}
        </button>
      </div>
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
  const [showAddForm, setShowAddForm] = useState(false);
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
        <button
          style={styles.addBtn}
          onClick={() => setShowAddForm((v) => !v)}
        >
          {showAddForm ? t('common.close') : `+ ${t('staff.addMedicine')}`}
        </button>
      </header>

      {showAddForm && (
        <AddMedicineForm
          onAdded={() => {
            setShowAddForm(false);
            load();
          }}
        />
      )}

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

const formStyles: Record<string, React.CSSProperties> = {
  wrapper: {
    marginBottom: 20,
    padding: 20,
    background: '#f8f9fa',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  title: { margin: 0, fontSize: 16, fontWeight: 700 },
  row: {
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap',
  },
  field: {
    flex: '1 1 200px',
    minWidth: 0,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: '#666',
    display: 'block',
    marginBottom: 4,
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 7,
    border: '1px solid #ccc',
    fontSize: 14,
    boxSizing: 'border-box',
  },
  bottomRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
  },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8 },
  checkLabel: { fontSize: 13, fontWeight: 500 },
  error: { color: '#e53935', fontSize: 12, margin: 0 },
  submitBtn: {
    padding: '10px 24px',
    borderRadius: 8,
    border: 'none',
    background: '#1565c0',
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    marginLeft: 'auto',
  },
};
