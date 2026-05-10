import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  getOrder,
  cancelOrder,
  reorder,
  getReplyImageUrl,
  type OrderDetail,
} from '../services/api';

const STATUS_COLORS: Record<string, { bg: string; text: string; gradient: string }> = {
  created: { bg: '#e3f2fd', text: '#1565c0', gradient: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)' },
  ready: { bg: '#e8f5e9', text: '#1b5e20', gradient: 'linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%)' },
  completed: { bg: '#f1f8e9', text: '#33691e', gradient: 'linear-gradient(135deg, #558b2f 0%, #33691e 100%)' },
  cancelled: { bg: '#fce4ec', text: '#880e4f', gradient: 'linear-gradient(135deg, #ad1457 0%, #880e4f 100%)' },
  rejected: { bg: '#ffebee', text: '#b71c1c', gradient: 'linear-gradient(135deg, #c62828 0%, #b71c1c 100%)' },
};

const STEP_ORDER = ['created', 'ready', 'completed'] as const;

function formatPrice(price: number | null, currency: string, sumWord: string) {
  if (price === null) return '—';
  return `${price.toLocaleString()} ${currency || sumWord}`;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

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
            {idx > 0 && (
              <div
                style={{
                  ...stepStyles.line,
                  background: idx <= currentIdx ? '#4caf50' : 'var(--tg-theme-hint-color, #ddd)',
                }}
              />
            )}
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

export default function OrderStatus() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    const activeStatuses = ['created', 'ready'];
    if (!order || !activeStatuses.includes(order.status)) return;

    const interval = setInterval(fetchOrder, 10_000);
    return () => clearInterval(interval);
  }, [order, fetchOrder]);

  async function handleCancel() {
    if (!id || !window.confirm(t('orderStatus.cancelOrder') + '?')) return;
    setActionLoading(true);
    try {
      const updated = await cancelOrder(id);
      setOrder((prev) => prev ? { ...prev, ...updated } : null);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { detail?: { reason?: string } } } };
      if (e?.response?.status === 429) {
        setError(t('orderStatus.cancelLimitReached'));
      } else {
        setError(t('errors.networkError'));
      }
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

  const statusMessage =
    order.status === 'created' ? t('orderStatus.waitingPharmacy') :
    order.status === 'ready' ? t('orderStatus.waitingPickup') :
    null;

  // Customer can act on cancel for created (always) and ready (with quota).
  // Disabled state still renders so the over-quota helper text is visible.
  const showCancel = order.status === 'created' || order.status === 'ready';
  const cancelDisabled = !order.can_cancel;

  return (
    <div style={styles.page}>
      <header style={{ ...styles.hero, background: statusColor.gradient }}>
        <div style={styles.heroTop}>
          <h1 style={styles.heroTitle}>{t('orderStatus.title')}</h1>
          <span style={styles.heroOrderNum}>#{order.order_number}</span>
        </div>
        <span style={styles.heroBadge}>
          {t(`orderStatus.status.${order.status}`)}
        </span>
      </header>

      <div style={styles.stepperWrap}>
        <StatusStepper status={order.status} />
      </div>

      {statusMessage && (
        <div style={styles.messageCard}>
          <span style={styles.messageIcon}>
            {order.status === 'ready' ? '✅' : '⏳'}
          </span>
          <p style={styles.messageText}>{statusMessage}</p>
        </div>
      )}

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

      <div style={styles.card}>
        <div style={styles.cardRow}>
          <span style={styles.cardIcon}>{'🏥'}</span>
          <div style={styles.cardContent}>
            <span style={styles.cardLabel}>{t('orders.pharmacy')}</span>
            <span style={styles.cardValue}>{order.pharmacy_name}</span>
          </div>
        </div>
      </div>

      {order.total_price !== null && (
        <div style={styles.card}>
          <div style={styles.cardRow}>
            <span style={styles.cardIcon}>{'💰'}</span>
            <div style={styles.cardContent}>
              <span style={styles.cardLabel}>{t('orderStatus.totalPrice')}</span>
              <span style={{ ...styles.cardValue, fontSize: 17, fontWeight: 700, color: '#2e7d32' }}>
                {formatPrice(order.total_price, order.currency, t('common.sum'))}
              </span>
            </div>
          </div>
        </div>
      )}

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
                <span style={styles.itemQty}>{'×'}{item.quantity}</span>
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

      {order.reply_image_url && (
        <div style={styles.card}>
          <h3 style={styles.sectionTitle}>{t('orderStatus.replyImage', 'Dorixonadan rasm')}</h3>
          <div style={styles.replyImageWrapper}>
            <a href={getReplyImageUrl(order.id)} target="_blank" rel="noreferrer">
              <img
                src={getReplyImageUrl(order.id)}
                alt={t('orderStatus.replyImage', 'Dorixonadan rasm')}
                style={styles.replyImage}
                loading="lazy"
              />
            </a>
          </div>
        </div>
      )}

      <div style={styles.card}>
        <InfoRow label={t('orders.date')} value={formatDate(order.created_at)} />
        {order.ready_at && (
          <InfoRow label={t('orderStatus.step.ready')} value={formatDate(order.ready_at)} />
        )}
      </div>

      {error && <p style={styles.errText}>{error}</p>}

      <div style={styles.actions}>
        {showCancel && order.status !== 'completed' && order.status !== 'cancelled' && order.status !== 'rejected' && (
          <>
            <button
              style={{
                ...styles.dangerBtn,
                ...(cancelDisabled ? styles.dangerBtnDisabled : {}),
              }}
              onClick={handleCancel}
              disabled={actionLoading || cancelDisabled}
            >
              {t('orderStatus.cancelOrder')}
            </button>
            {cancelDisabled && order.cancel_reason === 'ready_cancel_limit_exceeded' && (
              <p style={styles.helperText}>{t('orderStatus.cancelLimitReached')}</p>
            )}
          </>
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}>
      <span style={{ fontSize: 13, color: 'var(--tg-theme-hint-color, #888)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

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
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 1.2,
    maxWidth: 60,
  },
};

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
  stepperWrap: { padding: '16px 16px 4px' },
  messageCard: {
    margin: '10px 16px 0',
    padding: '12px 14px',
    background: 'var(--tg-theme-secondary-bg-color, #f5f5f5)',
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  messageIcon: { fontSize: 20, flexShrink: 0 },
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
  bannerText: { margin: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.3 },
  card: {
    margin: '10px 16px 0',
    padding: '12px 14px',
    background: 'var(--tg-theme-secondary-bg-color, #f5f5f5)',
    borderRadius: 10,
  },
  cardRow: { display: 'flex', alignItems: 'flex-start', gap: 12 },
  cardIcon: { fontSize: 20, lineHeight: 1, flexShrink: 0, marginTop: 2 },
  cardContent: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1 },
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
  sectionTitle: { margin: '0 0 8px', fontSize: 14, fontWeight: 700 },
  replyImageWrapper: {
    borderRadius: 8,
    overflow: 'hidden',
    border: '1px solid var(--tg-theme-hint-color, #ddd)',
  },
  replyImage: {
    width: '100%',
    maxHeight: 300,
    objectFit: 'contain' as const,
    display: 'block',
  },
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
  helperText: {
    margin: '4px 0 0',
    fontSize: 12,
    color: '#888',
    textAlign: 'center' as const,
  },
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
  dangerBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed' as const,
  },
};
