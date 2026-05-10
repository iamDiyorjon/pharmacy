import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
	getStaffOrder,
	updateStaffOrder,
	confirmStaffOrder,
	completeOrder,
	rejectOrder,
	staffCancelOrder,
	uploadReplyImage,
	getReplyImageUrl,
	type StaffOrder,
	type UpdateOrderItem,
} from "../../services/api";
import { subscribeToStaffOrders } from "../../services/orderEvents";

interface EditableItem {
	key: string;
	medicine_id: string | null;
	medicine_name: string;
	quantity: number;
	unit_price: number | null;
}

const STATUS_COLOR: Record<string, string> = {
	created: "#1565c0",
	ready: "#1b5e20",
	completed: "#2e7d32",
	cancelled: "#888",
	rejected: "#c62828",
};

function newKey() {
	return Math.random().toString(36).slice(2, 10);
}

function itemsFromOrder(order: StaffOrder): EditableItem[] {
	return order.items.map((it) => ({
		key: it.id,
		medicine_id: it.medicine_id ?? null,
		medicine_name: it.medicine_name,
		quantity: it.quantity,
		unit_price: it.unit_price,
	}));
}

export default function StaffOrderDetail() {
	const { t } = useTranslation();
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();

	const [order, setOrder] = useState<StaffOrder | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [actionLoading, setActionLoading] = useState(false);

	const [mode, setMode] = useState<"view" | "edit">("view");
	const [editItems, setEditItems] = useState<EditableItem[]>([]);
	const [editTotal, setEditTotal] = useState("");
	const [totalManuallyEdited, setTotalManuallyEdited] = useState(false);

	const [showRejectForm, setShowRejectForm] = useState(false);
	const [rejectionReason, setRejectionReason] = useState("");

	const [replyImageFile, setReplyImageFile] = useState<File | null>(null);
	const [uploadingImage, setUploadingImage] = useState(false);

	const fetchOrder = useCallback(async () => {
		if (!id) return;
		try {
			const data = await getStaffOrder(id);
			setOrder(data);
		} catch {
			setError(t("errors.orderNotFound"));
		} finally {
			setLoading(false);
		}
	}, [id, t]);

	useEffect(() => {
		fetchOrder();
	}, [fetchOrder]);

	useEffect(() => {
		if (!id) return;
		const unsubscribe = subscribeToStaffOrders((event) => {
			if (event.order_id === id && mode === "view") {
				fetchOrder();
			}
		});
		return unsubscribe;
	}, [id, mode, fetchOrder]);

	const calculatedTotal = useMemo(() => {
		return editItems.reduce(
			(sum, it) => sum + (it.unit_price ?? 0) * it.quantity,
			0,
		);
	}, [editItems]);

	useEffect(() => {
		if (mode !== "edit" || totalManuallyEdited) return;
		if (calculatedTotal > 0) setEditTotal(String(calculatedTotal));
	}, [calculatedTotal, mode, totalManuallyEdited]);

	function enterEditMode() {
		if (!order) return;
		setEditItems(itemsFromOrder(order));
		setEditTotal(order.total_price !== null ? String(order.total_price) : "");
		setTotalManuallyEdited(false);
		setMode("edit");
	}

	function discardEdits() {
		setMode("view");
		setEditItems([]);
		setEditTotal("");
		setTotalManuallyEdited(false);
	}

	function updateEditItem(key: string, patch: Partial<EditableItem>) {
		setEditItems((prev) =>
			prev.map((it) => (it.key === key ? { ...it, ...patch } : it)),
		);
	}

	function removeEditItem(key: string) {
		setEditItems((prev) => prev.filter((it) => it.key !== key));
	}

	function addEditItem() {
		setEditItems((prev) => [
			...prev,
			{
				key: newKey(),
				medicine_id: null,
				medicine_name: "",
				quantity: 1,
				unit_price: null,
			},
		]);
	}

	function applyCalculatedTotal() {
		if (calculatedTotal > 0) {
			setEditTotal(String(calculatedTotal));
			setTotalManuallyEdited(false);
		}
	}

	async function handleSave() {
		if (!id) return;
		const payloadItems: UpdateOrderItem[] = editItems
			.filter((it) => it.medicine_name.trim().length > 0)
			.map((it) => ({
				medicine_id: it.medicine_id,
				medicine_name: it.medicine_name.trim(),
				quantity: it.quantity,
				unit_price: it.unit_price,
			}));

		const totalPriceNum = editTotal ? parseFloat(editTotal) : null;

		setActionLoading(true);
		try {
			const updated = await updateStaffOrder(id, {
				items: payloadItems,
				total_price: totalPriceNum,
			});
			setOrder(updated);
			setMode("view");
		} catch {
			setError(t("errors.networkError"));
		} finally {
			setActionLoading(false);
		}
	}

	async function handleConfirm() {
		if (!id) return;
		setActionLoading(true);
		try {
			const updated = await confirmStaffOrder(id);
			setOrder(updated);
		} catch (e: unknown) {
			const err = e as { response?: { data?: { detail?: string } } };
			setError(err?.response?.data?.detail ?? t("errors.networkError"));
		} finally {
			setActionLoading(false);
		}
	}

	async function handleComplete() {
		if (!id) return;
		setActionLoading(true);
		try {
			const updated = await completeOrder(id);
			setOrder(updated);
		} catch {
			setError(t("errors.networkError"));
		} finally {
			setActionLoading(false);
		}
	}

	async function handleReject() {
		if (!id || !rejectionReason.trim()) return;
		setActionLoading(true);
		try {
			const updated = await rejectOrder(id, rejectionReason);
			setOrder(updated);
			setShowRejectForm(false);
		} catch {
			setError(t("errors.networkError"));
		} finally {
			setActionLoading(false);
		}
	}

	async function handleStaffCancel() {
		if (
			!id ||
			!window.confirm(t("staff.confirmCancel", "Buyurtmani bekor qilish?"))
		)
			return;
		setActionLoading(true);
		try {
			const updated = await staffCancelOrder(id);
			setOrder(updated);
		} catch {
			setError(t("errors.networkError"));
		} finally {
			setActionLoading(false);
		}
	}

	async function handleUploadReplyImage() {
		if (!id || !replyImageFile) return;
		setUploadingImage(true);
		try {
			const updated = await uploadReplyImage(id, replyImageFile);
			setOrder(updated);
			setReplyImageFile(null);
		} catch {
			setError(t("errors.networkError"));
		} finally {
			setUploadingImage(false);
		}
	}

	if (loading) {
		return (
			<div style={styles.center}>
				<p>{t("common.loading")}</p>
			</div>
		);
	}
	if (error && !order) {
		return (
			<div style={styles.center}>
				<p style={styles.errText}>{error}</p>
			</div>
		);
	}
	if (!order) return null;

	const isCreated = order.status === "created";
	const isReady = order.status === "ready";
	const isTerminal = ["completed", "cancelled", "rejected"].includes(
		order.status,
	);

	return (
		<div style={styles.page}>
			<button style={styles.backBtn} onClick={() => navigate("/staff")}>
				{"←"} {t("common.back")}
			</button>

			<header style={styles.header}>
				<h1 style={styles.title}>#{order.order_number}</h1>
				<span
					style={{
						...styles.statusBadge,
						background: (STATUS_COLOR[order.status] ?? "#888") + "18",
						color: STATUS_COLOR[order.status] ?? "#888",
					}}
				>
					{t(`orderStatus.status.${order.status}`)}
				</span>
				{mode === "edit" && (
					<span style={styles.editBadge}>
						{t("staff.editing", "Tahrirlash")}
					</span>
				)}
			</header>

			<div className="staff-order-columns" style={styles.columns}>
				<div style={styles.leftCol}>
					{/* Customer info */}
					<section style={styles.card}>
						<h2 style={styles.cardTitle}>{t("staff.customerInfo")}</h2>
						<InfoRow
							label={t("settings.firstName")}
							value={order.user_first_name}
						/>
						{order.contact_phone ? (
							<InfoRow
								label={t("settings.phone")}
								value={order.contact_phone}
								badge={t("staff.alternatePhone", "Boshqa raqam")}
							/>
						) : (
							order.user_phone && (
								<InfoRow label={t("settings.phone")} value={order.user_phone} />
							)
						)}
						{order.user_telegram_username && (
							<InfoRow
								label="Telegram"
								value={`@${order.user_telegram_username}`}
							/>
						)}
						<InfoRow
							label={t("order.orderSummary")}
							value={t(`order.orderType.${order.order_type}`)}
						/>
					</section>

					{/* Items — read-only in view mode */}
					{mode === "view" && order.items.length > 0 && (
						<section style={styles.card}>
							<h2 style={styles.cardTitle}>{t("order.medicines")}</h2>
							<table style={styles.itemTable}>
								<thead>
									<tr>
										<th style={styles.itemTh}>{t("medicine.name")}</th>
										<th style={styles.itemThCenter}>{t("order.quantity")}</th>
										<th style={styles.itemThRight}>{t("staff.totalPrice")}</th>
									</tr>
								</thead>
								<tbody>
									{order.items.map((item) => (
										<tr key={item.id}>
											<td style={styles.itemTd}>{item.medicine_name}</td>
											<td style={styles.itemTdCenter}>{item.quantity}</td>
											<td style={styles.itemTdRight}>
												{item.unit_price !== null && item.unit_price > 0
													? `${item.unit_price.toLocaleString()} ${order.currency}`
													: "—"}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</section>
					)}

					{/* Items — editable in edit mode */}
					{mode === "edit" && (
						<section style={styles.card}>
							<h2 style={styles.cardTitle}>{t("order.medicines")}</h2>
							<table style={styles.itemTable}>
								<thead>
									<tr>
										<th style={styles.itemTh}>{t("medicine.name")}</th>
										<th style={styles.itemThCenter}>{t("order.quantity")}</th>
										<th style={styles.itemThRight}>{t("staff.totalPrice")}</th>
										<th style={styles.itemThCenter}></th>
									</tr>
								</thead>
								<tbody>
									{editItems.map((it) => (
										<tr key={it.key}>
											<td style={styles.itemTd}>
												<input
													style={styles.nameInput}
													type="text"
													value={it.medicine_name}
													onChange={(e) =>
														updateEditItem(it.key, {
															medicine_name: e.target.value,
														})
													}
													placeholder={t("medicine.name")}
												/>
											</td>
											<td style={styles.itemTdCenter}>
												<input
													style={styles.qtyInput}
													type="number"
													min="1"
													value={it.quantity}
													onChange={(e) =>
														updateEditItem(it.key, {
															quantity: Math.max(
																1,
																parseInt(e.target.value) || 1,
															),
														})
													}
												/>
											</td>
											<td style={styles.itemTdRight}>
												<input
													style={styles.priceInput}
													type="number"
													min="0"
													value={it.unit_price ?? ""}
													onChange={(e) => {
														const v = e.target.value;
														updateEditItem(it.key, {
															unit_price: v ? parseFloat(v) : null,
														});
													}}
													placeholder={t("staff.enterPrice", "Narx")}
												/>
											</td>
											<td style={styles.itemTdCenter}>
												<button
													type="button"
													style={styles.removeBtn}
													onClick={() => removeEditItem(it.key)}
													title={t("staff.removeItem", "O'chirish")}
												>
													✕
												</button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
							<button
								type="button"
								style={styles.addItemBtn}
								onClick={addEditItem}
							>
								+ {t("staff.addItem", "Dori qo'shish")}
							</button>
						</section>
					)}

					{/* Prescription images */}
					{order.prescriptions.length > 0 && (
						<section style={styles.card}>
							<h2 style={styles.cardTitle}>{t("staff.prescriptionImage")}</h2>
							<div style={styles.imageGrid}>
								{order.prescriptions.map((p) => (
									<a
										key={p.id}
										href={p.download_url}
										target="_blank"
										rel="noreferrer"
									>
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

					{/* Reply image — uploadable in edit mode for prescription orders */}
					{order.order_type === "prescription" &&
						mode === "edit" &&
						isCreated && (
							<section style={styles.card}>
								<h2 style={styles.cardTitle}>
									{t("staff.replyImage", "Javob rasmi")}
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
											alt={t("staff.replyImage", "Javob rasmi")}
											style={styles.prescriptionImg}
											loading="lazy"
										/>
									</a>
								)}
								<input
									type="file"
									accept="image/jpeg,image/png"
									style={styles.fileInput}
									onChange={(e) =>
										setReplyImageFile(e.target.files?.[0] ?? null)
									}
								/>
								{replyImageFile && (
									<p style={styles.fileName}>{replyImageFile.name}</p>
								)}
								<button
									style={styles.btnSecondary}
									onClick={handleUploadReplyImage}
									disabled={uploadingImage || !replyImageFile}
								>
									{uploadingImage
										? t("common.loading")
										: order.reply_image_url
											? t("staff.replaceImage", "Rasmni almashtirish")
											: t("staff.uploadImage", "Rasmni yuklash")}
								</button>
							</section>
						)}

					{order.reply_image_url &&
						order.order_type === "prescription" &&
						mode === "view" && (
							<section style={styles.card}>
								<h2 style={styles.cardTitle}>
									{t("staff.replyImage", "Javob rasmi")}
								</h2>
								<a
									href={getReplyImageUrl(order.id)}
									target="_blank"
									rel="noreferrer"
									style={styles.imageLink}
								>
									<img
										src={getReplyImageUrl(order.id)}
										alt={t("staff.replyImage", "Javob rasmi")}
										style={styles.prescriptionImg}
										loading="lazy"
									/>
								</a>
							</section>
						)}

					{order.notes && (
						<section style={styles.card}>
							<h2 style={styles.cardTitle}>{t("order.notes")}</h2>
							<p style={styles.notes}>{order.notes}</p>
						</section>
					)}
				</div>

				<div style={styles.rightCol}>
					{/* Total price section */}
					<section style={styles.actionCard}>
						<h2 style={styles.cardTitle}>{t("staff.totalPrice")}</h2>
						{mode === "view" ? (
							order.total_price !== null ? (
								<span style={styles.totalDisplay}>
									{order.total_price.toLocaleString()} {order.currency}
								</span>
							) : (
								<span style={{ color: "#bbb" }}>—</span>
							)
						) : (
							<>
								{calculatedTotal > 0 && (
									<button
										type="button"
										style={styles.calculatedHint}
										onClick={applyCalculatedTotal}
										title={t("staff.applyCalculated", "Hisoblanganni qo'llash")}
									>
										{t("staff.calculatedTotal", "Hisoblangan")}:{" "}
										{calculatedTotal.toLocaleString()} {order.currency}
									</button>
								)}
								<input
									style={styles.totalInput}
									type="number"
									min="0"
									placeholder={t("staff.enterPrice", "Narx kiriting")}
									value={editTotal}
									onChange={(e) => {
										setEditTotal(e.target.value);
										setTotalManuallyEdited(true);
									}}
								/>
							</>
						)}
					</section>

					{error && <p style={styles.errText}>{error}</p>}

					{/* Actions */}
					{mode === "edit" && (
						<section style={styles.actionCard}>
							<button
								style={styles.btnPrimary}
								onClick={handleSave}
								disabled={actionLoading}
							>
								{t("staff.saveChanges", "Saqlash")}
							</button>
							<button
								style={styles.btnGhost}
								onClick={discardEdits}
								disabled={actionLoading}
							>
								{t("common.cancel")}
							</button>
						</section>
					)}

					{mode === "view" && !isTerminal && (
						<section style={styles.actionCard}>
							<h2 style={styles.cardTitle}>{t("staff.queue", "Amallar")}</h2>

							{isCreated && (
								<>
									<button
										style={styles.btnPrimary}
										onClick={handleConfirm}
										disabled={
											actionLoading ||
											order.total_price === null ||
											order.total_price <= 0
										}
									>
										{t("staff.confirmOrder", "Tasdiqlash")}
									</button>
									<button
										style={styles.btnSecondary}
										onClick={enterEditMode}
										disabled={actionLoading}
									>
										{t("staff.editOrder", "Tahrirlash")}
									</button>
								</>
							)}

							{isReady && (
								<button
									style={styles.btnPrimary}
									onClick={handleComplete}
									disabled={actionLoading}
								>
									{t("staff.markComplete")}
								</button>
							)}

							{!showRejectForm && isCreated && (
								<button
									style={styles.btnDanger}
									onClick={() => setShowRejectForm(true)}
									disabled={actionLoading}
								>
									{t("staff.rejectOrder")}
								</button>
							)}

							{showRejectForm && (
								<>
									<textarea
										style={styles.reasonInput}
										placeholder={t("staff.rejectionReasonPlaceholder")}
										value={rejectionReason}
										rows={3}
										onChange={(e) => setRejectionReason(e.target.value)}
									/>
									<button
										style={styles.btnDanger}
										onClick={handleReject}
										disabled={actionLoading || !rejectionReason.trim()}
									>
										{t("staff.rejectOrder")}
									</button>
									<button
										style={styles.btnGhost}
										onClick={() => setShowRejectForm(false)}
									>
										{t("common.cancel")}
									</button>
								</>
							)}

							{(isCreated || isReady) && (
								<button
									style={styles.btnDanger}
									onClick={handleStaffCancel}
									disabled={actionLoading}
								>
									{t("staff.cancelOrder", "Buyurtmani bekor qilish")}
								</button>
							)}
						</section>
					)}

					{order.rejection_reason && (
						<section
							style={{ ...styles.actionCard, borderLeft: "3px solid #c62828" }}
						>
							<h2 style={styles.cardTitle}>{t("staff.rejectionReason")}</h2>
							<p style={styles.rejectionText}>{order.rejection_reason}</p>
						</section>
					)}
				</div>
			</div>
		</div>
	);
}

function InfoRow({
	label,
	value,
	badge,
}: {
	label: string;
	value: string;
	badge?: string;
}) {
	return (
		<div style={styles.infoRow}>
			<span style={styles.infoLabel}>{label}</span>
			<span style={styles.infoValueWrap}>
				<span style={styles.infoValue}>{value}</span>
				{badge && <span style={styles.altBadge}>🔄 {badge}</span>}
			</span>
		</div>
	);
}

const styles: Record<string, React.CSSProperties> = {
	page: { minHeight: "100%" },
	center: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		height: "60vh",
	},
	backBtn: {
		padding: "6px 0",
		border: "none",
		background: "transparent",
		color: "#1565c0",
		fontSize: 14,
		fontWeight: 600,
		cursor: "pointer",
		display: "block",
		marginBottom: 8,
	},
	header: { display: "flex", alignItems: "center", gap: 16, marginBottom: 24 },
	title: { margin: 0, fontSize: 24, fontWeight: 700 },
	statusBadge: {
		fontSize: 13,
		fontWeight: 700,
		padding: "4px 14px",
		borderRadius: 20,
	},
	editBadge: {
		fontSize: 12,
		fontWeight: 700,
		padding: "3px 10px",
		borderRadius: 12,
		background: "#fff3e0",
		color: "#e65100",
		letterSpacing: 0.4,
	},
	columns: {
		display: "flex",
		gap: 24,
		alignItems: "flex-start",
		flexWrap: "wrap",
	},
	leftCol: {
		flex: "1 1 500px",
		minWidth: 0,
		display: "flex",
		flexDirection: "column",
		gap: 16,
	},
	rightCol: {
		flex: "0 0 360px",
		display: "flex",
		flexDirection: "column",
		gap: 16,
		position: "sticky",
		top: 24,
	},
	card: {
		background: "#f8f9fa",
		borderRadius: 10,
		padding: "16px 20px",
		display: "flex",
		flexDirection: "column",
		gap: 10,
	},
	actionCard: {
		background: "#f8f9fa",
		borderRadius: 10,
		padding: "16px 20px",
		display: "flex",
		flexDirection: "column",
		gap: 10,
	},
	cardTitle: {
		margin: 0,
		fontSize: 13,
		fontWeight: 700,
		color: "#888",
		textTransform: "uppercase",
		letterSpacing: 0.5,
	},
	infoRow: {
		display: "flex",
		justifyContent: "space-between",
		gap: 8,
		padding: "2px 0",
	},
	infoLabel: { fontSize: 14, color: "#888" },
	infoValueWrap: {
		display: "inline-flex",
		alignItems: "center",
		gap: 8,
		flexWrap: "wrap",
		justifyContent: "flex-end",
	},
	infoValue: { fontSize: 14, fontWeight: 600 },
	altBadge: {
		fontSize: 11,
		fontWeight: 700,
		padding: "2px 8px",
		borderRadius: 10,
		background: "#fff3e0",
		color: "#e65100",
		letterSpacing: 0.3,
		whiteSpace: "nowrap",
	},
	itemTable: { width: "100%", borderCollapse: "collapse" },
	itemTh: {
		textAlign: "left",
		padding: "8px 10px",
		fontSize: 12,
		fontWeight: 600,
		color: "#888",
		borderBottom: "1px solid #e0e0e0",
	},
	itemThCenter: {
		textAlign: "center",
		padding: "8px 10px",
		fontSize: 12,
		fontWeight: 600,
		color: "#888",
		borderBottom: "1px solid #e0e0e0",
	},
	itemThRight: {
		textAlign: "right",
		padding: "8px 10px",
		fontSize: 12,
		fontWeight: 600,
		color: "#888",
		borderBottom: "1px solid #e0e0e0",
	},
	itemTd: {
		padding: "10px",
		fontSize: 14,
		fontWeight: 500,
		borderBottom: "1px solid #f0f0f0",
	},
	itemTdCenter: {
		textAlign: "center",
		padding: "10px",
		fontSize: 14,
		borderBottom: "1px solid #f0f0f0",
	},
	itemTdRight: {
		textAlign: "right",
		padding: "10px",
		fontSize: 14,
		borderBottom: "1px solid #f0f0f0",
	},
	nameInput: {
		width: "100%",
		padding: "6px 10px",
		borderRadius: 6,
		border: "1px solid #ccc",
		fontSize: 14,
		boxSizing: "border-box",
	},
	qtyInput: {
		width: 60,
		padding: "6px 8px",
		borderRadius: 6,
		border: "1px solid #ccc",
		fontSize: 14,
		textAlign: "center",
		boxSizing: "border-box",
	},
	priceInput: {
		width: 110,
		padding: "6px 10px",
		borderRadius: 6,
		border: "1px solid #ccc",
		fontSize: 14,
		textAlign: "right",
		boxSizing: "border-box",
	},
	removeBtn: {
		width: 26,
		height: 26,
		border: "none",
		background: "#fce4ec",
		color: "#c62828",
		borderRadius: "50%",
		cursor: "pointer",
		fontSize: 13,
		fontWeight: 700,
	},
	addItemBtn: {
		padding: "8px 14px",
		border: "1px dashed #1565c0",
		background: "transparent",
		color: "#1565c0",
		fontSize: 13,
		fontWeight: 600,
		cursor: "pointer",
		borderRadius: 6,
		alignSelf: "flex-start",
	},
	imageGrid: { display: "flex", gap: 12, flexWrap: "wrap" },
	prescriptionImg: {
		maxWidth: "100%",
		maxHeight: 400,
		objectFit: "contain",
		borderRadius: 8,
		border: "1px solid #e0e0e0",
		display: "block",
	},
	imageLink: { display: "block" },
	fileInput: {
		width: "100%",
		padding: "8px 0",
		fontSize: 13,
		boxSizing: "border-box" as const,
	},
	fileName: {
		margin: 0,
		fontSize: 12,
		color: "#888",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap" as const,
	},
	notes: { margin: 0, fontSize: 14, color: "#333" },
	totalDisplay: { fontSize: 22, fontWeight: 700, color: "#1b5e20" },
	totalInput: {
		width: "100%",
		padding: "10px 12px",
		borderRadius: 8,
		border: "1px solid #ccc",
		fontSize: 16,
		fontWeight: 700,
		boxSizing: "border-box",
	},
	calculatedHint: {
		fontSize: 12,
		color: "#1b5e20",
		background: "#e8f5e9",
		padding: "4px 8px",
		borderRadius: 6,
		fontWeight: 600,
		border: "none",
		cursor: "pointer",
		textAlign: "left",
	},
	btnPrimary: {
		padding: "12px 0",
		borderRadius: 8,
		border: "none",
		background: "#1565c0",
		color: "#fff",
		fontSize: 15,
		fontWeight: 700,
		cursor: "pointer",
		width: "100%",
	},
	btnSecondary: {
		padding: "10px 0",
		borderRadius: 8,
		border: "1px solid #1565c0",
		background: "#fff",
		color: "#1565c0",
		fontSize: 14,
		fontWeight: 600,
		cursor: "pointer",
		width: "100%",
	},
	btnDanger: {
		padding: "12px 0",
		borderRadius: 8,
		border: "1.5px solid #c62828",
		background: "transparent",
		color: "#c62828",
		fontSize: 15,
		fontWeight: 700,
		cursor: "pointer",
		width: "100%",
	},
	btnGhost: {
		padding: "10px 0",
		borderRadius: 8,
		border: "none",
		background: "#eee",
		color: "#666",
		fontSize: 14,
		fontWeight: 600,
		cursor: "pointer",
		width: "100%",
	},
	reasonInput: {
		width: "100%",
		padding: "10px 12px",
		borderRadius: 8,
		border: "1px solid #c62828",
		fontSize: 14,
		resize: "none",
		fontFamily: "inherit",
		boxSizing: "border-box",
	},
	rejectionText: { margin: 0, fontSize: 14, color: "#c62828" },
	errText: {
		color: "#c62828",
		fontSize: 13,
		textAlign: "center",
		padding: "8px 0",
		margin: 0,
	},
};
