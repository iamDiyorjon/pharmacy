import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import LanguageToggle from "../components/LanguageToggle";
import { updateMyPhone } from "../services/api";

const PHONE_RE = /^\+?\d{9,15}$/;

export default function Settings() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const tg = window.Telegram?.WebApp;
	const tgUser = tg?.initDataUnsafe?.user;

	const isWebUser = !!localStorage.getItem("web_token");
	const webName = localStorage.getItem("user_name") || "";

	const [phone, setPhone] = useState(localStorage.getItem("user_phone") || "");
	const [editingPhone, setEditingPhone] = useState(false);
	const [phoneDraft, setPhoneDraft] = useState(phone);
	const [phoneError, setPhoneError] = useState<string | null>(null);
	const [phoneSaving, setPhoneSaving] = useState(false);

	const displayName = tgUser
		? `${tgUser.first_name}${tgUser.last_name ? " " + tgUser.last_name : ""}`
		: webName || t("settings.title");

	const initials = tgUser
		? (tgUser.first_name?.[0] ?? "") + (tgUser.last_name?.[0] ?? "")
		: webName
			? webName[0]
			: "?";

	const handleLogout = () => {
		localStorage.removeItem("web_token");
		localStorage.removeItem("staff_token");
		localStorage.removeItem("isStaff");
		localStorage.removeItem("user_name");
		localStorage.removeItem("user_phone");
		navigate("/");
		window.location.reload();
	};

	const startEditPhone = () => {
		setPhoneDraft(phone);
		setPhoneError(null);
		setEditingPhone(true);
	};

	const cancelEditPhone = () => {
		setEditingPhone(false);
		setPhoneError(null);
	};

	const savePhone = async () => {
		const trimmed = phoneDraft.trim().replace(/\s/g, "");
		if (!PHONE_RE.test(trimmed)) {
			setPhoneError(t("settings.phoneInvalid", "Raqam noto'g'ri formatda"));
			return;
		}
		setPhoneSaving(true);
		setPhoneError(null);
		try {
			const res = await updateMyPhone(trimmed);
			setPhone(res.phone);
			localStorage.setItem("user_phone", res.phone);
			setEditingPhone(false);
		} catch (err: unknown) {
			const e = err as { response?: { status?: number } };
			if (e?.response?.status === 409) {
				setPhoneError(
					t("settings.phoneInUse", "Bu raqam boshqa hisobga biriktirilgan"),
				);
			} else {
				setPhoneError(t("errors.networkError"));
			}
		} finally {
			setPhoneSaving(false);
		}
	};

	return (
		<div style={styles.page}>
			{/* Header with avatar */}
			<header style={styles.hero}>
				{tgUser?.photo_url ? (
					<img src={tgUser.photo_url} alt="" style={styles.avatarImg} />
				) : (
					<div style={styles.avatar}>
						<span style={styles.avatarText}>{initials.toUpperCase()}</span>
					</div>
				)}
				<h1 style={styles.heroTitle}>
					{displayName}
					{tgUser?.is_premium && <span style={styles.premiumBadge}> ⭐</span>}
				</h1>
				{tgUser?.username && (
					<span style={styles.heroUsername}>@{tgUser.username}</span>
				)}
			</header>

			<div style={styles.content}>
				{/* Profile info */}
				{tgUser && (
					<section style={styles.card}>
						<h2 style={styles.sectionTitle}>{t("settings.profile")}</h2>
						<Row label={t("settings.firstName")} value={tgUser.first_name} />
						{tgUser.last_name && (
							<Row label={t("settings.lastName")} value={tgUser.last_name} />
						)}
						{tgUser.username && (
							<Row
								label={t("settings.username")}
								value={`@${tgUser.username}`}
							/>
						)}
						<Row label={t("settings.telegramId")} value={String(tgUser.id)} />
						{tgUser.is_premium && (
							<Row label={t("settings.premium")} value="⭐ Premium" />
						)}
					</section>
				)}

				{isWebUser && !tgUser && (
					<section style={styles.card}>
						<h2 style={styles.sectionTitle}>{t("settings.profile")}</h2>
						<Row label={t("settings.firstName")} value={webName} />
					</section>
				)}

				{/* Phone — editable */}
				{(tgUser || isWebUser) && (
					<section style={styles.card}>
						<h2 style={styles.sectionTitle}>{t("settings.phone")}</h2>
						{editingPhone ? (
							<div style={styles.phoneEditWrap}>
								<input
									type="tel"
									style={styles.phoneInput}
									value={phoneDraft}
									onChange={(e) => setPhoneDraft(e.target.value)}
									placeholder="+998 90 123 45 67"
									inputMode="tel"
									autoComplete="tel"
								/>
								{phoneError && <p style={styles.phoneError}>{phoneError}</p>}
								<div style={styles.phoneEditButtons}>
									<button
										onClick={savePhone}
										disabled={phoneSaving}
										style={styles.phoneSaveBtn}
									>
										{t("settings.savePhone", "Saqlash")}
									</button>
									<button
										onClick={cancelEditPhone}
										disabled={phoneSaving}
										style={styles.phoneCancelBtn}
									>
										{t("common.cancel")}
									</button>
								</div>
							</div>
						) : (
							<div style={styles.phoneRow}>
								<span style={styles.phoneDisplay}>
									{phone || (
										<span style={styles.phoneEmpty}>
											{t("settings.phoneNotSet", "Kiritilmagan")}
										</span>
									)}
								</span>
								<button onClick={startEditPhone} style={styles.phoneEditBtn}>
									✏️ {t("settings.editPhone", "Tahrirlash")}
								</button>
							</div>
						)}
					</section>
				)}

				{/* Language */}
				<section style={styles.card}>
					<h2 style={styles.sectionTitle}>{t("settings.language")}</h2>
					<LanguageToggle />
				</section>

				{/* Logout for web users */}
				{isWebUser && (
					<button onClick={handleLogout} style={styles.logoutBtn}>
						{t("auth.logout", "Chiqish")}
					</button>
				)}
			</div>
		</div>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div
			style={{
				display: "flex",
				justifyContent: "space-between",
				padding: "6px 0",
			}}
		>
			<span style={{ fontSize: 14, color: "var(--tg-theme-hint-color, #888)" }}>
				{label}
			</span>
			<span
				style={{
					fontSize: 14,
					fontWeight: 600,
					color: "var(--tg-theme-text-color, #222)",
				}}
			>
				{value}
			</span>
		</div>
	);
}

