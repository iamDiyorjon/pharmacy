import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { getStaffOrders, type StaffOrder, type OrderStatus } from '../../services/api';

type TabKey = OrderStatus | 'all';

const STATUS_TABS: { key: TabKey; labelKey: string; color: string }[] = [
  { key: 'all', labelKey: 'staff.allOrders', color: '#333' },
  { key: 'created', labelKey: 'staff.newOrders', color: '#1565c0' },
  { key: 'priced', labelKey: 'orderStatus.status.priced', color: '#e65100' },
  { key: 'confirmed', labelKey: 'orderStatus.status.confirmed', color: '#283593' },
  { key: 'ready', labelKey: 'orderStatus.status.ready', color: '#1b5e20' },
  { key: 'completed', labelKey: 'orderStatus.status.completed', color: '#2e7d32' },
  { key: 'rejected', labelKey: 'orderStatus.status.rejected', color: '#c62828' },
  { key: 'cancelled', labelKey: 'orderStatus.status.cancelled', color: '#888' },
];

const STATUS_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  created: { bg: '#e3f2fd', text: '#1565c0' },
  priced: { bg: '#fff3e0', text: '#e65100' },
  confirmed: { bg: '#e8eaf6', text: '#283593' },
  ready: { bg: '#e8f5e9', text: '#1b5e20' },
  completed: { bg: '#e8f5e9', text: '#2e7d32' },
  rejected: { bg: '#fce4ec', text: '#c62828' },
  cancelled: { bg: '#f5f5f5', text: '#888' },
};

