import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import PageHeader from "../components/PageHeader";
import {
	getPharmacies,
	createOrder,
	type Pharmacy,
	type CreateOrderItem,
} from "../services/api";

// ---------------------------------------------------------------------------
// State coming from Search page via location.state
// ---------------------------------------------------------------------------
interface LocationState {
	items?: CreateOrderItem[];
	pharmacy_id?: string;
}

export default function Order() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const location = useLocation();
	const state = (location.state ?? {}) as LocationState;

	const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
	const [pharmacyId, setPharmacyId] = useState(state.pharmacy_id ?? "");
	const [items, setItems] = useState<CreateOrderItem[]>(state.items ?? []);
	const [notes, setNotes] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const savedPhone = (localStorage.getItem("user_phone") || "").trim();
	const [phoneMode, setPhoneMode] = useState<"saved" | "other">(
		savedPhone ? "saved" : "other",
	);
	const [otherPhone, setOtherPhone] = useState("");

	const PHONE_RE = /^\+?\d{9,15}$/;

	useEffect(() => {
		getPharmacies()
			.then((data) => setPharmacies(data))
			.catch(() => {});
	}, []);

	const selectedPharmacy = pharmacies.find((p) => p.id === pharmacyId);

	function updateQuantity(idx: number, quantity: number) {
		if (quantity < 1) return;
		setItems((prev) =>
			prev.map((item, i) => (i === idx ? { ...item, quantity } : item)),
		);
	}

	function removeItem(idx: number) {
		setItems((prev) => prev.filter((_, i) => i !== idx));
	}

	async function handleSubmit() {
		if (!pharmacyId) {
			setError(t("order.selectPharmacy"));
			return;
		}
		if (items.length === 0) {
			setError(t("order.emptyItems"));
			return;
		}

		let contactPhone: string | undefined;
		if (phoneMode === "other") {
			const trimmed = otherPhone.trim().replace(/\s/g, "");
			if (!trimmed) {
				setError(t("order.phoneRequired", "Telefon raqam kiritish shart"));
				return;
			}
			if (!PHONE_RE.test(trimmed)) {
				setError(t("order.phoneInvalid", "Raqam noto'g'ri formatda"));
				return;
			}
			contactPhone = trimmed;
		}

		setError(null);
		setSubmitting(true);
		try {
			const order = await createOrder({
				pharmacy_id: pharmacyId,
				order_type: "medicine_search",
				items,
				notes: notes || undefined,
				contact_phone: contactPhone,
			});
			navigate(`/order/${order.id}`);
		} catch {
			setError(t("errors.networkError"));
		} finally {
			setSubmitting(false);
		}
	}

	const totalItems = items.reduce((s, i) => s + i.quantity, 0);
	const totalPrice = items.reduce((s, i) => {
		if (i.unit_price != null) return s + i.unit_price * i.quantity;
		return s;
	}, 0);
	const allPriced =
		items.length > 0 && items.every((i) => i.unit_price != null);

	return (
		<div style={styles.page}>
			<PageHeader title={t("order.newOrder")}>
				{selectedPharmacy && (
					<div style={styles.pharmacyTag}>
						<span style={styles.pharmacyIcon}>{"\uD83C\uDFE5"}</span>
						<span style={styles.pharmacyName}>{selectedPharmacy.name}</span>
					</div>
				)}
			</PageHeader>

			<div style={styles.form}>
				{/* Pharmacy selector */}
				<div style={styles.fieldGroup}>
					<label style={styles.label}>{t("order.selectPharmacy")}</label>
					<select
						style={styles.select}
						value={pharmacyId}
						onChange={(e) => setPharmacyId(e.target.value)}
					>
						<option value="">{t("order.selectPharmacy")}</option>
						{pharmacies.map((p) => (
							<option key={p.id} value={p.id}>
								{p.name}
							</option>
						))}
					</select>
				</div>

				{/* Items list */}
				<div style={styles.fieldGroup}>
					<div style={styles.labelRow}>
						<label style={styles.label}>{t("order.medicines")}</label>
						{items.length > 0 && (
							<span style={styles.countBadge}>{totalItems}</span>
						)}
					</div>

					{items.length === 0 ? (
						<div style={styles.emptyBox}>
							<span style={styles.emptyIcon}>{"\uD83D\uDC8A"}</span>
							<p style={styles.emptyText}>{t("order.emptyItems")}</p>
							<button
								style={styles.browseBtn}
								onClick={() => navigate("/search")}
							>
								{t("order.goToSearch")}
							</button>
						</div>
					) : (
						<div style={styles.itemList}>
							{items.map((item, idx) => (
								<div key={idx} style={styles.itemCard}>
									<div style={styles.itemTop}>
										<div style={styles.itemInfo}>
											<span style={styles.itemName}>{item.medicine_name}</span>
										</div>
										<div style={styles.itemActions}>
											<div style={styles.qtyControl}>
												<button
													style={styles.qtyBtn}
													onClick={() => updateQuantity(idx, item.quantity - 1)}
												>
													{"\u2212"}
												</button>
												<span style={styles.qtyValue}>{item.quantity}</span>
												<button
													style={{ ...styles.qtyBtn, ...styles.qtyBtnPlus }}
													onClick={() => updateQuantity(idx, item.quantity + 1)}
												>
													+
												</button>
											</div>
											<button
												style={styles.removeBtn}
												onClick={() => removeItem(idx)}
											>
												{"\u00D7"}
											</button>
										</div>
									</div>
									{item.unit_price != null && (
										<div style={styles.itemPriceRow}>
											<span style={styles.itemPriceLabel}>
												{item.unit_price.toLocaleString()} x {item.quantity}
											</span>
											<span style={styles.itemPriceValue}>
												{(item.unit_price * item.quantity).toLocaleString()}{" "}
												{t("common.sum", "so'm")}
											</span>
										</div>
									)}
								</div>
							))}
						</div>
					)}
				</div>

				{/* Notes */}
				<div style={styles.fieldGroup}>
					<label style={styles.label}>{t("order.notes")}</label>
					<textarea
						style={styles.textarea}
						placeholder={t("order.notesPlaceholder")}
						value={notes}
						rows={3}
						onChange={(e) => setNotes(e.target.value)}
					/>
				</div>

				{/* Contact phone */}
				<div style={styles.fieldGroup}>
					<label style={styles.label}>
						{t("order.contactPhone", "Aloqa raqami")}
					</label>
					<p style={styles.phoneHint}>
						{t(
							"order.contactPhoneHint",
							"Dorixona kerak bo'lsa shu raqamga qo'ng'iroq qiladi.",
						)}
					</p>
					{savedPhone && (
						<label style={styles.phoneOption}>
							<input
								type="radio"
								name="phoneMode"
								value="saved"
								checked={phoneMode === "saved"}
								onChange={() => setPhoneMode("saved")}
							/>
							<span style={styles.phoneOptionLabel}>
								{t("order.myPhone", "Mening raqamim")}:
							</span>
							<span style={styles.phoneValue}>{savedPhone}</span>
						</label>
					)}
					<label style={styles.phoneOption}>
						<input
							type="radio"
							name="phoneMode"
							value="other"
							checked={phoneMode === "other"}
							onChange={() => setPhoneMode("other")}
						/>
						<span style={styles.phoneOptionLabel}>
							{t("order.otherPhone", "Boshqa raqam")}
						</span>
					</label>
					{phoneMode === "other" && (
						<input
							type="tel"
							style={styles.phoneInput}
							placeholder="+998 90 123 45 67"
							value={otherPhone}
							onChange={(e) => setOtherPhone(e.target.value)}
							inputMode="tel"
							autoComplete="tel"
						/>
					)}
				</div>

				{/* Total price */}
				{allPriced && totalPrice > 0 && (
					<div style={styles.totalCard}>
						<span style={styles.totalLabel}>{t("order.total", "Jami")}:</span>
						<span style={styles.totalValue}>
							{totalPrice.toLocaleString()} {t("common.sum", "so'm")}
						</span>
					</div>
				)}

				{error && (
					<div style={styles.errorBox}>
						<p style={styles.errorText}>{error}</p>
					</div>
				)}

				{/* Submit */}
				<button
					style={{
						...styles.submitBtn,
						opacity: submitting || items.length === 0 ? 0.6 : 1,
					}}
					onClick={handleSubmit}
					disabled={submitting || items.length === 0}
				>
					{submitting ? t("order.submitting") : t("order.submit")}
					{allPriced && totalPrice > 0 ? (
						<span style={styles.submitBadge}>
							{totalPrice.toLocaleString()} {t("common.sum", "so'm")}
						</span>
					) : items.length > 0 ? (
						<span style={styles.submitBadge}>{totalItems}</span>
					) : null}
				</button>
			</div>
		</div>
	);
}

