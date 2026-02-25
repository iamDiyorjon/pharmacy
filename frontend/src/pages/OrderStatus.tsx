import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  getOrder,
  confirmOrder,
  cancelOrder,
  reorder,
  type OrderDetail,
  type PaymentMethod,
} from '../services/api';

// ---------------------------------------------------------------------------
// Status badge colours
// ---------------------------------------------------------------------------
const STATUS_COLORS: Record<string, { bg: string; text: string; gradient: string }> = {
  created: { bg: '#e3f2fd', text: '#1565c0', gradient: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)' },
  priced: { bg: '#fff3e0', text: '#e65100', gradient: 'linear-gradient(135deg, #f57c00 0%, #e65100 100%)' },
  confirmed: { bg: '#e8eaf6', text: '#283593', gradient: 'linear-gradient(135deg, #3949ab 0%, #283593 100%)' },
  ready: { bg: '#e8f5e9', text: '#1b5e20', gradient: 'linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%)' },
  completed: { bg: '#f1f8e9', text: '#33691e', gradient: 'linear-gradient(135deg, #558b2f 0%, #33691e 100%)' },
  cancelled: { bg: '#fce4ec', text: '#880e4f', gradient: 'linear-gradient(135deg, #ad1457 0%, #880e4f 100%)' },
  rejected: { bg: '#ffebee', text: '#b71c1c', gradient: 'linear-gradient(135deg, #c62828 0%, #b71c1c 100%)' },
};

const STEP_ORDER = ['created', 'priced', 'confirmed', 'ready', 'completed'] as const;

function formatPrice(price: number | null, currency: string, sumWord: string) {
  if (price === null) return '\u2014';
  return `${price.toLocaleString()} ${currency || sumWord}`;
}

function formatDate(iso: string | null) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleString();
}

