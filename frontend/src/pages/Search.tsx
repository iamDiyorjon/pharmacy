import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  searchMedicines,
  getPharmacies,
  getPopularMedicines,
  type Pharmacy,
  type MedicineWithAvailability,
} from '../services/api';

// ---------------------------------------------------------------------------
// Hook: debounced value
// ---------------------------------------------------------------------------
function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Quick search chip suggestions
// ---------------------------------------------------------------------------
const QUICK_CHIPS = [
  'Парацетамол',
  'Аспирин',
  'Ибупрофен',
  'Но-Шпа',
  'Витамин C',
  'Амоксициллин',
  'Бинт',
  'Лоратадин',
];

// ---------------------------------------------------------------------------
// Quantity Control (shared +/- stepper)
// ---------------------------------------------------------------------------
interface QtyControlProps {
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
  compact?: boolean;
}

function QtyControl({ quantity, onIncrement, onDecrement, compact }: QtyControlProps) {
  const size = compact ? 26 : 30;
  const fontSize = compact ? 14 : 16;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 4 : 6 }}>
      <button
        style={{
          ...qtyStyles.btn,
          width: size,
          height: size,
          fontSize,
          background: quantity <= 1 ? '#fce4ec' : 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
          color: quantity <= 1 ? '#c62828' : 'var(--tg-theme-text-color, #333)',
        }}
        onClick={(e) => { e.stopPropagation(); onDecrement(); }}
      >
        {quantity <= 1 ? '×' : '−'}
      </button>
      <span style={{ ...qtyStyles.value, fontSize: compact ? 13 : 14, minWidth: compact ? 20 : 24 }}>
        {quantity}
      </span>
      <button
        style={{
          ...qtyStyles.btn,
          width: size,
          height: size,
          fontSize,
          background: 'var(--tg-theme-button-color, #2196f3)',
          color: '#fff',
        }}
        onClick={(e) => { e.stopPropagation(); onIncrement(); }}
      >
        +
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Medicine Detail Modal
// ---------------------------------------------------------------------------
interface DetailModalProps {
  medicine: MedicineWithAvailability;
  pharmacyId: string;
  onClose: () => void;
}

