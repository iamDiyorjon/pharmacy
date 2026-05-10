/**
 * SSE client for real-time order updates.
 *
 * EventSource cannot send custom headers, so the auth token is appended as a
 * query parameter. The same token resolution as `apiClient` is used: stored
 * JWT first, then Telegram Mini App initData.
 *
 * On connection error the wrapper reconnects with exponential backoff
 * (capped at 30s) until `unsubscribe()` is called.
 */

export type OrderEventType =
	| "order_created"
	| "order_updated"
	| "order_status_changed";

export interface OrderEvent {
	type: OrderEventType;
	order_id: string;
	order_number: string;
	status: string;
}

export type OrderEventHandler = (event: OrderEvent) => void;

function getAuthToken(): string | null {
	const staffToken = localStorage.getItem("staff_token");
	if (staffToken) return staffToken;
	const webToken = localStorage.getItem("web_token");
	if (webToken) return webToken;
	return window.Telegram?.WebApp?.initData ?? null;
}

const ORDER_EVENT_TYPES: OrderEventType[] = [
	"order_created",
	"order_updated",
	"order_status_changed",
];

function openStream(path: string, handler: OrderEventHandler): () => void {
	let es: EventSource | null = null;
	let closed = false;
	let retryDelay = 1000;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;

	const connect = () => {
		if (closed) return;
		const token = getAuthToken();
		if (!token) {
			retryTimer = setTimeout(connect, retryDelay);
			retryDelay = Math.min(retryDelay * 2, 30_000);
			return;
		}

		const url = `${path}?token=${encodeURIComponent(token)}`;
		es = new EventSource(url);

		for (const evtType of ORDER_EVENT_TYPES) {
			es.addEventListener(evtType, (ev) => {
				retryDelay = 1000;
				try {
					const data = (ev as MessageEvent).data;
					const parsed = data ? JSON.parse(data) : {};
					handler({ type: evtType, ...parsed });
				} catch {
					/* ignore malformed payload */
				}
			});
		}

		es.onerror = () => {
			es?.close();
			es = null;
			if (closed) return;
			retryTimer = setTimeout(connect, retryDelay);
			retryDelay = Math.min(retryDelay * 2, 30_000);
		};
	};

	connect();

	return () => {
		closed = true;
		if (retryTimer) clearTimeout(retryTimer);
		es?.close();
		es = null;
	};
}

export function subscribeToStaffOrders(handler: OrderEventHandler): () => void {
	return openStream("/api/v1/events/staff", handler);
}

export function subscribeToOrder(
	orderId: string,
	handler: OrderEventHandler,
): () => void {
	return openStream(`/api/v1/events/orders/${orderId}`, handler);
}
