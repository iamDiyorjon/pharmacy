import {
	Component,
	ErrorInfo,
	ReactNode,
	Suspense,
	lazy,
	useEffect,
	useState,
} from "react";
import {
	Routes,
	Route,
	NavLink,
	useNavigate,
	useLocation,
} from "react-router-dom";
import { useTranslation } from "react-i18next";

import { initAuth, tokenLogin } from "./services/api";

// ---------------------------------------------------------------------------
// Error boundary — prevents white screen by surfacing render errors with a
// reload button. Especially useful inside Telegram Mini App where there is
// no obvious devtools to inspect a crashed page.
// ---------------------------------------------------------------------------
class RouteErrorBoundary extends Component<
	{ children: ReactNode },
	{ error: Error | null }
> {
	state = { error: null as Error | null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		// Surface to console + Telegram alert if available so end users can report
		// the actual message instead of a blank screen.
		// eslint-disable-next-line no-console
		console.error("Route render error:", error, info.componentStack);
	}

	render() {
		if (!this.state.error) return this.props.children;
		const message = this.state.error.message || String(this.state.error);
		return (
			<div
				style={{
					padding: 24,
					display: "flex",
					flexDirection: "column",
					gap: 12,
					textAlign: "center",
					color: "var(--tg-theme-text-color, #222)",
				}}
			>
				<h2 style={{ margin: 0, fontSize: 18, color: "#c62828" }}>
					Sahifani yuklashda xatolik
				</h2>
				<p
					style={{
						margin: 0,
						fontSize: 13,
						opacity: 0.8,
						wordBreak: "break-word",
					}}
				>
					{message}
				</p>
				<button
					style={{
						padding: "10px 20px",
						borderRadius: 8,
						border: "none",
						background: "var(--tg-theme-button-color, #2196f3)",
						color: "var(--tg-theme-button-text-color, #fff)",
						fontSize: 14,
						fontWeight: 600,
						cursor: "pointer",
						alignSelf: "center",
					}}
					onClick={() => {
						this.setState({ error: null });
						window.location.href = "/";
					}}
				>
					Bosh sahifaga qaytish
				</button>
			</div>
		);
	}
}

const StaffLayout = lazy(() => import("./components/StaffLayout"));

// Lazy-loaded pages
const Home = lazy(() => import("./pages/Home"));
const Search = lazy(() => import("./pages/Search"));
const Order = lazy(() => import("./pages/Order"));
const OrderStatus = lazy(() => import("./pages/OrderStatus"));
const Orders = lazy(() => import("./pages/Orders"));
const Upload = lazy(() => import("./pages/Upload"));
const Settings = lazy(() => import("./pages/Settings"));
const Login = lazy(() => import("./pages/Login"));

// Staff pages
const StaffDashboard = lazy(() => import("./pages/staff/Dashboard"));
const StaffOrderDetail = lazy(() => import("./pages/staff/OrderDetail"));
const StaffMedicineCatalog = lazy(
	() => import("./pages/staff/MedicineCatalog"),
);

// ---------------------------------------------------------------------------
// Spinner fallback
// ---------------------------------------------------------------------------
function PageSpinner() {
	return (
		<div style={styles.spinner}>
			<div style={styles.spinnerInner} />
		</div>
	);
}

// ---------------------------------------------------------------------------
// Bottom Navigation
// ---------------------------------------------------------------------------
interface NavItem {
	to: string;
	labelKey: string;
	icon: string;
}

const customerNav: NavItem[] = [
	{ to: "/", labelKey: "nav.home", icon: "🏠" },
	{ to: "/search", labelKey: "nav.search", icon: "🔍" },
	{ to: "/orders", labelKey: "nav.orders", icon: "📋" },
	{ to: "/settings", labelKey: "nav.settings", icon: "⚙️" },
];

const staffNavItem: NavItem = {
	to: "/staff",
	labelKey: "nav.staff",
	icon: "👨‍⚕️",
};