function MedicineDetailModal({ medicine, pharmacyId, onClose }: DetailModalProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const displayName =
    (lang === 'uz' && medicine.name_uz) ||
    (lang === 'ru' && medicine.name_ru) ||
    medicine.name;

  const avail = medicine.availability.find((a) => a.pharmacy_id === pharmacyId);
  const price = avail?.price != null && avail.price > 0 ? avail.price : null;

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{displayName}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={modalStyles.body}>
          {/* Price */}
          {price != null && (
            <div style={modalStyles.priceRow}>
              <span style={modalStyles.priceValue}>
                {price.toLocaleString('ru-RU')} {t('common.sum')}
              </span>
            </div>
          )}

          {/* Info rows */}
          <div style={modalStyles.rows}>
            {medicine.manufacturer && (
              <div style={modalStyles.row}>
                <span style={modalStyles.label}>{t('search.manufacturer')}</span>
                <span style={modalStyles.value}>{medicine.manufacturer}</span>
              </div>
            )}
            {medicine.category && (
              <div style={modalStyles.row}>
                <span style={modalStyles.label}>{t('staff.category')}</span>
                <span style={modalStyles.value}>{medicine.category}</span>
              </div>
            )}
            {avail?.expiry_date && (
              <div style={modalStyles.row}>
                <span style={modalStyles.label}>{t('search.expiryDate')}</span>
                <span style={modalStyles.value}>
                  {new Date(avail.expiry_date).toLocaleDateString()}
                </span>
              </div>
            )}
            {avail?.quantity != null && avail.quantity > 0 && (
              <div style={modalStyles.row}>
                <span style={modalStyles.label}>{t('search.inStock')}</span>
                <span style={modalStyles.value}>
                  {avail.quantity} {t('search.pieces')}
                </span>
              </div>
            )}
            {medicine.requires_prescription && (
              <div style={modalStyles.row}>
                <span style={modalStyles.label}>{t('search.requiresPrescription')}</span>
                <span style={{ ...modalStyles.value, color: '#e65100' }}>✓</span>
              </div>
            )}
          </div>

          {/* Description */}
          {medicine.description && (
            <p style={modalStyles.description}>{medicine.description}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MedicineCard (for search results — detailed)
// ---------------------------------------------------------------------------
interface MedicineCardProps {
  medicine: MedicineWithAvailability;
  selectedPharmacyId: string;
  quantity: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  onViewDetail: () => void;
}

function MedicineCard({ medicine, selectedPharmacyId, quantity, onAdd, onIncrement, onDecrement, onViewDetail }: MedicineCardProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const displayName =
    (lang === 'uz' && medicine.name_uz) ||
    (lang === 'ru' && medicine.name_ru) ||
    medicine.name;

  const avail = medicine.availability.find((a) => a.pharmacy_id === selectedPharmacyId);
  const displayPrice = avail?.price != null && avail.price > 0 ? avail.price : null;
  const isAvailable = avail?.is_available ?? false;

  const formatPrice = (price: number) => {
    return price.toLocaleString('ru-RU') + ' ' + t('common.sum');
  };

  return (
    <div style={{ ...cardStyles.card, ...(! isAvailable ? { opacity: 0.5 } : {}) }}>
      <div style={cardStyles.row}>
        <div style={cardStyles.info}>
          <span style={cardStyles.name}>{displayName}</span>
          {displayPrice != null && (
            <span style={cardStyles.price}>{formatPrice(displayPrice)}</span>
          )}
          {!isAvailable && (
            <span style={cardStyles.unavailText}>{t('search.unavailable')}</span>
          )}
          {medicine.requires_prescription && (
            <span style={cardStyles.rxBadge}>{t('search.requiresPrescription')}</span>
          )}
          {medicine.category && (
            <span style={cardStyles.category}>{medicine.category}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button style={cardStyles.infoBtn} onClick={onViewDetail} title={t('search.details')}>
            ℹ
          </button>
          {isAvailable && (
            quantity > 0 ? (
              <QtyControl
                quantity={quantity}
                onIncrement={onIncrement}
                onDecrement={onDecrement}
              />
            ) : (
              <button style={cardStyles.addBtn} onClick={onAdd}>
                + {t('search.addToOrder')}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PopularCard (compact card for popular medicines grid)
// ---------------------------------------------------------------------------
interface PopularCardProps {
  medicine: MedicineWithAvailability;
  pharmacyId: string;
  quantity: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  onViewDetail: () => void;
}

function PopularCard({ medicine, pharmacyId, quantity, onAdd, onIncrement, onDecrement, onViewDetail }: PopularCardProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const displayName =
    (lang === 'uz' && medicine.name_uz) ||
    (lang === 'ru' && medicine.name_ru) ||
    medicine.name;

  const avail = medicine.availability.find((a) => a.pharmacy_id === pharmacyId);
  const price = avail?.price != null && avail.price > 0 ? avail.price : null;
  const inCart = quantity > 0;

  return (
    <div
      style={{
        ...popularStyles.card,
        ...(inCart ? { border: '2px solid var(--tg-theme-button-color, #1976d2)' } : { border: '2px solid transparent' }),
      }}
    >
      {/* Top section: icon + name + price (tappable to add first item) */}
      <div
        style={popularStyles.tapArea}
        onClick={() => { if (!inCart) onAdd(); }}
      >
        <div style={{
          ...popularStyles.iconBox,
          ...(inCart ? { background: '#bbdefb' } : {}),
        }}>
          <span style={popularStyles.icon}>💊</span>
        </div>
        <div style={popularStyles.name}>{displayName}</div>
        {price != null ? (
          <div style={popularStyles.price}>
            {price.toLocaleString('ru-RU')} {t('common.sum')}
          </div>
        ) : (
          <div style={popularStyles.price}>
            {t('search.available')}
          </div>
        )}
      </div>

      {/* Bottom: info + add */}
      <div style={popularStyles.bottomRow}>
        <button
          style={popularStyles.infoBtn}
          onClick={(e) => { e.stopPropagation(); onViewDetail(); }}
          title={t('search.details')}
        >
          ℹ
        </button>
        {inCart ? (
          <QtyControl
            quantity={quantity}
            onIncrement={onIncrement}
            onDecrement={onDecrement}
            compact
          />
        ) : (
          <button
            style={popularStyles.addBtn}
            onClick={(e) => { e.stopPropagation(); onAdd(); }}
          >
            + {t('search.addToOrder')}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search page
// ---------------------------------------------------------------------------

interface CartItem {
  medicine: MedicineWithAvailability;
  quantity: number;
}

export default function Search() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const preselectedPharmacyId = searchParams.get('pharmacy_id') ?? '';

  const [query, setQuery] = useState('');
  const [selectedPharmacyId, setSelectedPharmacyId] = useState(preselectedPharmacyId);
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [results, setResults] = useState<MedicineWithAvailability[]>([]);
  const [popular, setPopular] = useState<MedicineWithAvailability[]>([]);
  const [loading, setLoading] = useState(false);
  const [popularLoading, setPopularLoading] = useState(true);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [detailMedicine, setDetailMedicine] = useState<MedicineWithAvailability | null>(null);

  const debouncedQuery = useDebounce(query, 350);
  const inputRef = useRef<HTMLInputElement>(null);

  const isSearching = debouncedQuery.length >= 2;
  const pharmacySelected = selectedPharmacyId !== '';
  const selectedPharmacy = pharmacies.find((p) => p.id === selectedPharmacyId);

  // Helper: get quantity in cart for a medicine
  function getQty(medicineId: string): number {
    return cart.find((c) => c.medicine.id === medicineId)?.quantity ?? 0;
  }

  function selectPharmacy(id: string) {
    if (id !== selectedPharmacyId) {
      setCart([]); // Clear cart when pharmacy changes
      setResults([]);
      setQuery('');
    }
    setSelectedPharmacyId(id);
  }

  // Load pharmacy list once
  useEffect(() => {
    getPharmacies().then((data) => setPharmacies(data)).catch(() => {});
  }, []);

  // Load popular medicines (only when pharmacy selected)
  useEffect(() => {
    if (!pharmacySelected) {
      setPopular([]);
      return;
    }
    setPopularLoading(true);
    getPopularMedicines(selectedPharmacyId)
      .then((data) => setPopular(data))
      .catch(() => {})
      .finally(() => setPopularLoading(false));
  }, [selectedPharmacyId, pharmacySelected]);

  // Search when query changes (only when pharmacy selected)
  useEffect(() => {
    if (!pharmacySelected || debouncedQuery.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    searchMedicines({
      q: debouncedQuery,
      pharmacy_id: selectedPharmacyId,
    })
      .then(({ results: data }) => {
        if (!cancelled) setResults(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, selectedPharmacyId, pharmacySelected]);

  function addToCart(medicine: MedicineWithAvailability) {
    setCart((prev) => {
      const existing = prev.find((c) => c.medicine.id === medicine.id);
      if (existing) {
        return prev.map((c) =>
          c.medicine.id === medicine.id ? { ...c, quantity: c.quantity + 1 } : c,
        );
      }
      return [...prev, { medicine, quantity: 1 }];
    });
  }

  function incrementItem(medicineId: string) {
    setCart((prev) =>
      prev.map((c) =>
        c.medicine.id === medicineId ? { ...c, quantity: c.quantity + 1 } : c,
      ),
    );
  }

  function decrementItem(medicineId: string) {
    setCart((prev) => {
      const item = prev.find((c) => c.medicine.id === medicineId);
      if (!item) return prev;
      if (item.quantity <= 1) {
        return prev.filter((c) => c.medicine.id !== medicineId);
      }
      return prev.map((c) =>
        c.medicine.id === medicineId ? { ...c, quantity: c.quantity - 1 } : c,
      );
    });
  }

  function handleChipTap(chip: string) {
    setQuery(chip);
    inputRef.current?.focus();
  }

  function goToOrder() {
    navigate('/order', {
      state: {
        items: cart.map((c) => {
          const avail = c.medicine.availability.find((a) => a.pharmacy_id === selectedPharmacyId);
          return {
            medicine_id: c.medicine.id,
            medicine_name:
              c.medicine.name_uz || c.medicine.name_ru || c.medicine.name,
            quantity: c.quantity,
            unit_price: avail?.price ?? null,
          };
        }),
        pharmacy_id: selectedPharmacyId,
      },
    });
  }

  const totalItems = cart.reduce((s, c) => s + c.quantity, 0);

  return (
    <div style={styles.page}>
      {/* Hero header */}
      <div style={styles.hero}>
        <h1 style={styles.heroTitle}>{t('search.title')}</h1>
        {pharmacySelected && (
          <input
            ref={inputRef}
            style={styles.heroInput}
            type="search"
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('search.title')}
          />
        )}
      </div>

      {/* Selected pharmacy bar (tap to change) */}
      {pharmacySelected && (
        <div style={styles.pharmacyBar}>
          <div style={styles.pharmacyBarInfo}>
            <span style={styles.pharmacyBarName}>{selectedPharmacy?.name}</span>
            <span style={styles.pharmacyBarHint}>{selectedPharmacy?.address}</span>
          </div>
          <button style={styles.pharmacyBarChange} onClick={() => selectPharmacy('')}>
            {t('search.changePharmacy')}
          </button>
        </div>
      )}

      {/* Pharmacy picker (when none selected) */}
      {!pharmacySelected && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>{t('search.selectPharmacyFirst')}</h3>
          <div style={styles.pharmacyList}>
            {pharmacies.map((p) => (
              <button
                key={p.id}
                style={styles.pharmacyCard}
                onClick={() => selectPharmacy(p.id)}
              >
                <span style={styles.pharmacyCardName}>{p.name}</span>
                {p.address && (
                  <span style={styles.pharmacyCardAddr}>{p.address}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Everything below only shows when pharmacy is selected */}
      {pharmacySelected && (
        <>
          {/* Hint for short queries */}
          {query.length > 0 && query.length < 2 && (
            <p style={styles.hint}>{t('search.minChars')}</p>
          )}

          {/* Loading search */}
          {loading && <p style={styles.hint}>{t('search.searching')}</p>}

          {/* No results */}
          {!loading && isSearching && results.length === 0 && (
            <p style={styles.hint}>{t('search.noResults')}</p>
          )}

          {/* Search results */}
          {isSearching && (
            <div style={styles.results}>
              {results.map((m) => (
                <MedicineCard
                  key={m.id}
                  medicine={m}
                  selectedPharmacyId={selectedPharmacyId}
                  quantity={getQty(m.id)}
                  onAdd={() => addToCart(m)}
                  onIncrement={() => incrementItem(m.id)}
                  onDecrement={() => decrementItem(m.id)}
                  onViewDetail={() => setDetailMedicine(m)}
                />
              ))}
            </div>
          )}

          {/* Initial state: quick chips + popular medicines */}
          {!isSearching && (
            <>
              {/* Quick search chips */}
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>{t('search.quickSearch')}</h3>
                <div style={styles.chipsRow}>
                  {QUICK_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      style={styles.chip}
                      onClick={() => handleChipTap(chip)}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              {/* Popular medicines */}
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>{t('search.popular')}</h3>
                {popularLoading ? (
                  <p style={styles.hint}>{t('common.loading')}</p>
                ) : popular.length === 0 ? (
                  <p style={styles.hint}>{t('search.noResults')}</p>
                ) : (
                  <div style={styles.grid}>
                    {popular.map((m) => (
                      <PopularCard
                        key={m.id}
                        medicine={m}
                        pharmacyId={selectedPharmacyId}
                        quantity={getQty(m.id)}
                        onAdd={() => addToCart(m)}
                        onIncrement={() => incrementItem(m.id)}
                        onDecrement={() => decrementItem(m.id)}
                        onViewDetail={() => setDetailMedicine(m)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Cart FAB */}
          {cart.length > 0 && (
            <button style={styles.fab} onClick={goToOrder}>
              <span style={styles.fabIcon}>🛒</span>
              {t('order.newOrder')}
              <span style={styles.fabBadge}>{totalItems}</span>
            </button>
          )}
        </>
      )}

      {/* Detail modal */}
      {detailMedicine && (
        <MedicineDetailModal
          medicine={detailMedicine}
          pharmacyId={selectedPharmacyId}
          onClose={() => setDetailMedicine(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100%', paddingBottom: 80 },
  hero: {
    background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)',
    padding: '24px 16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  heroTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    color: '#fff',
  },
  heroInput: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    border: 'none',
    fontSize: 15,
    background: 'rgba(255,255,255,0.95)',
    color: '#222',
    boxSizing: 'border-box',
    outline: 'none',
  },
  pharmacyBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    background: 'var(--tg-theme-secondary-bg-color, #f5f5f5)',
    borderBottom: '1px solid rgba(0,0,0,0.06)',
    gap: 10,
  },
  pharmacyBarInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
    flex: 1,
  },
  pharmacyBarName: {
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--tg-theme-text-color, #222)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  pharmacyBarHint: {
    fontSize: 11,
    color: 'var(--tg-theme-hint-color, #888)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  pharmacyBarChange: {
    flexShrink: 0,
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid var(--tg-theme-button-color, #1976d2)',
    background: 'transparent',
    color: 'var(--tg-theme-button-color, #1976d2)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  pharmacyList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  pharmacyCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '14px 16px',
    borderRadius: 10,
    border: 'none',
    background: 'var(--tg-theme-secondary-bg-color, #f9f9f9)',
    cursor: 'pointer',
    textAlign: 'left',
    boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
  },
  pharmacyCardName: {
    fontSize: 15,
    fontWeight: 700,
    color: 'var(--tg-theme-text-color, #222)',
  },
  pharmacyCardAddr: {
    fontSize: 12,
    color: 'var(--tg-theme-hint-color, #888)',
  },
  hint: {
    textAlign: 'center',
    color: 'var(--tg-theme-hint-color, #999)',
    padding: '20px 16px 0',
    fontSize: 13,
    margin: 0,
  },
  results: {
    padding: '12px 16px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  section: {
    padding: '16px 16px 0',
  },
  sectionTitle: {
    margin: '0 0 10px',
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--tg-theme-text-color, #222)',
  },
  chipsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    padding: '7px 14px',
    borderRadius: 20,
    border: '1px solid var(--tg-theme-button-color, #1976d2)',
    background: 'transparent',
    color: 'var(--tg-theme-button-color, #1976d2)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 10,
  },
  fab: {
    position: 'fixed',
    bottom: 70,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'var(--tg-theme-button-color, #2196f3)',
    color: 'var(--tg-theme-button-text-color, #fff)',
    border: 'none',
    borderRadius: 24,
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  fabIcon: {
    fontSize: 18,
  },
  fabBadge: {
    background: '#fff',
    color: 'var(--tg-theme-button-color, #2196f3)',
    borderRadius: 12,
    padding: '2px 8px',
    fontSize: 12,
    fontWeight: 700,
    minWidth: 20,
    textAlign: 'center',
  },
};

const qtyStyles: Record<string, React.CSSProperties> = {
  btn: {
    borderRadius: 8,
    border: 'none',
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
    flexShrink: 0,
  },
  value: {
    fontWeight: 700,
    textAlign: 'center',
    color: 'var(--tg-theme-text-color, #222)',
  },
};

const cardStyles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--tg-theme-secondary-bg-color, #f9f9f9)',
    borderRadius: 10,
    padding: '12px 14px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  info: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--tg-theme-text-color, #222)',
  },
  price: {
    fontSize: 14,
    fontWeight: 700,
    color: '#2e7d32',
  },
  unavailText: {
    fontSize: 12,
    fontWeight: 600,
    color: '#c62828',
  },
  rxBadge: {
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: 4,
    background: '#fff3e0',
    color: '#e65100',
    width: 'fit-content',
  },
  category: {
    fontSize: 11,
    color: 'var(--tg-theme-hint-color, #888)',
  },
  addBtn: {
    flexShrink: 0,
    padding: '6px 10px',
    borderRadius: 7,
    border: 'none',
    background: 'var(--tg-theme-button-color, #2196f3)',
    color: 'var(--tg-theme-button-text-color, #fff)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  infoBtn: {
    flexShrink: 0,
    width: 30,
    height: 30,
    borderRadius: '50%',
    border: '1px solid var(--tg-theme-hint-color, #ccc)',
    background: 'transparent',
    color: 'var(--tg-theme-hint-color, #888)',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

const popularStyles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--tg-theme-secondary-bg-color, #f9f9f9)',
    borderRadius: 10,
    padding: '12px 10px 10px',
    textAlign: 'center',
    boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    transition: 'border-color 0.15s',
  },
  tapArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
    width: '100%',
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: '#e3f2fd',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.15s',
  },
  icon: {
    fontSize: 22,
  },
  name: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--tg-theme-text-color, #222)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    lineHeight: 1.3,
    minHeight: 31,
  },
  price: {
    fontSize: 11,
    color: '#2e7d32',
    fontWeight: 500,
    marginBottom: 4,
  },
  bottomRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
  },
  infoBtn: {
    flexShrink: 0,
    width: 26,
    height: 26,
    borderRadius: '50%',
    border: '1px solid var(--tg-theme-hint-color, #ccc)',
    background: 'transparent',
    color: 'var(--tg-theme-hint-color, #888)',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  addBtn: {
    flex: 1,
    padding: '6px 0',
    borderRadius: 7,
    border: 'none',
    background: 'var(--tg-theme-button-color, #2196f3)',
    color: '#fff',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
};

const modalStyles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '80vh',
    background: 'var(--tg-theme-bg-color, #fff)',
    borderRadius: '16px 16px 0 0',
    overflow: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px 12px',
    borderBottom: '1px solid rgba(0,0,0,0.06)',
  },
  title: {
    margin: 0,
    fontSize: 17,
    fontWeight: 700,
    color: 'var(--tg-theme-text-color, #222)',
    flex: 1,
    marginRight: 12,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: 'none',
    background: 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
    color: 'var(--tg-theme-hint-color, #888)',
    fontSize: 16,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  body: {
    padding: '16px 20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  priceRow: {
    padding: '10px 14px',
    borderRadius: 10,
    background: '#e8f5e9',
  },
  priceValue: {
    fontSize: 20,
    fontWeight: 700,
    color: '#1b5e20',
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    padding: '4px 0',
    borderBottom: '1px solid rgba(0,0,0,0.04)',
  },
  label: {
    fontSize: 14,
    color: 'var(--tg-theme-hint-color, #888)',
  },
  value: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--tg-theme-text-color, #222)',
    textAlign: 'right',
  },
  description: {
    margin: 0,
    fontSize: 13,
    color: 'var(--tg-theme-hint-color, #666)',
    lineHeight: 1.5,
  },
};
