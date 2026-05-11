import { CSSProperties, ReactNode } from "react";

// Brand gradient — used by every customer page header for a consistent identity.
const BRAND_GRADIENT = "linear-gradient(135deg, #1976d2 0%, #1565c0 100%)";

interface PageHeaderProps {
	title: string;
	subtitle?: ReactNode;
	leftSlot?: ReactNode;
	rightSlot?: ReactNode;
	background?: string;
	children?: ReactNode;
}

export default function PageHeader({
	title,
	subtitle,
	leftSlot,
	rightSlot,
	background,
	children,
}: PageHeaderProps) {
	const headerStyle: CSSProperties = {
		...styles.header,
		background: background ?? BRAND_GRADIENT,
	};

	return (
		<header style={headerStyle}>
			<div style={styles.row}>
				{leftSlot && <div style={styles.left}>{leftSlot}</div>}
				<div style={styles.titleBlock}>
					<h1 style={styles.title}>{title}</h1>
					{subtitle && <p style={styles.subtitle}>{subtitle}</p>}
				</div>
				{rightSlot && <div style={styles.right}>{rightSlot}</div>}
			</div>
			{children && <div style={styles.children}>{children}</div>}
		</header>
	);
}

const styles: Record<string, CSSProperties> = {
	header: {
		paddingTop: "calc(env(safe-area-inset-top, 0px) + 18px)",
		paddingRight: 16,
		paddingBottom: 16,
		paddingLeft: 16,
		color: "#fff",
		boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
	},
	row: {
		display: "flex",
		alignItems: "center",
		gap: 12,
		minHeight: 32,
	},
	left: {
		display: "flex",
		alignItems: "center",
		flexShrink: 0,
	},
	titleBlock: {
		flex: 1,
		minWidth: 0,
		display: "flex",
		flexDirection: "column",
		gap: 2,
	},
	title: {
		margin: 0,
		fontSize: 19,
		fontWeight: 700,
		letterSpacing: -0.2,
		lineHeight: 1.2,
		color: "#fff",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	subtitle: {
		margin: 0,
		fontSize: 13,
		fontWeight: 400,
		opacity: 0.85,
		color: "#fff",
		lineHeight: 1.35,
	},
	right: {
		display: "flex",
		alignItems: "center",
		flexShrink: 0,
	},
	children: {
		marginTop: 14,
	},
};
