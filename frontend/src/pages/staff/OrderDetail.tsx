import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  getStaffOrder,
  priceOrder,
  readyOrder,
  completeOrder,
  rejectOrder,
  uploadReplyImage,
  getReplyImageUrl,
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
  const [excludedItems, setExcludedItems] = useState<Set<string>>(new Set());

  // Rejection state
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  // Reply image upload state
  const [replyImageFile, setReplyImageFile] = useState<File | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const fetchOrder = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getStaffOrder(id);
      setOrder(data);
      const prices: Record<string, string> = {};
      data.items.forEach((item) => {
        prices[item.id] = item.unit_price?.toString() ?? '';
      });
      setItemPrices(prices);
      if (data.total_price !== null) {
        setTotalPrice(data.total_price.toString());
      } else {
        // Auto-calculate from item prices if no total yet
        const sum = data.items.reduce((s, item) => {
          const p = item.unit_price ?? 0;
          return s + p * item.quantity;
        }, 0);
        if (sum > 0) setTotalPrice(sum.toString());
      }
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
    if (!id || !totalPrice || parseFloat(totalPrice) <= 0) return;
    setActionLoading(true);
    try {
      // Build items list: included items get their price, excluded items get 0
      const items: PriceOrderItem[] = (order?.items ?? []).map((item) => ({
        order_item_id: item.id,
        unit_price: excludedItems.has(item.id)
          ? 0
          : parseFloat(itemPrices[item.id] ?? '0') || 0,
      }));

      const updated = await priceOrder(id, {
        total_price: parseFloat(totalPrice),
        items: items.length > 0 ? items : undefined,
      });
      setOrder((prev) => (prev ? { ...prev, ...updated } : null));
    } catch {
      setError(t('errors.networkError'));
    } finally {
      setActionLoading(false);
    }
  }

  function toggleExclude(itemId: string) {
    setExcludedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  async function handleReady() {
    if (!id) return;
    setActionLoading(true);
    try {
      const updated = await readyOrder(id);
      setOrder((prev) => (prev ? { ...prev, ...updated } : null));
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
      setOrder((prev) => (prev ? { ...prev, ...updated } : null));
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
      setOrder((prev) => (prev ? { ...prev, ...updated } : null));
      setShowRejectForm(false);
    } catch {
      setError(t('errors.networkError'));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUploadReplyImage() {
    if (!id || !replyImageFile) return;
    setUploadingImage(true);
    try {
      const updated = await uploadReplyImage(id, replyImageFile);
      setOrder((prev) => (prev ? { ...prev, ...updated } : null));
      setReplyImageFile(null);
    } catch {
      setError(t('errors.networkError'));
    } finally {
      setUploadingImage(false);
    }
  }

  if (loading)
    return (
      <div style={styles.center}>
        <p>{t('common.loading')}</p>
      </div>
    );
  if (error && !order)
    return (
      <div style={styles.center}>
        <p style={styles.errText}>{error}</p>
      </div>
    );
  if (!order) return null;

  // Auto-update total when item prices change
  const calculatedTotal = order.items.reduce((sum, item) => {
    if (excludedItems.has(item.id)) return sum;
    const unitPrice = parseFloat(itemPrices[item.id] ?? '0') || 0;
    return sum + unitPrice * item.quantity;
  }, 0);

  const isTerminal = ['completed', 'cancelled', 'rejected'].includes(order.status);
  const canEditPrice = order.status === 'created' || order.status === 'priced';

  // Status color
  const statusColor: Record<string, string> = {
    created: '#1565c0',
    priced: '#e65100',
    confirmed: '#283593',
    ready: '#1b5e20',
    completed: '#2e7d32',
    cancelled: '#888',
    rejected: '#c62828',
  };

  return (
    <div style={styles.page}>
      {/* Back + Header */}
      <button style={styles.backBtn} onClick={() => navigate('/staff')}>
        {'\u2190'} {t('common.back')}
      </button>

      <header style={styles.header}>
        <h1 style={styles.title}>#{order.order_number}</h1>
        <span
          style={{
            ...styles.statusBadge,
            background: (statusColor[order.status] ?? '#888') + '18',
            color: statusColor[order.status] ?? '#888',
          }}
        >
          {t(`orderStatus.status.${order.status}`)}
        </span>
      </header>

      {/* Two-column layout */}
      <div className="staff-order-columns" style={styles.columns}>
        {/* LEFT — Order info */}
        <div style={styles.leftCol}>
          {/* Customer info */}
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>{t('staff.customerInfo')}</h2>
            <InfoRow label={t('settings.firstName')} value={order.user_first_name} />
            {order.user_phone && (
              <InfoRow label={t('settings.phone')} value={order.user_phone} />
            )}
            {order.user_telegram_username && (
              <InfoRow label="Telegram" value={`@${order.user_telegram_username}`} />
            )}
            <InfoRow
              label={t('order.orderSummary')}
              value={t(`order.orderType.${order.order_type}`)}
            />
          </section>

          {/* Order items table */}
          {order.items.length > 0 && (
            <section style={styles.card}>
              <h2 style={styles.cardTitle}>{t('order.medicines')}</h2>
              <table style={styles.itemTable}>
                <thead>
                  <tr>
                    {canEditPrice && <th style={styles.itemThCenter}></th>}
                    <th style={styles.itemTh}>{t('medicine.name')}</th>
                    <th style={styles.itemThCenter}>{t('order.quantity')}</th>
                    <th style={styles.itemThRight}>
                      {canEditPrice ? t('staff.totalPrice') : t('staff.totalPrice')}
                    </th>
                    {canEditPrice && <th style={styles.itemThRight}>{t('orders.total')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => {
                    const isExcluded = excludedItems.has(item.id);
                    const priceVal = parseFloat(itemPrices[item.id] ?? '0') || 0;
                    const rowStyle = isExcluded
                      ? { opacity: 0.4, textDecoration: 'line-through' as const }
                      : {};

                    return (
                      <tr key={item.id}>
                        {canEditPrice && (
                          <td style={styles.itemTdCenter}>
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={() => toggleExclude(item.id)}
                              title={isExcluded
                                ? t('staff.includeItem', 'Qo\'shish')
                                : t('staff.excludeItem', 'Olib tashlash')}
                              style={{ cursor: 'pointer', width: 18, height: 18 }}
                            />
                          </td>
                        )}
                        <td style={{ ...styles.itemTd, ...rowStyle }}>
                          {item.medicine_name}
                        </td>
                        <td style={{ ...styles.itemTdCenter, ...rowStyle }}>
                          {item.quantity}
                        </td>
                        <td style={{ ...styles.itemTdRight, ...rowStyle }}>
                          {canEditPrice ? (
                            <input
                              style={{
                                ...styles.priceInput,
                                ...(isExcluded ? { opacity: 0.3, pointerEvents: 'none' as const } : {}),
                              }}
                              type="number"
                              min="0"
                              placeholder={t('staff.enterPrice', 'Narx kiriting')}
                              value={isExcluded ? '' : (itemPrices[item.id] ?? '')}
                              disabled={isExcluded}
                              onChange={(e) => {
                                const newPrices = { ...itemPrices, [item.id]: e.target.value };
                                setItemPrices(newPrices);
                                // Auto-update total from item prices
                                const sum = (order?.items ?? []).reduce((s, it) => {
                                  if (excludedItems.has(it.id)) return s;
                                  const p = parseFloat(newPrices[it.id] ?? '0') || 0;
                                  return s + p * it.quantity;
                                }, 0);
                                if (sum > 0) setTotalPrice(sum.toString());
                              }}
                            />
                          ) : item.unit_price !== null && item.unit_price > 0 ? (
                            `${item.unit_price.toLocaleString()} ${order.currency}`
                          ) : item.unit_price === 0 ? (
                            <span style={{ color: '#c62828', fontWeight: 600, fontSize: 12 }}>
                              {t('staff.unavailable')}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        {canEditPrice && (
                          <td style={{ ...styles.itemTdRight, ...rowStyle }}>
                            <span style={styles.subtotal}>
                              {!isExcluded && priceVal > 0
                                ? `${(priceVal * item.quantity).toLocaleString()} ${order.currency}`
                                : '—'}
                            </span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {/* Prescription images */}
          {order.prescriptions.length > 0 && (
            <section style={styles.card}>
              <h2 style={styles.cardTitle}>{t('staff.prescriptionImage')}</h2>
              <div style={styles.imageGrid}>
                {order.prescriptions.map((p) => (
                  <a key={p.id} href={p.download_url} target="_blank" rel="noreferrer">
                    <img
                      src={p.download_url}
                      alt={p.file_name}
                      style={styles.prescriptionImg}
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Reply image — editable for prescription orders in created/priced */}
          {order.order_type === 'prescription' &&
            canEditPrice && (
              <section style={styles.card}>
                <h2 style={styles.cardTitle}>
                  {t('staff.replyImage', 'Javob rasmi (skrinshot)')}
                </h2>
                {order.reply_image_url && (
                  <a
                    href={getReplyImageUrl(order.id)}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.imageLink}
                  >
                    <img
                      src={getReplyImageUrl(order.id)}
                      alt={t('staff.replyImage', 'Javob rasmi')}
                      style={styles.prescriptionImg}
                      loading="lazy"
                    />
                  </a>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  style={styles.fileInput}
                  onChange={(e) => setReplyImageFile(e.target.files?.[0] ?? null)}
                />
                {replyImageFile && <p style={styles.fileName}>{replyImageFile.name}</p>}
                <button
                  style={styles.btnSecondary}
                  onClick={handleUploadReplyImage}
                  disabled={uploadingImage || !replyImageFile}
                >
                  {uploadingImage
                    ? t('common.loading')
                    : order.reply_image_url
                    ? t('staff.replaceImage', 'Rasmni almashtirish')
                    : t('staff.uploadImage', 'Rasmni yuklash')}
                </button>
              </section>
            )}

          {/* Reply image read-only for non-editable statuses */}
          {order.reply_image_url &&
            order.order_type === 'prescription' &&
            !canEditPrice && (
              <section style={styles.card}>
                <h2 style={styles.cardTitle}>
                  {t('staff.replyImage', 'Javob rasmi')}
                </h2>
                <a
                  href={getReplyImageUrl(order.id)}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.imageLink}
                >
                  <img
                    src={getReplyImageUrl(order.id)}
                    alt={t('staff.replyImage', 'Javob rasmi')}
                    style={styles.prescriptionImg}
                    loading="lazy"
                  />
                </a>
              </section>
            )}

          {/* Notes */}
          {order.notes && (
            <section style={styles.card}>
              <h2 style={styles.cardTitle}>{t('order.notes')}</h2>
              <p style={styles.notes}>{order.notes}</p>
            </section>
          )}
        </div>

        {/* RIGHT — Actions panel */}
        <div style={styles.rightCol}>
          {/* Pricing form */}
          {canEditPrice && (
            <section style={styles.actionCard}>
              <h2 style={styles.cardTitle}>
                {order.status === 'priced'
                  ? t('staff.editPrice', 'Narxni tahrirlash')
                  : t('staff.priceOrder')}
              </h2>
              <label style={styles.inputLabel}>{t('staff.totalPrice')}</label>
              {order.items.length > 0 && calculatedTotal > 0 && (
                <div style={styles.calculatedHint}>
                  {t('staff.calculatedTotal', 'Hisoblangan')}: {calculatedTotal.toLocaleString()} {order.currency}
                </div>
              )}
              <input
                style={styles.totalInput}
                type="number"
                min="0"
                placeholder={t('staff.enterPrice', 'Narx kiriting')}
                value={totalPrice}
                onChange={(e) => setTotalPrice(e.target.value)}
              />
              <button
                style={styles.btnPrimary}
                onClick={handlePrice}
                disabled={actionLoading || !totalPrice || parseFloat(totalPrice) <= 0}
              >
                {order.status === 'priced'
                  ? t('staff.updatePrice', 'Narxni yangilash')
                  : t('staff.priceOrder')}
              </button>
            </section>
          )}

          {/* Payment info */}
          {order.payment_method && (
            <section style={styles.actionCard}>
              <h2 style={styles.cardTitle}>{t('orderStatus.paymentMethod.cash')}</h2>
              <span style={styles.payInfo}>
                {order.payment_method === 'cash'
                  ? t('staff.paymentStatus.cash')
                  : order.payment_status === 'paid'
                  ? t('staff.paymentStatus.paid')
                  : t('staff.paymentStatus.pending')}
              </span>
            </section>
          )}

          {/* Price display for non-editable */}
          {!canEditPrice && order.total_price !== null && (
            <section style={styles.actionCard}>
              <h2 style={styles.cardTitle}>{t('staff.totalPrice')}</h2>
              <span style={styles.totalDisplay}>
                {order.total_price.toLocaleString()} {order.currency}
              </span>
            </section>
          )}

          {error && <p style={styles.errText}>{error}</p>}

          {/* Status action buttons */}
          {!isTerminal && (
            <section style={styles.actionCard}>
              <h2 style={styles.cardTitle}>{t('staff.queue', 'Amallar')}</h2>

              {order.status === 'confirmed' && (
                <button
                  style={styles.btnPrimary}
                  onClick={handleReady}
                  disabled={actionLoading}
                >
                  {t('staff.markReady')}
                </button>
              )}

              {order.status === 'ready' && (
                <button
                  style={styles.btnPrimary}
                  onClick={handleComplete}
                  disabled={actionLoading}
                >
                  {t('staff.markComplete')}
                </button>
              )}

              {!showRejectForm &&
                ['created', 'priced', 'confirmed'].includes(order.status) && (
                  <button
                    style={styles.btnDanger}
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
                    style={styles.btnDanger}
                    onClick={handleReject}
                    disabled={actionLoading || !rejectionReason.trim()}
                  >
                    {t('staff.rejectOrder')}
                  </button>
                  <button
                    style={styles.btnGhost}
                    onClick={() => setShowRejectForm(false)}
                  >
                    {t('common.cancel')}
                  </button>
                </>
              )}
            </section>
          )}

          {/* Rejection reason (terminal) */}
          {order.rejection_reason && (
            <section style={{ ...styles.actionCard, borderLeft: '3px solid #c62828' }}>
              <h2 style={styles.cardTitle}>{t('staff.rejectionReason')}</h2>
              <p style={styles.rejectionText}>{order.rejection_reason}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component
// ---------------------------------------------------------------------------
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <span style={styles.infoValue}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100%' },
  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
  },
  backBtn: {
    padding: '6px 0',
    border: 'none',
    background: 'transparent',
    color: '#1565c0',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'block',
    marginBottom: 8,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 24,
  },
  title: { margin: 0, fontSize: 24, fontWeight: 700 },
  statusBadge: {
    fontSize: 13,
    fontWeight: 700,
    padding: '4px 14px',
    borderRadius: 20,
  },
  columns: {
    display: 'flex',
    gap: 24,
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  leftCol: {
    flex: '1 1 500px',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  rightCol: {
    flex: '0 0 360px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    position: 'sticky',
    top: 24,
  },
  card: {
    background: '#f8f9fa',
    borderRadius: 10,
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  actionCard: {
    background: '#f8f9fa',
    borderRadius: 10,
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  cardTitle: {
    margin: 0,
    fontSize: 13,
    fontWeight: 700,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    padding: '2px 0',
  },
  infoLabel: { fontSize: 14, color: '#888' },
  infoValue: { fontSize: 14, fontWeight: 600 },

  // Items table
  itemTable: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  itemTh: {
    textAlign: 'left',
    padding: '8px 10px',
    fontSize: 12,
    fontWeight: 600,
    color: '#888',
    borderBottom: '1px solid #e0e0e0',
  },
  itemThCenter: {
    textAlign: 'center',
    padding: '8px 10px',
    fontSize: 12,
    fontWeight: 600,
    color: '#888',
    borderBottom: '1px solid #e0e0e0',
  },
  itemThRight: {
    textAlign: 'right',
    padding: '8px 10px',
    fontSize: 12,
    fontWeight: 600,
    color: '#888',
    borderBottom: '1px solid #e0e0e0',
  },
  itemTd: {
    padding: '10px',
    fontSize: 14,
    fontWeight: 500,
    borderBottom: '1px solid #f0f0f0',
  },
  itemTdCenter: {
    textAlign: 'center',
    padding: '10px',
    fontSize: 14,
    borderBottom: '1px solid #f0f0f0',
  },
  itemTdRight: {
    textAlign: 'right',
    padding: '10px',
    fontSize: 14,
    borderBottom: '1px solid #f0f0f0',
  },
  priceInput: {
    width: 100,
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid #ccc',
    fontSize: 14,
    textAlign: 'right',
    boxSizing: 'border-box',
  },
  subtotal: {
    fontWeight: 600,
    color: '#333',
  },

  // Images
  imageGrid: {
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap',
  },
  prescriptionImg: {
    maxWidth: '100%',
    maxHeight: 400,
    objectFit: 'contain',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    display: 'block',
  },
  imageLink: {
    display: 'block',
  },
  fileInput: {
    width: '100%',
    padding: '8px 0',
    fontSize: 13,
    boxSizing: 'border-box' as const,
  },
  fileName: {
    margin: 0,
    fontSize: 12,
    color: '#888',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },

  notes: { margin: 0, fontSize: 14, color: '#333' },

  // Action buttons
  inputLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: '#888',
  },
  totalReadonly: {
    padding: '10px 12px',
    borderRadius: 8,
    background: '#e8f5e9',
    fontSize: 18,
    fontWeight: 700,
    color: '#1b5e20',
  },
  totalInput: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #ccc',
    fontSize: 16,
    fontWeight: 700,
    boxSizing: 'border-box',
  },
  calculatedHint: {
    fontSize: 12,
    color: '#1b5e20',
    background: '#e8f5e9',
    padding: '4px 8px',
    borderRadius: 6,
    fontWeight: 600,
  },
  totalDisplay: {
    fontSize: 22,
    fontWeight: 700,
    color: '#1b5e20',
  },
  payInfo: {
    fontSize: 14,
    fontWeight: 600,
  },
  btnPrimary: {
    padding: '12px 0',
    borderRadius: 8,
    border: 'none',
    background: '#1565c0',
    color: '#fff',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    width: '100%',
  },
  btnSecondary: {
    padding: '10px 0',
    borderRadius: 8,
    border: '1px solid #1565c0',
    background: '#fff',
    color: '#1565c0',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
  },
  btnDanger: {
    padding: '12px 0',
    borderRadius: 8,
    border: '1.5px solid #c62828',
    background: 'transparent',
    color: '#c62828',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    width: '100%',
  },
  btnGhost: {
    padding: '10px 0',
    borderRadius: 8,
    border: 'none',
    background: '#eee',
    color: '#666',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
  },
  reasonInput: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #c62828',
    fontSize: 14,
    resize: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  rejectionText: {
    margin: 0,
    fontSize: 14,
    color: '#c62828',
  },
  errText: {
    color: '#c62828',
    fontSize: 13,
    textAlign: 'center',
    padding: '8px 0',
    margin: 0,
  },
};