// ---------------------------------------------------------------------------
// Status stepper — visual progress indicator
// ---------------------------------------------------------------------------
function StatusStepper({ status }: { status: string }) {
  const { t } = useTranslation();
  const isCancelledOrRejected = status === 'cancelled' || status === 'rejected';
  if (isCancelledOrRejected) return null;

  const currentIdx = STEP_ORDER.indexOf(status as typeof STEP_ORDER[number]);

  return (
    <div style={stepStyles.container}>
      {STEP_ORDER.map((step, idx) => {
        const done = idx <= currentIdx;
        const active = idx === currentIdx;
        return (
          <div key={step} style={stepStyles.stepItem}>
            {/* Connector line (before dot) */}
            {idx > 0 && (
              <div
                style={{
                  ...stepStyles.line,
                  background: idx <= currentIdx ? '#4caf50' : 'var(--tg-theme-hint-color, #ddd)',
                }}
              />
            )}
            {/* Dot */}
            <div
              style={{
                ...stepStyles.dot,
                background: done ? '#4caf50' : 'var(--tg-theme-hint-color, #ddd)',
                ...(active ? { boxShadow: '0 0 0 4px rgba(76,175,80,0.25)', transform: 'scale(1.15)' } : {}),
              }}
            >
              {done && idx < currentIdx && (
                <span style={{ color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: 1 }}>&#10003;</span>
              )}
            </div>
            {/* Label */}
            <span
              style={{
                ...stepStyles.label,
                color: done ? '#333' : 'var(--tg-theme-hint-color, #999)',
                fontWeight: active ? 700 : 400,
              }}
            >
              {t(`orderStatus.step.${step}`)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payment method picker overlay
// ---------------------------------------------------------------------------
interface PaymentPickerProps {
  onSelect: (method: PaymentMethod) => void;
  onCancel: () => void;
}

function PaymentPicker({ onSelect, onCancel }: PaymentPickerProps) {
  const { t } = useTranslation();
  const methods: PaymentMethod[] = ['cash', 'click', 'payme'];
  return (
    <div style={overlay.backdrop} role="dialog" aria-modal>
      <div style={overlay.sheet}>
        <div style={overlay.handle} />
        <h3 style={overlay.title}>{t('orderStatus.selectPayment')}</h3>
        {methods.map((m) => (
          <button key={m} style={overlay.methodBtn} onClick={() => onSelect(m)}>
            <span style={overlay.methodIcon}>
              {m === 'cash' ? '\uD83D\uDCB5' : m === 'click' ? '\uD83D\uDCF1' : '\uD83D\uDCB3'}
            </span>
            {t(`orderStatus.paymentMethod.${m}`)}
          </button>
        ))}
        <button style={overlay.cancelBtn} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OrderStatus page
// ---------------------------------------------------------------------------
export default function OrderStatus() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchOrder = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getOrder(id);
      setOrder(data);
      setError(null);
    } catch {
      setError(t('errors.orderNotFound'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  // Poll for active statuses
  useEffect(() => {
    const activeStatuses = ['created', 'priced', 'confirmed', 'ready'];
    if (!order || !activeStatuses.includes(order.status)) return;

    const interval = setInterval(fetchOrder, 10_000);
    return () => clearInterval(interval);
  }, [order, fetchOrder]);

  async function handleConfirm(method: PaymentMethod) {
    if (!id) return;
    setShowPaymentPicker(false);
    setActionLoading(true);
    try {
      const updated = await confirmOrder(id, method);
      setOrder((prev) => prev ? { ...prev, ...updated } : null);
    } catch {
      setError(t('errors.networkError'));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancel() {
    if (!id || !window.confirm(t('orderStatus.cancelOrder') + '?')) return;
    setActionLoading(true);
    try {
      const updated = await cancelOrder(id);
      setOrder((prev) => prev ? { ...prev, ...updated } : null);
    } catch {
      setError(t('errors.networkError'));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReorder() {
    if (!id) return;
    setActionLoading(true);
    try {
      const newOrder = await reorder(id);
      navigate(`/order/${newOrder.id}`);
    } catch {
      setError(t('errors.networkError'));
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <div style={styles.center}><div style={styles.spinner} /></div>;
  if (error && !order) return <div style={styles.center}><p style={styles.errText}>{error}</p></div>;
  if (!order) return null;

  const statusColor = STATUS_COLORS[order.status] ?? STATUS_COLORS.created;

  // Status context message
  const statusMessage =
    order.status === 'created' ? t('orderStatus.waitingPharmacy') :
    order.status === 'priced' ? t('orderStatus.priceReady', 'Narx tayyor! Tasdiqlang.') :
    order.status === 'confirmed' ? t('orderStatus.waitingReady') :
    order.status === 'ready' ? t('orderStatus.waitingPickup') :
    null;

  return (
    <div style={styles.page}>
      {showPaymentPicker && (
        <PaymentPicker
          onSelect={handleConfirm}
          onCancel={() => setShowPaymentPicker(false)}
        />
      )}

      {/* Colored hero header */}
      <header style={{ ...styles.hero, background: statusColor.gradient }}>
        <div style={styles.heroTop}>
          <h1 style={styles.heroTitle}>{t('orderStatus.title')}</h1>
          <span style={styles.heroOrderNum}>#{order.order_number}</span>
        </div>
        <span style={styles.heroBadge}>
          {t(`orderStatus.status.${order.status}`)}
        </span>
      </header>

      {/* Status stepper */}
      <div style={styles.stepperWrap}>
        <StatusStepper status={order.status} />
      </div>

      {/* Status context message */}
      {statusMessage && (
        <div style={styles.messageCard}>
          <span style={styles.messageIcon}>
            {order.status === 'ready' ? '\u2705' : '\u23F3'}
          </span>
          <p style={styles.messageText}>{statusMessage}</p>
        </div>
      )}

      {/* Cancelled/rejected banner */}
      {order.status === 'cancelled' && (
        <div style={{ ...styles.messageBanner, background: '#fce4ec', borderLeftColor: '#c62828' }}>
          <p style={{ ...styles.bannerText, color: '#880e4f' }}>{t(`orderStatus.status.cancelled`)}</p>
        </div>
      )}

      {order.rejection_reason && (
        <div style={{ ...styles.messageBanner, background: '#ffebee', borderLeftColor: '#b71c1c' }}>
          <p style={styles.bannerLabel}>{t('orderStatus.rejectionReason')}</p>
          <p style={{ ...styles.bannerText, color: '#b71c1c' }}>{order.rejection_reason}</p>
        </div>
      )}

      {/* Pharmacy */}
      <div style={styles.card}>
        <div style={styles.cardRow}>
          <span style={styles.cardIcon}>{'\uD83C\uDFE5'}</span>
          <div style={styles.cardContent}>
            <span style={styles.cardLabel}>{t('orders.pharmacy')}</span>
            <span style={styles.cardValue}>{order.pharmacy_name}</span>
          </div>
        </div>
      </div>

      {/* Price */}
      {order.total_price !== null && (
        <div style={styles.card}>
          <div style={styles.cardRow}>
            <span style={styles.cardIcon}>{'\uD83D\uDCB0'}</span>
            <div style={styles.cardContent}>
              <span style={styles.cardLabel}>{t('orderStatus.totalPrice')}</span>
              <span style={{ ...styles.cardValue, fontSize: 17, fontWeight: 700, color: '#2e7d32' }}>
                {formatPrice(order.total_price, order.currency, t('common.sum'))}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Payment */}
      {order.payment_method && (
        <div style={styles.card}>
          <div style={styles.cardRow}>
            <span style={styles.cardIcon}>{'\uD83D\uDCB3'}</span>
            <div style={styles.cardContent}>
              <span style={styles.cardLabel}>{t('orderStatus.paymentLabel')}</span>
              <span style={styles.cardValue}>
                {t(`orderStatus.paymentMethod.${order.payment_method}`)}
              </span>
              {order.payment_status && (
                <span style={{
                  ...styles.miniTag,
                  ...(order.payment_status === 'paid'
                    ? { background: '#e8f5e9', color: '#2e7d32' }
                    : order.payment_status === 'failed'
                    ? { background: '#ffebee', color: '#c62828' }
                    : { background: '#fff3e0', color: '#e65100' }),
                }}>
                  {t(`orderStatus.paymentStatus.${order.payment_status}`)}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Items */}
      {order.items.length > 0 && (
        <div style={styles.card}>
          <h3 style={styles.sectionTitle}>{t('order.medicines')}</h3>
          {order.items.map((item, idx) => (
            <div
              key={item.id}
              style={{
                ...styles.itemRow,
                borderTop: idx > 0 ? '1px solid var(--tg-theme-hint-color, #eee)' : 'none',
              }}
            >
              <div style={styles.itemLeft}>
                <span style={styles.itemName}>{item.medicine_name}</span>
                <span style={styles.itemQty}>{'\u00D7'}{item.quantity}</span>
              </div>
              {item.unit_price !== null && (
                <span style={styles.itemPrice}>
                  {formatPrice(item.unit_price, order.currency, t('common.sum'))}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Timestamps */}
      <div style={styles.card}>
        <InfoRow label={t('orders.date')} value={formatDate(order.created_at)} />
        {order.confirmed_at && (
          <InfoRow label={t('orderStatus.step.confirmed')} value={formatDate(order.confirmed_at)} />
        )}
        {order.ready_at && (
          <InfoRow label={t('orderStatus.step.ready')} value={formatDate(order.ready_at)} />
        )}
      </div>

      {error && <p style={styles.errText}>{error}</p>}

      {/* Actions */}
      <div style={styles.actions}>
        {order.status === 'priced' && (
          <button
            style={styles.primaryBtn}
            onClick={() => setShowPaymentPicker(true)}
            disabled={actionLoading}
          >
            {t('orderStatus.confirmPrice')}
            {order.total_price !== null && (
              <span style={styles.btnPrice}>
                {' \u2014 '}{formatPrice(order.total_price, order.currency, t('common.sum'))}
              </span>
            )}
          </button>
        )}

        {['created', 'priced', 'confirmed'].includes(order.status) && (
          <button
            style={styles.dangerBtn}
            onClick={handleCancel}
            disabled={actionLoading}
          >
            {t('orderStatus.cancelOrder')}
          </button>
        )}

        {order.status === 'completed' && (
          <button
            style={styles.primaryBtn}
            onClick={handleReorder}
            disabled={actionLoading}
          >
            {t('orderStatus.reorder')}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}>
      <span style={{ fontSize: 13, color: 'var(--tg-theme-hint-color, #888)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stepper styles
// ---------------------------------------------------------------------------
const stepStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    position: 'relative',
    padding: '0 8px',
  },
  stepItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    position: 'relative',
    flex: 1,
    gap: 6,
  },
  line: {
    position: 'absolute',
    top: 10,
    right: '50%',
    width: '100%',
    height: 3,
    borderRadius: 2,
    zIndex: 0,
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
    transition: 'all 0.3s',
    flexShrink: 0,
  },
  label: {
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 1.2,
    maxWidth: 50,
  },
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100%', paddingBottom: 16, background: 'var(--tg-theme-bg-color, #fff)' },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' },
  spinner: {
    width: 36,
    height: 36,
    border: '3px solid var(--tg-theme-hint-color, #ddd)',
    borderTopColor: 'var(--tg-theme-button-color, #2196f3)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  hero: {
    padding: '20px 16px 18px',
    color: '#fff',
  },
  heroTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  heroTitle: {
    margin: 0,
    fontSize: 20,
    fontWeight: 700,
  },
  heroOrderNum: {
    fontSize: 13,
    fontWeight: 600,
    opacity: 0.85,
  },
  heroBadge: {
    display: 'inline-block',
    padding: '5px 14px',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 700,
    background: 'rgba(255,255,255,0.2)',
    backdropFilter: 'blur(4px)',
    letterSpacing: 0.3,
  },
  stepperWrap: {
    padding: '16px 16px 4px',
  },
  messageCard: {
    margin: '10px 16px 0',
    padding: '12px 14px',
    background: 'var(--tg-theme-secondary-bg-color, #f5f5f5)',
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  messageIcon: {
    fontSize: 20,
    flexShrink: 0,
  },
  messageText: {
    margin: 0,
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--tg-theme-text-color, #333)',
    lineHeight: 1.4,
  },
  messageBanner: {
    margin: '10px 16px 0',
    padding: '12px 14px',
    borderRadius: 10,
    borderLeft: '4px solid',
  },
  bannerLabel: {
    margin: '0 0 4px',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#c62828',
  },
  bannerText: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.3,
  },
  card: {
    margin: '10px 16px 0',
    padding: '12px 14px',
    background: 'var(--tg-theme-secondary-bg-color, #f5f5f5)',
    borderRadius: 10,
  },
  cardRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  },
  cardIcon: {
    fontSize: 20,
    lineHeight: 1,
    flexShrink: 0,
    marginTop: 2,
  },
  cardContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: 1,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--tg-theme-hint-color, #888)',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cardValue: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--tg-theme-text-color, #222)',
  },
  miniTag: {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 12,
    width: 'fit-content',
    marginTop: 2,
  },
  sectionTitle: { margin: '0 0 8px', fontSize: 14, fontWeight: 700 },
  itemRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    gap: 8,
  },
  itemLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    fontSize: 14,
    fontWeight: 500,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemQty: {
    fontSize: 13,
    color: 'var(--tg-theme-hint-color, #888)',
    fontWeight: 500,
    flexShrink: 0,
  },
  itemPrice: { fontSize: 14, fontWeight: 700, color: '#2e7d32', flexShrink: 0 },
  errText: { color: '#e53935', fontSize: 13, textAlign: 'center', padding: '8px 16px', margin: 0 },
  actions: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    marginTop: 4,
  },
  primaryBtn: {
    padding: '14px 0',
    borderRadius: 12,
    border: 'none',
    background: 'var(--tg-theme-button-color, #2196f3)',
    color: 'var(--tg-theme-button-text-color, #fff)',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  btnPrice: {
    fontWeight: 400,
    opacity: 0.9,
  },
  dangerBtn: {
    padding: '13px 0',
    borderRadius: 12,
    border: '1.5px solid #e53935',
    background: 'transparent',
    color: '#e53935',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  },
};

const overlay: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 200,
  },
  sheet: {
    background: 'var(--tg-theme-bg-color, #fff)',
    borderRadius: '18px 18px 0 0',
    padding: '12px 16px 32px',
    width: '100%',
    maxWidth: 480,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    background: 'var(--tg-theme-hint-color, #ccc)',
    margin: '0 auto 8px',
  },
  title: { margin: '0 0 4px', fontSize: 17, fontWeight: 700, textAlign: 'center' },
  methodBtn: {
    padding: '14px 16px',
    borderRadius: 12,
    border: '1.5px solid var(--tg-theme-button-color, #2196f3)',
    background: 'transparent',
    color: 'var(--tg-theme-button-color, #2196f3)',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  methodIcon: {
    fontSize: 20,
  },
  cancelBtn: {
    marginTop: 4,
    padding: '12px 0',
    borderRadius: 12,
    border: 'none',
    background: 'var(--tg-theme-secondary-bg-color, #f5f5f5)',
    color: 'var(--tg-theme-hint-color, #666)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
