import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { getOrders, reorder, type Order, type OrderStatus } from '../services/api';

const ACTIVE_STATUSES: OrderStatus[] = ['created', 'priced', 'confirmed', 'ready'];
const HISTORY_STATUSES: OrderStatus[] = ['completed', 'cancelled', 'rejected'];

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  created: { bg: '#e3f2fd', text: '#1565c0', dot: '#1976d2' },
  priced: { bg: '#fff3e0', text: '#e65100', dot: '#f57c00' },
  confirmed: { bg: '#e8eaf6', text: '#283593', dot: '#3949ab' },
  ready: { bg: '#e8f5e9', text: '#1b5e20', dot: '#2e7d32' },
  completed: { bg: '#f1f8e9', text: '#33691e', dot: '#558b2f' },
  cancelled: { bg: '#fce4ec', text: '#880e4f', dot: '#ad1457' },
  rejected: { bg: '#ffebee', text: '#b71c1c', dot: '#c62828' },
};

// ---------------------------------------------------------------------------
// OrderCard
// ---------------------------------------------------------------------------
interface OrderCardProps {
  order: Order;
  onPress: () => void;
  onReorder?: () => void;
}

function OrderCard({ order, onPress, onReorder }: OrderCardProps) {
  const { t } = useTranslation();
  const color = STATUS_COLORS[order.status] ?? STATUS_COLORS.created;

  return (
    <div style={cardStyles.card} onClick={onPress} role="button" tabIndex={0}>
      {/* Top: order number + status */}
      <div style={cardStyles.top}>
        <div style={cardStyles.topLeft}>
          <span style={{ ...cardStyles.statusDot, background: color.dot }} />
          <span style={cardStyles.orderNum}>#{order.order_number}</span>
        </div>
        <span style={{ ...cardStyles.badge, background: color.bg, color: color.text }}>
          {t(`orderStatus.status.${order.status}`)}
        </span>
      </div>

      {/* Pharmacy name */}
      <p style={cardStyles.pharmacy}>{order.pharmacy_name}</p>

      {/* Meta row: date + price */}
      <div style={cardStyles.meta}>
        <span style={cardStyles.date}>
          {new Date(order.created_at).toLocaleDateString()}
        </span>
        {order.total_price !== null && (
          <span style={cardStyles.price}>
            {order.total_price.toLocaleString()} {order.currency || t('common.sum')}
          </span>
        )}
      </div>

      {/* Reorder button for completed orders */}
      {order.status === 'completed' && onReorder && (
        <button
          style={cardStyles.reorderBtn}
          onClick={(e) => {
            e.stopPropagation();
            onReorder();
          }}
        >
          {t('orderStatus.reorder')}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orders page
// ---------------------------------------------------------------------------
type Tab = 'active' | 'history';

export default function Orders() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('active');
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [activeRes, histRes] = await Promise.all([
        getOrders({ limit: 50 }),
        getOrders({ limit: 50 }),
      ]);
      const all = activeRes.orders;
      setActiveOrders(all.filter((o) => ACTIVE_STATUSES.includes(o.status)));
      setHistoryOrders(histRes.orders.filter((o) => HISTORY_STATUSES.includes(o.status)));
    } catch {
      // silent fail — show empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Poll active orders every 15s
  useEffect(() => {
    const id = setInterval(() => {
      if (tab === 'active') loadAll();
    }, 15_000);
    return () => clearInterval(id);
  }, [tab, loadAll]);

  async function handleReorder(orderId: string) {
    try {
      const newOrder = await reorder(orderId);
      navigate(`/order/${newOrder.id}`);
    } catch {
      /* ignore */
    }
  }

  const displayed = tab === 'active' ? activeOrders : historyOrders;

  return (
    <div style={styles.page}>
      {/* Hero header */}
      <header style={styles.hero}>
        <h1 style={styles.heroTitle}>{t('orders.title')}</h1>
        <div style={styles.countRow}>
          <span style={styles.countBadge}>{activeOrders.length} {t('orders.active').toLowerCase()}</span>
        </div>
      </header>

      {/* Tabs */}
      <div style={styles.tabs}>
        {(['active', 'history'] as Tab[]).map((t2) => (
          <button
            key={t2}
            style={{
              ...styles.tab,
              ...(tab === t2 ? styles.tabActive : styles.tabInactive),
            }}
            onClick={() => setTab(t2)}
          >
            {t(`orders.${t2}`)}
            {t2 === 'active' && activeOrders.length > 0 && (
              <span style={styles.tabCount}>{activeOrders.length}</span>
            )}
          </button>
        ))}
      </div>

      {loading && (
        <div style={styles.center}>
          <div style={styles.spinner} />
        </div>
      )}

      {!loading && displayed.length === 0 && (
        <div style={styles.emptyState}>
          <span style={styles.emptyIcon}>
            {tab === 'active' ? '\uD83D\uDCCB' : '\uD83D\uDCC2'}
          </span>
          <p style={styles.emptyText}>
            {tab === 'active' ? t('orders.emptyActive') : t('orders.emptyHistory')}
          </p>
          {tab === 'active' && (
            <button style={styles.emptyBtn} onClick={() => navigate('/search')}>
              {t('order.goToSearch')}
            </button>
          )}
        </div>
      )}

      <div style={styles.list}>
        {!loading &&
          displayed.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onPress={() => navigate(`/order/${order.id}`)}
              onReorder={
                order.status === 'completed'
                  ? () => handleReorder(order.id)
                  : undefined
              }
            />
          ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100%' },
  hero: {
    padding: '20px 16px 14px',
    background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)',
    color: '#fff',
  },
  heroTitle: { margin: 0, fontSize: 22, fontWeight: 700 },
  countRow: {
    marginTop: 8,
    display: 'flex',
    gap: 8,
  },
  countBadge: {
    fontSize: 12,
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.2)',
  },
  tabs: {
    display: 'flex',
    margin: '12px 16px 0',
    background: 'var(--tg-theme-secondary-bg-color, #f5f5f5)',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    padding: '9px 0',
    borderRadius: 10,
    border: 'none',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  tabActive: {
    background: 'var(--tg-theme-button-color, #2196f3)',
    color: 'var(--tg-theme-button-text-color, #fff)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  },
  tabInactive: {
    background: 'transparent',
    color: 'var(--tg-theme-hint-color, #888)',
  },
  tabCount: {
    fontSize: 11,
    fontWeight: 700,
    background: 'rgba(255,255,255,0.25)',
    padding: '1px 7px',
    borderRadius: 10,
  },
  list: {
    padding: '12px 16px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 48,
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid var(--tg-theme-hint-color, #ddd)',
    borderTopColor: 'var(--tg-theme-button-color, #2196f3)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '48px 24px',
    gap: 10,
  },
  emptyIcon: {
    fontSize: 48,
    lineHeight: 1,
    opacity: 0.6,
  },
  emptyText: {
    color: 'var(--tg-theme-hint-color, #999)',
    fontSize: 14,
    margin: 0,
    textAlign: 'center',
  },
  emptyBtn: {
    marginTop: 8,
    padding: '10px 24px',
    borderRadius: 10,
    border: 'none',
    background: 'var(--tg-theme-button-color, #2196f3)',
    color: 'var(--tg-theme-button-text-color, #fff)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
};

const cardStyles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--tg-theme-secondary-bg-color, #f9f9f9)',
    borderRadius: 12,
    padding: '14px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    transition: 'transform 0.1s',
  },
  top: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  orderNum: { fontSize: 14, fontWeight: 700, color: 'var(--tg-theme-text-color, #333)' },
  badge: {
    fontSize: 11,
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: 20,
    letterSpacing: 0.3,
  },
  pharmacy: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--tg-theme-text-color, #222)',
  },
  meta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  date: { fontSize: 12, color: 'var(--tg-theme-hint-color, #888)' },
  price: { fontSize: 14, fontWeight: 700, color: '#2e7d32' },
  reorderBtn: {
    marginTop: 4,
    padding: '10px 0',
    borderRadius: 10,
    border: 'none',
    background: 'var(--tg-theme-button-color, #2196f3)',
    color: 'var(--tg-theme-button-text-color, #fff)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
  },
};