export default function StaffDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [allOrders, setAllOrders] = useState<StaffOrder[]>([]);
  const [ordersByStatus, setOrdersByStatus] = useState<
    Partial<Record<OrderStatus, StaffOrder[]>>
  >({});
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    try {
      const { orders } = await getStaffOrders({ limit: 100 });
      setAllOrders(orders);
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

  useEffect(() => {
    const id = setInterval(loadOrders, 30_000);
    return () => clearInterval(id);
  }, [loadOrders]);

  const activeOrders = activeTab === 'all' ? allOrders : (ordersByStatus[activeTab] ?? []);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>{t('staff.orders')}</h1>
      </header>

      {/* Status tabs */}
      <div style={styles.tabs}>
        {STATUS_TABS.map(({ key, labelKey, color }) => {
          const count = key === 'all' ? allOrders.length : (ordersByStatus[key] ?? []).length;
          const isActive = key === activeTab;
          // Hide empty terminal tabs to keep it clean
          if (count === 0 && ['completed', 'rejected', 'cancelled'].includes(key)) return null;
          return (
            <button
              key={key}
              style={{
                ...styles.tab,
                borderBottom: isActive ? `3px solid ${color}` : '3px solid transparent',
                color: isActive ? color : '#888',
                fontWeight: isActive ? 700 : 500,
              }}
              onClick={() => setActiveTab(key)}
            >
              {key === 'all' ? t('staff.allOrders', 'Barchasi') : t(labelKey)}
              <span style={{
                ...styles.tabBadge,
                background: isActive ? color : '#e0e0e0',
                color: isActive ? '#fff' : '#666',
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {loading && <p style={styles.hint}>{t('common.loading')}</p>}

      {!loading && activeOrders.length === 0 && (
        <p style={styles.emptyText}>
          {t('orders.empty', 'Buyurtmalar yo\'q')}
        </p>
      )}

      {/* Data table */}
      {!loading && activeOrders.length > 0 && (
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>#</th>
                <th style={styles.th}>{t('staff.customerInfo')}</th>
                <th style={styles.th}>{t('order.orderSummary')}</th>
                {activeTab === 'all' && <th style={styles.th}>{t('orderStatus.title', 'Holat')}</th>}
                <th style={styles.th}>{t('order.medicines')}</th>
                <th style={styles.thRight}>{t('staff.totalPrice')}</th>
                <th style={styles.th}>{t('orderStatus.paymentMethod.cash', 'To\'lov')}</th>
                <th style={styles.thRight}>{t('orders.date')}</th>
              </tr>
            </thead>
            <tbody>
              {activeOrders.map((order) => {
                const badge = STATUS_BADGE_COLORS[order.status] ?? { bg: '#f5f5f5', text: '#888' };
                return (
                  <tr
                    key={order.id}
                    style={styles.tr}
                    onClick={() => navigate(`/staff/order/${order.id}`)}
                  >
                    <td style={styles.td}>
                      <span style={styles.orderNum}>{order.order_number}</span>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.customerCell}>
                        <span style={styles.customerName}>{order.user_first_name}</span>
                        {order.user_phone && (
                          <span style={styles.customerPhone}>{order.user_phone}</span>
                        )}
                        {!order.user_phone && order.user_telegram_username && (
                          <span style={styles.customerPhone}>@{order.user_telegram_username}</span>
                        )}
                      </div>
                    </td>
                    <td style={styles.td}>
                      <span style={styles.typeBadge}>
                        {t(`order.orderType.${order.order_type}`)}
                      </span>
                    </td>
                    {activeTab === 'all' && (
                      <td style={styles.td}>
                        <span style={{
                          ...styles.statusBadge,
                          background: badge.bg,
                          color: badge.text,
                        }}>
                          {t(`orderStatus.status.${order.status}`)}
                        </span>
                      </td>
                    )}
                    <td style={styles.td}>
                      <span style={styles.itemCount}>
                        {order.items.length} {t('orders.items')}
                      </span>
                    </td>
                    <td style={styles.tdRight}>
                      {order.total_price !== null ? (
                        <span style={styles.price}>
                          {order.total_price.toLocaleString()} {order.currency}
                        </span>
                      ) : (
                        <span style={styles.noPrice}>—</span>
                      )}
                    </td>
                    <td style={styles.td}>
                      {order.payment_method ? (
                        <span style={styles.payBadge}>
                          {order.payment_method === 'cash'
                            ? t('staff.paymentStatus.cash')
                            : order.payment_status === 'paid'
                            ? t('staff.paymentStatus.paid')
                            : t('staff.paymentStatus.pending')}
                        </span>
                      ) : (
                        <span style={styles.noPrice}>—</span>
                      )}
                    </td>
                    <td style={styles.tdRight}>
                      <span style={styles.time}>
                        {new Date(order.created_at).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
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
  tabs: {
    display: 'flex',
    gap: 4,
    borderBottom: '1px solid #e0e0e0',
    marginBottom: 16,
    overflowX: 'auto',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    whiteSpace: 'nowrap',
    transition: 'color 0.15s',
  },
  tabBadge: {
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 12,
    minWidth: 20,
    textAlign: 'center',
  },
  hint: {
    textAlign: 'center',
    color: '#999',
    padding: 24,
    margin: 0,
  },
  emptyText: {
    textAlign: 'center',
    color: '#bbb',
    padding: 40,
    margin: 0,
    fontSize: 16,
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
  thRight: {
    textAlign: 'right',
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
    cursor: 'pointer',
    borderBottom: '1px solid #f0f0f0',
    transition: 'background 0.1s',
  },
  td: {
    padding: '12px',
    verticalAlign: 'middle',
  },
  tdRight: {
    padding: '12px',
    verticalAlign: 'middle',
    textAlign: 'right',
  },
  orderNum: {
    fontWeight: 700,
    fontSize: 13,
    color: '#1565c0',
  },
  customerCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  customerName: {
    fontWeight: 600,
    fontSize: 14,
  },
  customerPhone: {
    fontSize: 12,
    color: '#888',
  },
  typeBadge: {
    fontSize: 12,
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: 12,
    background: '#e3f2fd',
    color: '#1565c0',
    whiteSpace: 'nowrap',
  },
  statusBadge: {
    fontSize: 12,
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: 12,
    whiteSpace: 'nowrap',
  },
  itemCount: {
    fontSize: 13,
    color: '#555',
  },
  price: {
    fontWeight: 700,
    fontSize: 14,
    whiteSpace: 'nowrap',
  },
  noPrice: {
    color: '#bbb',
  },
  payBadge: {
    fontSize: 12,
    fontWeight: 500,
    color: '#555',
  },
  time: {
    fontSize: 13,
    color: '#888',
    whiteSpace: 'nowrap',
  },
};
