import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getAdminStats, type AdminStats } from "../../services/api";

const PERIODS = [
	{ days: 1, label: "1 kun" },
	{ days: 7, label: "7 kun" },
	{ days: 30, label: "30 kun" },
	{ days: 90, label: "90 kun" },
];

const FUNNEL_LABELS: Record<string, string> = {
	bot_start: "Bot ochildi",
	phone_shared: "Raqam ulashdi",
	webapp_opened: "Ilova ochdi",
	order_placed: "Buyurtma berdi",
};

function pct(n: number, base: number): string {
	if (!base) return "—";
	return `${Math.round((n / base) * 100)}%`;
}

export default function Stats() {
	const navigate = useNavigate();
	const [days, setDays] = useState(7);
	const [data, setData] = useState<AdminStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setLoading(true);
		setError(null);
		getAdminStats(days)
			.then((res) => {
				setData(res);
				setLoading(false);
			})
			.catch((e) => {
				const status = e?.response?.status;
				if (status === 403 || status === 401) {
					setError("Sizda admin huquqi yo'q.");
				} else {
					setError("Statistikani yuklab bo'lmadi.");
				}
				setLoading(false);
			});
	}, [days]);

	const topFunnel = data?.funnel[0]?.users ?? 0;

	return (
		<div style={styles.page}>
			<header style={styles.header}>
				<button
					style={styles.backBtn}
					onClick={() => navigate("/")}
					aria-label="Bosh sahifa"
				>
					←
				</button>
				<h1 style={styles.title}>Admin paneli</h1>
			</header>

			<div style={styles.periods}>
				{PERIODS.map((p) => (
					<button
						key={p.days}
						style={{
							...styles.periodBtn,
							...(p.days === days ? styles.periodBtnActive : {}),
						}}
						onClick={() => setDays(p.days)}
					>
						{p.label}
					</button>
				))}
			</div>

			{loading && <div style={styles.muted}>Yuklanmoqda...</div>}
			{error && <div style={styles.error}>{error}</div>}

			{data && (
				<>
					<section style={styles.kpiRow}>
						<div style={styles.kpiCard}>
							<div style={styles.kpiLabel}>Jami foydalanuvchilar</div>
							<div style={styles.kpiValue}>{data.total_users}</div>
						</div>
						<div style={styles.kpiCard}>
							<div style={styles.kpiLabel}>Jami buyurtmalar</div>
							<div style={styles.kpiValue}>{data.total_orders}</div>
						</div>
					</section>

					<section style={styles.section}>
						<h2 style={styles.sectionTitle}>Acquisition funnel</h2>
						<p style={styles.sectionHint}>
							So'nggi {days} kun — har bosqichdagi unikal foydalanuvchilar
						</p>
						<div style={styles.funnelList}>
							{data.funnel.map((step, idx) => {
								const prev = idx === 0 ? topFunnel : data.funnel[idx - 1].users;
								return (
									<div key={step.name} style={styles.funnelRow}>
										<div style={styles.funnelLabel}>
											{FUNNEL_LABELS[step.name] || step.name}
										</div>
										<div style={styles.funnelStats}>
											<span style={styles.funnelUsers}>{step.users}</span>
											{idx > 0 && (
												<span style={styles.funnelPct}>
													{pct(step.users, prev)} oldingidan
												</span>
											)}
										</div>
									</div>
								);
							})}
						</div>
					</section>

					<section style={styles.section}>
						<h2 style={styles.sectionTitle}>Manbalar (sources)</h2>
						<p style={styles.sectionHint}>
							So'nggi {days} kun ichida ro'yxatdan o'tgan foydalanuvchilar manba
							bo'yicha
						</p>
						{data.top_sources.length === 0 ? (
							<div style={styles.muted}>Hali manba ma'lumotlari yo'q.</div>
						) : (
							<table style={styles.table}>
								<thead>
									<tr>
										<th style={styles.th}>Manba</th>
										<th style={{ ...styles.th, textAlign: "right" }}>
											Foydalanuvchi
										</th>
									</tr>
								</thead>
								<tbody>
									{data.top_sources.map((s, i) => (
										<tr key={i}>
											<td style={styles.td}>
												{s.source ?? <em style={styles.muted}>(noma'lum)</em>}
											</td>
											<td style={{ ...styles.td, textAlign: "right" }}>
												{s.users}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</section>

					<section style={styles.section}>
						<h2 style={styles.sectionTitle}>Kunlik yangi foydalanuvchilar</h2>
						{data.new_users_by_day.length === 0 ? (
							<div style={styles.muted}>Yangi foydalanuvchi yo'q.</div>
						) : (
							<table style={styles.table}>
								<thead>
									<tr>
										<th style={styles.th}>Sana</th>
										<th style={{ ...styles.th, textAlign: "right" }}>
											Yangi
										</th>
									</tr>
								</thead>
								<tbody>
									{data.new_users_by_day.map((d) => (
										<tr key={d.date}>
											<td style={styles.td}>{d.date}</td>
											<td style={{ ...styles.td, textAlign: "right" }}>
												{d.new_users}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</section>
				</>
			)}
		</div>
	);
}

const styles: Record<string, React.CSSProperties> = {
	page: {
		maxWidth: 720,
		margin: "0 auto",
		padding: "24px 16px 80px",
		fontFamily:
			'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
		color: "#1a1a1a",
	},
	header: {
		display: "flex",
		alignItems: "center",
		gap: 12,
		marginBottom: 16,
	},
	backBtn: {
		width: 36,
		height: 36,
		borderRadius: 8,
		border: "none",
		background: "#f0f0f0",
		fontSize: 18,
		cursor: "pointer",
	},
	title: { margin: 0, fontSize: 22, fontWeight: 700 },
	periods: { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" },
	periodBtn: {
		padding: "8px 14px",
		borderRadius: 999,
		border: "1px solid #ddd",
		background: "#fff",
		fontSize: 13,
		fontWeight: 500,
		cursor: "pointer",
	},
	periodBtnActive: {
		background: "#2196f3",
		color: "#fff",
		borderColor: "#2196f3",
	},
	kpiRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 },
	kpiCard: {
		padding: "16px 18px",
		borderRadius: 12,
		background: "#f5f8ff",
		border: "1px solid #d6e4ff",
	},
	kpiLabel: { fontSize: 12, color: "#5f6b85", fontWeight: 500 },
	kpiValue: { fontSize: 28, fontWeight: 700, marginTop: 4 },
	section: { marginBottom: 28 },
	sectionTitle: { margin: "0 0 4px", fontSize: 16, fontWeight: 600 },
	sectionHint: { margin: "0 0 12px", fontSize: 12, color: "#777" },
	funnelList: { display: "flex", flexDirection: "column", gap: 8 },
	funnelRow: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		padding: "12px 16px",
		borderRadius: 10,
		background: "#fafafa",
		border: "1px solid #eee",
	},
	funnelLabel: { fontSize: 14, fontWeight: 500 },
	funnelStats: { display: "flex", alignItems: "baseline", gap: 10 },
	funnelUsers: { fontSize: 18, fontWeight: 700 },
	funnelPct: { fontSize: 12, color: "#666" },
	table: {
		width: "100%",
		borderCollapse: "collapse",
		fontSize: 13,
	},
	th: {
		textAlign: "left",
		padding: "8px 10px",
		borderBottom: "1px solid #eee",
		fontSize: 12,
		color: "#666",
		fontWeight: 600,
	},
	td: {
		padding: "8px 10px",
		borderBottom: "1px solid #f4f4f4",
	},
	muted: { color: "#888", fontSize: 13 },
	error: {
		padding: "12px 14px",
		borderRadius: 10,
		background: "#ffebee",
		color: "#c62828",
		fontSize: 13,
		marginBottom: 16,
	},
};
