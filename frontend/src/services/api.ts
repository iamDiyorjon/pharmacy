import axios, { AxiosInstance } from 'axios';

// ---------------------------------------------------------------------------
// Types (mirroring the OpenAPI schemas)
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  telegram_user_id: number;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  language_code: string;
}

export interface Pharmacy {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  opens_at: string;
  closes_at: string;
  is_open: boolean;
  is_active: boolean;
}

export interface Medicine {
  id: string;
  name: string;
  name_ru: string | null;
  name_uz: string | null;
  description: string | null;
  category: string | null;
  manufacturer: string | null;
  requires_prescription: boolean;
}

export interface MedicineAvailabilityEntry {
  pharmacy_id: string;
  pharmacy_name: string;
  is_available: boolean;
  price: number | null;
  quantity: number | null;
}

export interface MedicineWithAvailability extends Medicine {
  availability: MedicineAvailabilityEntry[];
}

export type OrderStatus =
  | 'created'
  | 'priced'
  | 'confirmed'
  | 'ready'
  | 'completed'
  | 'cancelled'
  | 'rejected';

export type OrderType = 'medicine_search' | 'prescription';
export type PaymentMethod = 'cash' | 'click' | 'payme';
export type PaymentStatus = 'pending' | 'paid' | 'failed';

export interface Order {
  id: string;
  order_number: string;
  status: OrderStatus;
  order_type: OrderType;
  pharmacy_id: string;
  pharmacy_name: string;
  total_price: number | null;
  currency: string;
  notes: string | null;
  rejection_reason: string | null;
  payment_method: PaymentMethod | null;
  payment_status: PaymentStatus | null;
  created_at: string;
  confirmed_at: string | null;
  ready_at: string | null;
}

export interface OrderItem {
  id: string;
  medicine_name: string;
  quantity: number;
  unit_price: number | null;
}

export interface Prescription {
  id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_at: string;
  download_url: string;
}

export interface OrderDetail extends Order {
  items: OrderItem[];
  prescriptions: Prescription[];
  user: User;
}

export interface StaffOrder {
  id: string;
  order_number: string;
  status: OrderStatus;
  order_type: OrderType;
  total_price: number | null;
  currency: string;
  notes: string | null;
  rejection_reason: string | null;
  payment_method: PaymentMethod | null;
  payment_status: PaymentStatus | null;
  staff_id: string | null;
  user_first_name: string;
  user_phone: string | null;
  created_at: string;
  items: OrderItem[];
  prescriptions: Prescription[];
}

export interface CreateOrderItem {
  medicine_id?: string;
  medicine_name: string;
  quantity: number;
  unit_price?: number | null;
}

export interface CreateOrderRequest {
  pharmacy_id: string;
  order_type: OrderType;
  items?: CreateOrderItem[];
  notes?: string;
}

export interface PriceOrderItem {
  order_item_id: string;
  unit_price: number;
}

export interface PriceOrderRequest {
  total_price: number;
  items?: PriceOrderItem[];
}

export interface CreateMedicineRequest {
  name: string;
  name_ru?: string;
  name_uz?: string;
  description?: string;
  category?: string;
  requires_prescription?: boolean;
  is_available?: boolean;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user_id: string;
  telegram_user_id: number | null;
  is_staff: boolean;
  first_name: string | null;
}

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

