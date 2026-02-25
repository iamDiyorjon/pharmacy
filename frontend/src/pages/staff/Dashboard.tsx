import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { getStaffOrders, type StaffOrder, type OrderStatus } from '../../services/api';

const STATUS_GROUPS: { status: OrderStatus; labelKey: string; color: string }[] = [
  { status: 'created', labelKey: 'staff.newOrders', color: '#1565c0' },
  { status: 'priced', labelKey: 'orderStatus.status.priced', color: '#e65100' },
  { status: 'confirmed', labelKey: 'orderStatus.status.confirmed', color: '#283593' },
  { status: 'ready', labelKey: 'orderStatus.status.ready', color: '#1b5e20' },
];

// ---------------------------------------------------------------------------
// OrderRow
// ---------------------------------------------------------------------------
interface OrderRowProps {
  order: StaffOrder;
  onPress: () => void;
}

function OrderRow({ order, onPress }: OrderRowProps) {
  const { t } = useTranslation();
  return (
    <div style={rowStyles.row} onClick={onPress} role="button" tabIndex={0}>
      <div style={rowStyles.left}>
        <span style={rowStyles.num}>#{order.order_number}</span>
        <span style={rowStyles.user}>
          {order.user_first_name}
        </span>
        <span style={rowStyles.type}>
          {t(`order.orderType.${order.order_type}`)}
        </span>
      </div>
      <div style={rowStyles.right}>
        {order.total_price !== null && (
          <span style={rowStyles.price}>
            {order.total_price.toLocaleString()} {order.currency}
          </span>
        )}
        {order.payment_method && (
          <span style={rowStyles.payBadge}>
            {order.payment_method === 'cash'
              ? t('staff.paymentStatus.cash')
              : order.payment_status === 'paid'
              ? t('staff.paymentStatus.paid')
              : t('staff.paymentStatus.pending')}
          </span>
        )}
        <span style={rowStyles.time}>
          {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------
export default function StaffDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [ordersByStatus, setOrdersByStatus] = useState<
    Partial<Record<OrderStatus, StaffOrder[]>>
  >({});
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    try {
      const { orders } = await getStaffOrders({ limit: 100 });
      const grouped: Partial<Record<OrderStatus, StaffOrder[]>> = {};
      for (const o of orders) {
        if (!grouped[o.status]) grouped[o.status] = [];
        grouped[o.status]!.push(o);
      }
      setOrdersByStatus(grouped);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // Refresh every 30 seconds
  useEffect(() => {
    const id = setInterval(loadOrders, 30_000);
    return () => clearInterval(id);
  }, [loadOrders]);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>{t('staff.dashboard')}</h1>
        <button style={styles.medicinesBtn} onClick={() => navigate('/staff/medicines')}>
          {t('staff.medicines')}
        </button>
      </header>

      {loading && <p style={styles.hint}>{t('common.loading')}</p>}

      {!loading &&
        STATUS_GROUPS.map(({ status, labelKey, color }) => {
          const group = ordersByStatus[status] ?? [];
          return (
            <section key={status} style={styles.group}>
              <div style={styles.groupHeader}>
                <span style={{ ...styles.groupDot, background: color }} />
                <h2 style={styles.groupTitle}>{t(labelKey)}</h2>
                <span style={styles.groupCount}>{group.length}</span>
              </div>
              {group.length === 0 ? (
                <p style={styles.emptyGroup}>—</p>
              ) : (
                group.map((o) => (
                  <OrderRow
                    key={o.id}
                    order={o}
                    onPress={() => navigate(`/staff/order/${o.id}`)}
                  />
                ))
              )}
            </section>
          );
        })}
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
  medicinesBtn: {
    padding: '6px 14px',
    borderRadius: 8,
    border: '1.5px solid var(--tg-theme-button-color, #2196f3)',
    background: 'transparent',
    color: 'var(--tg-theme-button-color, #2196f3)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  group: {
    margin: '16px 16px 0',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  groupDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
  },
  groupTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 700,
    flex: 1,
  },
  groupCount: {
    fontSize: 12,
    fontWeight: 700,
    background: 'var(--tg-theme-secondary-bg-color, #eee)',
    padding: '2px 8px',
    borderRadius: 20,
  },
  emptyGroup: {
    margin: 0,
    color: 'var(--tg-theme-hint-color, #bbb)',
    fontSize: 13,
    padding: '4px 0',
  },
  hint: {
    textAlign: 'center',
    color: 'var(--tg-theme-hint-color, #999)',
    padding: '24px',
    margin: 0,
  },
};

const rowStyles: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'var(--tg-theme-secondary-bg-color, #f5f5f5)',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 8,
    cursor: 'pointer',
    gap: 8,
  },
  left: { display: 'flex', flexDirection: 'column', gap: 3, flex: 1 },
  num: { fontSize: 13, fontWeight: 700 },
  user: { fontSize: 12, color: 'var(--tg-theme-text-color, #444)' },
  type: { fontSize: 11, color: 'var(--tg-theme-hint-color, #888)' },
  right: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 },
  price: { fontSize: 13, fontWeight: 700 },
  payBadge: { fontSize: 10, color: 'var(--tg-theme-hint-color, #888)' },
  time: { fontSize: 11, color: 'var(--tg-theme-hint-color, #aaa)' },
};