const styles: Record<string, React.CSSProperties> = {
	page: { minHeight: "100%", paddingBottom: 16 },
	pharmacyTag: {
		display: "inline-flex",
		alignItems: "center",
		gap: 6,
		padding: "5px 12px",
		borderRadius: 20,
		background: "rgba(255,255,255,0.2)",
		fontSize: 13,
		fontWeight: 600,
		color: "#fff",
		alignSelf: "flex-start",
	},
	pharmacyIcon: { fontSize: 14 },
	pharmacyName: { fontSize: 13 },
	form: {
		padding: "16px",
		display: "flex",
		flexDirection: "column",
		gap: 16,
	},
	fieldGroup: {
		display: "flex",
		flexDirection: "column",
		gap: 6,
	},
	labelRow: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
	},
	label: {
		fontSize: 13,
		fontWeight: 600,
		color: "var(--tg-theme-hint-color, #666)",
	},
	countBadge: {
		fontSize: 11,
		fontWeight: 700,
		padding: "2px 8px",
		borderRadius: 10,
		background: "var(--tg-theme-button-color, #2196f3)",
		color: "#fff",
	},
	select: {
		width: "100%",
		padding: "12px 14px",
		borderRadius: 10,
		border: "1.5px solid var(--tg-theme-hint-color, #ddd)",
		fontSize: 14,
		background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
		color: "var(--tg-theme-text-color, #222)",
	},
	emptyBox: {
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		padding: "24px 16px",
		background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
		borderRadius: 12,
		gap: 8,
	},
	emptyIcon: { fontSize: 36, opacity: 0.5 },
	emptyText: {
		color: "var(--tg-theme-hint-color, #999)",
		fontSize: 13,
		margin: 0,
	},
	browseBtn: {
		marginTop: 4,
		padding: "8px 20px",
		borderRadius: 8,
		border: "none",
		background: "var(--tg-theme-button-color, #2196f3)",
		color: "var(--tg-theme-button-text-color, #fff)",
		fontSize: 13,
		fontWeight: 600,
		cursor: "pointer",
	},
	itemList: {
		display: "flex",
		flexDirection: "column",
		gap: 8,
	},
	itemCard: {
		display: "flex",
		flexDirection: "column",
		gap: 4,
		background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
		borderRadius: 10,
		padding: "10px 12px",
	},
	itemTop: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 10,
	},
	itemInfo: {
		flex: 1,
		minWidth: 0,
	},
	itemName: {
		fontSize: 14,
		fontWeight: 600,
		display: "block",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	itemActions: {
		display: "flex",
		alignItems: "center",
		gap: 8,
		flexShrink: 0,
	},
	qtyControl: {
		display: "flex",
		alignItems: "center",
		gap: 4,
		background: "var(--tg-theme-bg-color, #fff)",
		borderRadius: 8,
		padding: 2,
	},
	qtyBtn: {
		width: 30,
		height: 30,
		borderRadius: 7,
		border: "none",
		background: "transparent",
		fontSize: 16,
		fontWeight: 700,
		cursor: "pointer",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		color: "var(--tg-theme-text-color, #333)",
	},
	qtyBtnPlus: {
		background: "var(--tg-theme-button-color, #2196f3)",
		color: "#fff",
	},
	qtyValue: {
		minWidth: 24,
		textAlign: "center",
		fontSize: 15,
		fontWeight: 700,
	},
	removeBtn: {
		width: 30,
		height: 30,
		borderRadius: 8,
		border: "none",
		background: "#fce4ec",
		color: "#c62828",
		fontSize: 18,
		fontWeight: 700,
		cursor: "pointer",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		lineHeight: 1,
	},
	textarea: {
		width: "100%",
		padding: "12px 14px",
		borderRadius: 10,
		border: "1.5px solid var(--tg-theme-hint-color, #ddd)",
		fontSize: 14,
		background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
		color: "var(--tg-theme-text-color, #222)",
		resize: "none",
		fontFamily: "inherit",
		boxSizing: "border-box",
	},
	errorBox: {
		padding: "10px 14px",
		background: "#ffebee",
		borderRadius: 10,
		borderLeft: "4px solid #e53935",
	},
	errorText: {
		color: "#c62828",
		fontSize: 13,
		margin: 0,
		fontWeight: 500,
	},
	submitBtn: {
		marginTop: 4,
		padding: "14px 0",
		borderRadius: 12,
		border: "none",
		background: "var(--tg-theme-button-color, #2196f3)",
		color: "var(--tg-theme-button-text-color, #fff)",
		fontSize: 16,
		fontWeight: 700,
		cursor: "pointer",
		transition: "opacity 0.15s",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		gap: 8,
	},
	submitBadge: {
		background: "rgba(255,255,255,0.25)",
		padding: "2px 8px",
		borderRadius: 10,
		fontSize: 13,
		fontWeight: 700,
	},
	itemPriceRow: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		paddingTop: 2,
	},
	itemPriceLabel: {
		fontSize: 12,
		color: "var(--tg-theme-hint-color, #888)",
	},
	itemPriceValue: {
		fontSize: 13,
		fontWeight: 700,
		color: "#2e7d32",
	},
	totalCard: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		padding: "14px 16px",
		background: "#e8f5e9",
		borderRadius: 12,
		border: "1.5px solid #a5d6a7",
	},
	totalLabel: {
		fontSize: 15,
		fontWeight: 600,
		color: "#333",
	},
	totalValue: {
		fontSize: 18,
		fontWeight: 700,
		color: "#2e7d32",
	},
	phoneHint: {
		margin: 0,
		fontSize: 12,
		color: "var(--tg-theme-hint-color, #888)",
	},
	phoneOption: {
		display: "flex",
		alignItems: "center",
		gap: 8,
		padding: "8px 12px",
		background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
		borderRadius: 10,
		cursor: "pointer",
		fontSize: 14,
	},
	phoneOptionLabel: {
		fontWeight: 500,
		color: "var(--tg-theme-text-color, #222)",
	},
	phoneValue: {
		marginLeft: "auto",
		fontWeight: 700,
		color: "var(--tg-theme-text-color, #222)",
	},
	phoneInput: {
		width: "100%",
		padding: "12px 14px",
		borderRadius: 10,
		border: "1.5px solid var(--tg-theme-hint-color, #ddd)",
		fontSize: 14,
		background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
		color: "var(--tg-theme-text-color, #222)",
		boxSizing: "border-box",
	},
};