const apiClient: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor — prefer stored JWT, fall back to Telegram Mini App initData
apiClient.interceptors.request.use((config) => {
  const staffToken = localStorage.getItem('staff_token');
  const webToken = localStorage.getItem('web_token');
  if (staffToken) {
    config.headers['Authorization'] = `Bearer ${staffToken}`;
  } else if (webToken) {
    config.headers['Authorization'] = `Bearer ${webToken}`;
  } else {
    const initDataRaw = window.Telegram?.WebApp?.initData;
    if (initDataRaw) {
      config.headers['Authorization'] = `tma ${initDataRaw}`;
    }
  }
  return config;
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function initAuth(): Promise<AuthResponse> {
  const initData = window.Telegram?.WebApp?.initData ?? '';
  const { data } = await apiClient.post<AuthResponse>('/auth/init', {
    init_data: initData,
  });
  return data;
}

export async function tokenLogin(token: string): Promise<AuthResponse> {
  const { data } = await apiClient.post<AuthResponse>('/auth/token-login', {
    token,
  });
  return data;
}

export async function webLogin(phone: string, password: string): Promise<AuthResponse> {
  const { data } = await apiClient.post<AuthResponse>('/auth/web/login', {
    phone,
    password,
  });
  return data;
}

export async function webRegister(phone: string, password: string, first_name: string): Promise<AuthResponse> {
  const { data } = await apiClient.post<AuthResponse>('/auth/web/register', {
    phone,
    password,
    first_name,
  });
  return data;
}

// ---------------------------------------------------------------------------
// Pharmacies
// ---------------------------------------------------------------------------

export async function getPharmacies(): Promise<Pharmacy[]> {
  const { data } = await apiClient.get<Pharmacy[]>('/pharmacies');
  return data;
}

// ---------------------------------------------------------------------------
// Medicines
// ---------------------------------------------------------------------------

export interface SearchMedicinesParams {
  q: string;
  pharmacy_id?: string;
  limit?: number;
  offset?: number;
}

export async function getPopularMedicines(
  pharmacyId?: string,
): Promise<MedicineWithAvailability[]> {
  const { data } = await apiClient.get<MedicineWithAvailability[]>(
    '/medicines/popular',
    { params: pharmacyId ? { pharmacy_id: pharmacyId } : {} },
  );
  return data;
}

export async function searchMedicines(
  params: SearchMedicinesParams,
): Promise<{ results: MedicineWithAvailability[]; total: number }> {
  const { data } = await apiClient.get<{
    results: MedicineWithAvailability[];
    total: number;
  }>('/medicines/search', { params });
  return data;
}

// ---------------------------------------------------------------------------
// Orders (customer)
// ---------------------------------------------------------------------------

export async function createOrder(payload: CreateOrderRequest): Promise<Order> {
  const { data } = await apiClient.post<Order>('/orders', payload);
  return data;
}

export async function getOrder(id: string): Promise<OrderDetail> {
  const { data } = await apiClient.get<OrderDetail>(`/orders/${id}`);
  return data;
}

export async function confirmOrder(
  id: string,
  paymentMethod: PaymentMethod,
): Promise<Order> {
  const { data } = await apiClient.post<Order>(`/orders/${id}/confirm`, {
    payment_method: paymentMethod,
  });
  return data;
}

export async function cancelOrder(id: string): Promise<Order> {
  const { data } = await apiClient.post<Order>(`/orders/${id}/cancel`);
  return data;
}

export async function getOrders(params?: {
  status?: OrderStatus;
  limit?: number;
  offset?: number;
}): Promise<{ orders: Order[]; total: number }> {
  const { data } = await apiClient.get<{ orders: Order[]; total: number }>(
    '/orders',
    { params },
  );
  return data;
}

export async function reorder(id: string): Promise<Order> {
  const { data } = await apiClient.post<Order>(`/orders/${id}/reorder`);
  return data;
}

export async function uploadPrescription(
  orderId: string,
  file: File,
): Promise<Prescription> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await apiClient.post<Prescription>(
    `/orders/${orderId}/prescription`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

export async function initiatePayment(
  orderId: string,
): Promise<{ payment_url: string; payment_method: PaymentMethod }> {
  const { data } = await apiClient.post<{
    payment_url: string;
    payment_method: PaymentMethod;
  }>(`/orders/${orderId}/pay`);
  return data;
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export async function getStaffOrders(params?: {
  status?: OrderStatus;
  limit?: number;
  offset?: number;
}): Promise<{ orders: StaffOrder[]; total: number }> {
  const { data } = await apiClient.get<{ orders: StaffOrder[]; total: number }>(
    '/staff/orders',
    { params },
  );
  return data;
}

export async function getStaffOrder(id: string): Promise<StaffOrder> {
  const { data } = await apiClient.get<StaffOrder>(`/staff/orders/${id}`);
  return data;
}

export async function priceOrder(
  id: string,
  payload: PriceOrderRequest,
): Promise<StaffOrder> {
  const { data } = await apiClient.post<StaffOrder>(
    `/staff/orders/${id}/price`,
    payload,
  );
  return data;
}

export async function readyOrder(id: string): Promise<StaffOrder> {
  const { data } = await apiClient.post<StaffOrder>(`/staff/orders/${id}/ready`);
  return data;
}

export async function completeOrder(id: string): Promise<StaffOrder> {
  const { data } = await apiClient.post<StaffOrder>(`/staff/orders/${id}/complete`);
  return data;
}

export async function rejectOrder(id: string, reason: string): Promise<StaffOrder> {
  const { data } = await apiClient.post<StaffOrder>(`/staff/orders/${id}/reject`, {
    reason,
  });
  return data;
}

export async function getMedicines(params?: {
  limit?: number;
  offset?: number;
}): Promise<{ medicines: MedicineWithAvailability[]; total: number }> {
  const { data } = await apiClient.get<{
    medicines: MedicineWithAvailability[];
    total: number;
  }>('/staff/medicines', { params });
  return data;
}

export async function addMedicine(
  payload: CreateMedicineRequest,
): Promise<Medicine> {
  const { data } = await apiClient.post<Medicine>('/staff/medicines', payload);
  return data;
}

export async function updateAvailability(
  medicineId: string,
  available: boolean,
): Promise<void> {
  await apiClient.put(`/staff/medicines/${medicineId}/availability`, {
    is_available: available,
  });
}

export default apiClient;