const styles: Record<string, React.CSSProperties> = {
	page: { minHeight: "100%" },
	hero: {
		padding: "28px 16px 20px",
		background: "linear-gradient(135deg, #1976d2 0%, #1565c0 100%)",
		color: "#fff",
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		gap: 12,
	},
	avatar: {
		width: 72,
		height: 72,
		borderRadius: "50%",
		background: "rgba(255,255,255,0.2)",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		border: "3px solid rgba(255,255,255,0.4)",
	},
	avatarImg: {
		width: 72,
		height: 72,
		borderRadius: "50%",
		objectFit: "cover",
		border: "3px solid rgba(255,255,255,0.4)",
	},
	avatarText: {
		fontSize: 24,
		fontWeight: 700,
		letterSpacing: 1,
	},
	heroTitle: {
		margin: 0,
		fontSize: 20,
		fontWeight: 700,
		display: "flex",
		alignItems: "center",
	},
	premiumBadge: {
		fontSize: 18,
	},
	heroUsername: {
		fontSize: 14,
		opacity: 0.8,
		marginTop: -4,
	},
	content: {
		padding: "12px 16px 0",
		display: "flex",
		flexDirection: "column",
		gap: 12,
	},
	card: {
		padding: "14px",
		background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
		borderRadius: 12,
		display: "flex",
		flexDirection: "column",
		gap: 8,
	},
	sectionTitle: {
		margin: 0,
		fontSize: 13,
		fontWeight: 700,
		color: "var(--tg-theme-hint-color, #666)",
		textTransform: "uppercase",
		letterSpacing: 0.5,
	},
	logoutBtn: {
		padding: "14px",
		fontSize: 15,
		fontWeight: 600,
		color: "#d32f2f",
		background: "#ffeaea",
		border: "none",
		borderRadius: 12,
		cursor: "pointer",
		marginTop: 4,
	},
	phoneRow: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 8,
	},
	phoneDisplay: {
		fontSize: 15,
		fontWeight: 600,
		color: "var(--tg-theme-text-color, #222)",
	},
	phoneEmpty: {
		color: "var(--tg-theme-hint-color, #999)",
		fontWeight: 400,
		fontStyle: "italic",
	},
	phoneEditBtn: {
		border: "none",
		background: "transparent",
		color: "var(--tg-theme-button-color, #1976d2)",
		fontSize: 13,
		fontWeight: 600,
		cursor: "pointer",
		padding: "4px 8px",
	},
	phoneEditWrap: {
		display: "flex",
		flexDirection: "column",
		gap: 8,
	},
	phoneInput: {
		width: "100%",
		padding: "10px 12px",
		borderRadius: 8,
		border: "1.5px solid var(--tg-theme-hint-color, #ddd)",
		fontSize: 15,
		background: "var(--tg-theme-bg-color, #fff)",
		color: "var(--tg-theme-text-color, #222)",
		boxSizing: "border-box",
	},
	phoneError: {
		margin: 0,
		fontSize: 13,
		color: "#c62828",
	},
	phoneEditButtons: {
		display: "flex",
		gap: 8,
	},
	phoneSaveBtn: {
		flex: 1,
		padding: "10px",
		borderRadius: 8,
		border: "none",
		background: "var(--tg-theme-button-color, #1976d2)",
		color: "var(--tg-theme-button-text-color, #fff)",
		fontSize: 14,
		fontWeight: 600,
		cursor: "pointer",
	},
	phoneCancelBtn: {
		flex: 1,
		padding: "10px",
		borderRadius: 8,
		border: "none",
		background: "var(--tg-theme-secondary-bg-color, #eee)",
		color: "var(--tg-theme-text-color, #555)",
		fontSize: 14,
		fontWeight: 600,
		cursor: "pointer",
	},
};
