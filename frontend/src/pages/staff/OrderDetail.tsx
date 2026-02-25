import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  getStaffOrder,
  priceOrder,
  readyOrder,
  completeOrder,
  rejectOrder,
  type StaffOrder,
  type PriceOrderItem,
} from '../../services/api';

export default function StaffOrderDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [order, setOrder] = useState<StaffOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Pricing state
  const [totalPrice, setTotalPrice] = useState('');
  const [itemPrices, setItemPrices] = useState<Record<string, string>>({});

  // Rejection state
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  const fetchOrder = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getStaffOrder(id);
      setOrder(data);
      // Pre-fill item prices map
      const prices: Record<string, string> = {};
      data.items.forEach((item) => {
        prices[item.id] = item.unit_price?.toString() ?? '';
      });
      setItemPrices(prices);
    } catch {
      setError(t('errors.orderNotFound'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  async function handlePrice() {
    if (!id || !totalPrice) return;
    setActionLoading(true);
    try {
      const items: PriceOrderItem[] = Object.entries(itemPrices)
        .filter(([, v]) => v !== '')
        .map(([order_item_id, unit_price]) => ({
          order_item_id,
          unit_price: parseFloat(unit_price),
        }));

      const updated = await priceOrder(id, {
        total_price: parseFloat(totalPrice),
        items: items.length > 0 ? items : undefined,
      });
      setOrder((prev) => prev ? { ...prev, ...updated } : null);
    } catch {
      setError(t('errors.networkError'));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReady() {
    if (!id) return;
    setActionLoading(true);
    try {
      const updated = await readyOrder(id);
      setOrder((prev) => prev ? { ...prev, ...updated } : null);
    } catch {
      setError(t('errors.networkError'));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleComplete() {
    if (!id) return;
    setActionLoading(true);
    try {
      const updated = await completeOrder(id);
      setOrder((prev) => prev ? { ...prev, ...updated } : null);
    } catch {
      setError(t('errors.networkError'));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject() {
    if (!id || !rejectionReason.trim()) return;
    setActionLoading(true);
    try {
      const updated = await rejectOrder(id, rejectionReason);
      setOrder((prev) => prev ? { ...prev, ...updated } : null);
      setShowRejectForm(false);
    } catch {
      setError(t('errors.networkError'));
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <div style={styles.center}><p>{t('common.loading')}</p></div>;
  if (error && !order) return <div style={styles.center}><p style={styles.errText}>{error}</p></div>;
  if (!order) return null;

  const isTerminal = ['completed', 'cancelled', 'rejected'].includes(order.status);

  return (
    <div style={styles.page}>
      {/* Back button */}
      <button style={styles.backBtn} onClick={() => navigate('/staff')}>
        ← {t('common.back')}
      </button>

      <header style={styles.header}>
        <h1 style={styles.title}>#{order.order_number}</h1>
        <span style={styles.status}>{t(`orderStatus.status.${order.status}`)}</span>
      </header>

      {/* Customer info */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>{t('staff.customerInfo')}</h2>
        <Row label={t('settings.firstName')} value={order.user_first_name} />
        {order.user_phone && <Row label={t('settings.phone')} value={order.user_phone} />}
      </section>

      {/* Order items */}
      {order.items.length > 0 && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>{t('order.medicines')}</h2>
          {order.items.map((item) => (
            <div key={item.id} style={styles.itemRow}>
              <span style={styles.itemName}>{item.medicine_name}</span>
              <span style={styles.itemQty}>×{item.quantity}</span>
              {/* Per-item price input (visible when status is created) */}
              {order.status === 'created' && (
                <input
                  style={styles.priceInput}
                  type="number"
                  min="0"
                  placeholder="0"
                  value={itemPrices[item.id] ?? ''}
                  onChange={(e) =>
                    setItemPrices((prev) => ({ ...prev, [item.id]: e.target.value }))
                  }
                />
              )}
              {item.unit_price !== null && order.status !== 'created' && (
                <span style={styles.itemPrice}>
                  {item.unit_price.toLocaleString()} {order.currency}
                </span>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Prescription images */}
      {order.prescriptions.length > 0 && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>{t('staff.prescriptionImage')}</h2>
          {order.prescriptions.map((p) => (
            <div key={p.id} style={styles.prescriptionWrapper}>
              <a href={p.download_url} target="_blank" rel="noreferrer">
                <img
                  src={p.download_url}
                  alt={p.file_name}
                  style={styles.prescriptionImg}
                  loading="lazy"
                />
              </a>
            </div>
          ))}
        </section>
      )}

      {/* Notes */}
      {order.notes && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>{t('order.notes')}</h2>
          <p style={styles.notes}>{order.notes}</p>
        </section>
      )}

      {/* Pricing form */}
      {order.status === 'created' && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>{t('staff.priceOrder')}</h2>
          <input
            style={styles.totalInput}
            type="number"
            min="0"
            placeholder={t('staff.totalPrice')}
            value={totalPrice}
            onChange={(e) => setTotalPrice(e.target.value)}
          />
          <button
            style={styles.primaryBtn}
            onClick={handlePrice}
            disabled={actionLoading || !totalPrice}
          >
            {t('staff.priceOrder')}
          </button>
        </section>
      )}

      {/* Payment status badge */}
      {order.payment_method && (
        <section style={styles.section}>
          <Row
            label={t('orderStatus.paymentMethod.cash')}
            value={
              order.payment_method === 'cash'
                ? t('staff.paymentStatus.cash')
                : order.payment_status === 'paid'
                ? t('staff.paymentStatus.paid')
                : t('staff.paymentStatus.pending')
            }
          />
        </section>
      )}

      {error && <p style={styles.errText}>{error}</p>}

      {/* Action buttons */}
      {!isTerminal && (
        <div style={styles.actions}>
          {order.status === 'confirmed' && (
            <button
              style={styles.primaryBtn}
              onClick={handleReady}
              disabled={actionLoading}
            >
              {t('staff.markReady')}
            </button>
          )}
          {order.status === 'ready' && (
            <button
              style={styles.primaryBtn}
              onClick={handleComplete}
              disabled={actionLoading}
            >
              {t('staff.markComplete')}
            </button>
          )}
          {!showRejectForm && ['created', 'priced', 'confirmed'].includes(order.status) && (
            <button
              style={styles.dangerBtn}
              onClick={() => setShowRejectForm(true)}
              disabled={actionLoading}
            >
              {t('staff.rejectOrder')}
            </button>
          )}
          {showRejectForm && (
            <>
              <textarea
                style={styles.reasonInput}
                placeholder={t('staff.rejectionReasonPlaceholder')}
                value={rejectionReason}
                rows={3}
                onChange={(e) => setRejectionReason(e.target.value)}
              />
              <button
                style={styles.dangerBtn}
                onClick={handleReject}
                disabled={actionLoading || !rejectionReason.trim()}
              >
                {t('staff.rejectOrder')}
              </button>
              <button
                style={styles.secondaryBtn}
                onClick={() => setShowRejectForm(false)}
              >
                {t('common.cancel')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component
// ---------------------------------------------------------------------------
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}>
      <span style={{ fontSize: 13, color: 'var(--tg-theme-hint-color, #888)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100%', paddingBottom: 24 },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' },
  backBtn: {
    margin: '12px 16px 0',
    padding: '6px 12px',
    border: 'none',
    background: 'transparent',
    color: 'var(--tg-theme-button-color, #2196f3)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'block',
  },
  header: {
    padding: '8px 16px 0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { margin: 0, fontSize: 20, fontWeight: 700 },
  status: {
    fontSize: 12,
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: 20,
    background: 'var(--tg-theme-secondary-bg-color, #eee)',
  },
  section: {
    margin: '12px 16px 0',
    padding: '12px 14px',
    background: 'var(--tg-theme-secondary-bg-color, #f5f5f5)',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  sectionTitle: { margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--tg-theme-hint-color, #666)' },
  itemRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  itemName: { flex: 1, fontSize: 14, fontWeight: 500 },
  itemQty: { fontSize: 13, color: 'var(--tg-theme-hint-color, #888)' },
  itemPrice: { fontSize: 13, fontWeight: 700 },
  priceInput: {
    width: 80,
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid var(--tg-theme-hint-color, #ccc)',
    fontSize: 13,
    textAlign: 'right',
  },
  totalInput: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--tg-theme-hint-color, #ccc)',
    fontSize: 15,
    fontWeight: 700,
    background: 'var(--tg-theme-bg-color, #fff)',
    color: 'var(--tg-theme-text-color, #222)',
    boxSizing: 'border-box',
  },
  prescriptionWrapper: {
    borderRadius: 8,
    overflow: 'hidden',
    border: '1px solid var(--tg-theme-hint-color, #ddd)',
  },
  prescriptionImg: {
    width: '100%',
    maxHeight: 300,
    objectFit: 'contain',
    display: 'block',
  },
  notes: { margin: 0, fontSize: 14, color: 'var(--tg-theme-text-color, #333)' },
  actions: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  primaryBtn: {
    padding: '12px 0',
    borderRadius: 10,
    border: 'none',
    background: 'var(--tg-theme-button-color, #2196f3)',
    color: 'var(--tg-theme-button-text-color, #fff)',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  dangerBtn: {
    padding: '12px 0',
    borderRadius: 10,
    border: '1.5px solid #e53935',
    background: 'transparent',
    color: '#e53935',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '10px 0',
    borderRadius: 10,
    border: 'none',
    background: 'var(--tg-theme-secondary-bg-color, #eee)',
    color: 'var(--tg-theme-hint-color, #666)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  reasonInput: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #e53935',
    fontSize: 14,
    resize: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  errText: { color: '#e53935', fontSize: 13, textAlign: 'center', padding: '8px 16px' },
};