function BottomNav({ isStaff }: { isStaff: boolean }) {
	const { t } = useTranslation();
	const navItems = isStaff ? [...customerNav, staffNavItem] : customerNav;

	return (
		<nav style={styles.bottomNav} aria-label="Bottom navigation">
			{navItems.map(({ to, labelKey, icon }) => (
				<NavLink
					key={to}
					to={to}
					end={to === "/"}
					style={({ isActive }) => ({
						...styles.navItem,
						color: isActive
							? "var(--tg-theme-button-color, #2196f3)"
							: "var(--tg-theme-hint-color, #999)",
					})}
				>
					<span style={styles.navIcon} aria-hidden="true">
						{icon}
					</span>
					<span style={styles.navLabel}>{t(labelKey)}</span>
				</NavLink>
			))}
		</nav>
	);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
	const navigate = useNavigate();
	const location = useLocation();
	const [isStaff, setIsStaff] = useState(false);
	const [authReady, setAuthReady] = useState(false);
	const [isAuthenticated, setIsAuthenticated] = useState(false);

	const isTelegram = !!window.Telegram?.WebApp?.initData;
	const isStaffRoute = location.pathname.startsWith("/staff");

	// Initialize auth on mount — handle web token or Telegram initData
	useEffect(() => {
		// Check for web token (phone+password login)
		const webToken = localStorage.getItem("web_token");
		if (webToken) {
			tokenLogin(webToken)
				.then((res) => {
					localStorage.setItem("web_token", res.access_token);
					if (res.phone) localStorage.setItem("user_phone", res.phone);
					else localStorage.removeItem("user_phone");
					if (res.is_staff) {
						setIsStaff(true);
						localStorage.setItem("isStaff", "true");
					}
					setIsAuthenticated(true);
					setAuthReady(true);
				})
				.catch(() => {
					localStorage.removeItem("web_token");
					setAuthReady(true);
				});
			return;
		}

		// Standard Telegram Mini App flow
		if (isTelegram) {
			initAuth()
				.then((res) => {
					if (res.phone) localStorage.setItem("user_phone", res.phone);
					else localStorage.removeItem("user_phone");
					if (res.is_staff) {
						setIsStaff(true);
						localStorage.setItem("isStaff", "true");
					} else {
						localStorage.removeItem("isStaff");
					}
					setIsAuthenticated(true);
					setAuthReady(true);
				})
				.catch(() => {
					const stored = localStorage.getItem("isStaff");
					if (stored === "true") setIsStaff(true);
					setAuthReady(true);
				});
		} else {
			// Browser without Telegram — show login
			setAuthReady(true);
		}
	}, [navigate, isTelegram]);

	// Auto-redirect staff users on desktop browser to /staff
	useEffect(() => {
		if (authReady && isStaff && !isTelegram && location.pathname === "/") {
			navigate("/staff", { replace: true });
		}
	}, [authReady, isStaff, isTelegram, location.pathname, navigate]);

	if (!authReady) return <PageSpinner />;

	// In browser without auth — show login/register
	if (!isTelegram && !isAuthenticated) {
		return (
			<Suspense fallback={<PageSpinner />}>
				<Routes>
					<Route path="*" element={<Login />} />
				</Routes>
			</Suspense>
		);
	}

	// Staff desktop layout — sidebar nav, full width
	if (isStaffRoute) {
		return (
			<Suspense fallback={<PageSpinner />}>
				<StaffLayout>
					<RouteErrorBoundary>
						<Routes>
							<Route path="/staff" element={<StaffDashboard />} />
							<Route path="/staff/order/:id" element={<StaffOrderDetail />} />
							<Route
								path="/staff/medicines"
								element={<StaffMedicineCatalog />}
							/>
							<Route path="/staff/*" element={<StaffDashboard />} />
						</Routes>
					</RouteErrorBoundary>
				</StaffLayout>
			</Suspense>
		);
	}

	// Customer layout — mobile 480px + bottom nav
	return (
		<div style={styles.appWrapper}>
			<main style={styles.main}>
				<Suspense fallback={<PageSpinner />}>
					<RouteErrorBoundary>
						<Routes>
							<Route path="/" element={<Home />} />
							<Route path="/search" element={<Search />} />
							<Route path="/order" element={<Order />} />
							<Route path="/order/:id" element={<OrderStatus />} />
							<Route path="/orders" element={<Orders />} />
							<Route path="/upload" element={<Upload />} />
							<Route path="/settings" element={<Settings />} />
						</Routes>
					</RouteErrorBoundary>
				</Suspense>
			</main>

			<BottomNav isStaff={isStaff} />
		</div>
	);
}

// ---------------------------------------------------------------------------
// Styles (inline — no external CSS dependency for core layout)
// ---------------------------------------------------------------------------
const NAV_HEIGHT = 60;

const styles: Record<string, React.CSSProperties> = {
	appWrapper: {
		display: "flex",
		flexDirection: "column",
		height: "100dvh",
		background: "var(--tg-theme-bg-color, #fff)",
		color: "var(--tg-theme-text-color, #222)",
		fontFamily:
			'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
		maxWidth: 768,
		margin: "0 auto",
		position: "relative",
	},
	main: {
		flex: 1,
		overflowY: "auto",
		paddingBottom: NAV_HEIGHT,
	},
	bottomNav: {
		position: "fixed",
		bottom: 0,
		left: "50%",
		transform: "translateX(-50%)",
		width: "100%",
		maxWidth: 768,
		height: NAV_HEIGHT,
		display: "flex",
		alignItems: "center",
		justifyContent: "space-around",
		background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
		borderTop: "1px solid var(--tg-theme-hint-color, #ddd)",
		zIndex: 100,
		boxShadow: "0 -1px 6px rgba(0,0,0,0.08)",
	},
	navItem: {
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		gap: 2,
		textDecoration: "none",
		flex: 1,
		padding: "6px 0",
		transition: "color 0.15s",
	},
	navIcon: {
		fontSize: 20,
		lineHeight: 1,
	},
	navLabel: {
		fontSize: 10,
		fontWeight: 500,
		letterSpacing: 0.2,
	},
	spinner: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		height: "100dvh",
	},
	spinnerInner: {
		width: 36,
		height: 36,
		border: "3px solid var(--tg-theme-hint-color, #ddd)",
		borderTopColor: "var(--tg-theme-button-color, #2196f3)",
		borderRadius: "50%",
		animation: "spin 0.8s linear infinite",
	},
};
