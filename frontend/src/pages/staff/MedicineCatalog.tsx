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
// MedicineRow
// ---------------------------------------------------------------------------
interface MedicineRowProps {
  medicine: MedicineWithAvailability;
  onToggle: (id: string, available: boolean) => void;
}

function MedicineRow({ medicine, onToggle }: MedicineRowProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const displayName =
    (lang === 'uz' && medicine.name_uz) ||
    (lang === 'ru' && medicine.name_ru) ||
    medicine.name;

  // Pick availability for current staff's pharmacy (first entry, or first available)
  const avail = medicine.availability[0];
  const isAvailable = avail?.is_available ?? false;

  return (
    <div style={rowStyles.row}>
      <div style={rowStyles.info}>
        <span style={rowStyles.name}>{displayName}</span>
        {medicine.category && <span style={rowStyles.cat}>{medicine.category}</span>}
        {medicine.requires_prescription && (
          <span style={rowStyles.rx}>{t('staff.requiresPrescription')}</span>
        )}
      </div>
      <button
        style={{
          ...rowStyles.toggleBtn,
          ...(isAvailable ? rowStyles.available : rowStyles.unavailable),
        }}
        onClick={() => onToggle(medicine.id, !isAvailable)}
        aria-label={t('staff.toggleAvailability')}
      >
        {isAvailable ? t('staff.available') : t('staff.unavailable')}
      </button>
    </div>
  );
}

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

      {[
        { key: 'name' as const, label: t('staff.medicineName'), required: true },
        { key: 'name_ru' as const, label: t('staff.medicineNameRu') },
        { key: 'name_uz' as const, label: t('staff.medicineNameUz') },
        { key: 'category' as const, label: t('staff.category') },
        { key: 'description' as const, label: t('staff.description') },
      ].map(({ key, label, required }) => (
        <div key={key}>
          <label style={formStyles.label}>{label}{required && ' *'}</label>
          <input
            style={formStyles.input}
            value={(form[key] as string) ?? ''}
            onChange={(e) => set(key, e.target.value)}
            placeholder={label}
          />
        </div>
      ))}

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
  );
}

// ---------------------------------------------------------------------------
// MedicineCatalog page
// ---------------------------------------------------------------------------
export default function StaffMedicineCatalog() {
  const { t } = useTranslation();
  const [medicines, setMedicines] = useState<MedicineWithAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { medicines: data } = await getMedicines({ limit: 100 });
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

      {loading && <p style={styles.hint}>{t('common.loading')}</p>}

      <div style={styles.list}>
        {!loading &&
          medicines.map((m) => (
            <MedicineRow key={m.id} medicine={m} onToggle={handleToggle} />
          ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100%', paddingBottom: 16 },
  header: {
    padding: '16px 16px 0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { margin: 0, fontSize: 20, fontWeight: 700 },
  addBtn: {
    padding: '6px 14px',
    borderRadius: 8,
    border: 'none',
    background: 'var(--tg-theme-button-color, #2196f3)',
    color: 'var(--tg-theme-button-text-color, #fff)',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  hint: { textAlign: 'center', color: 'var(--tg-theme-hint-color, #999)', padding: '24px', margin: 0 },
  list: { padding: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 },
};

const rowStyles: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: 'var(--tg-theme-secondary-bg-color, #f5f5f5)',
    borderRadius: 8,
    padding: '10px 12px',
  },
  info: { flex: 1, display: 'flex', flexDirection: 'column', gap: 3 },
  name: { fontSize: 14, fontWeight: 600 },
  cat: { fontSize: 11, color: 'var(--tg-theme-hint-color, #888)' },
  rx: {
    fontSize: 10,
    fontWeight: 600,
    color: '#e65100',
    background: '#fff3e0',
    padding: '1px 6px',
    borderRadius: 4,
    width: 'fit-content',
  },
  toggleBtn: {
    flexShrink: 0,
    padding: '6px 12px',
    borderRadius: 20,
    border: 'none',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  available: { background: '#e8f5e9', color: '#2e7d32' },
  unavailable: { background: '#fce4ec', color: '#c62828' },
};

const formStyles: Record<string, React.CSSProperties> = {
  wrapper: {
    margin: '12px 16px 0',
    padding: '14px',
    background: 'var(--tg-theme-secondary-bg-color, #f5f5f5)',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  title: { margin: 0, fontSize: 15, fontWeight: 700 },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--tg-theme-hint-color, #666)', display: 'block', marginBottom: 4 },
  input: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 7,
    border: '1px solid var(--tg-theme-hint-color, #ccc)',
    fontSize: 14,
    background: 'var(--tg-theme-bg-color, #fff)',
    color: 'var(--tg-theme-text-color, #222)',
    boxSizing: 'border-box',
  },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8 },
  checkLabel: { fontSize: 13, fontWeight: 500 },
  error: { color: '#e53935', fontSize: 12, margin: 0 },
  submitBtn: {
    padding: '10px 0',
    borderRadius: 8,
    border: 'none',
    background: 'var(--tg-theme-button-color, #2196f3)',
    color: 'var(--tg-theme-button-text-color, #fff)',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
};
