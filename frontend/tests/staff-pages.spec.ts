import { test, expect } from '@playwright/test';

// Mock data matching the real API response shapes
const MOCK_STAFF_ORDERS = {
  orders: [
    {
      id: '111-aaa',
      order_number: 'ORD-20260225-IELW',
      status: 'cancelled',
      order_type: 'prescription',
      total_price: null,
      currency: 'UZS',
      notes: null,
      rejection_reason: null,
      payment_method: null,
      payment_status: null,
      staff_id: null,
      user_first_name: 'Test User',
      user_phone: '+998901234567',
      created_at: '2026-02-25T14:12:35.386000+00:00',
      reply_image_url: null,
      items: [],
      prescriptions: [],
    },
    {
      id: '222-bbb',
      order_number: 'ORD-20260225-ABCD',
      status: 'created',
      order_type: 'medicine_search',
      total_price: null,
      currency: 'UZS',
      notes: 'Test note',
      rejection_reason: null,
      payment_method: null,
      payment_status: null,
      staff_id: null,
      user_first_name: 'Another User',
      user_phone: '+998907654321',
      created_at: '2026-02-25T15:00:00.000000+00:00',
      reply_image_url: null,
      items: [
        { id: 'item-1', medicine_name: 'Aspirin', quantity: 2, unit_price: 5000 },
      ],
      prescriptions: [],
    },
    {
      id: '333-ccc',
      order_number: 'ORD-20260225-EFGH',
      status: 'rejected',
      order_type: 'medicine_search',
      total_price: null,
      currency: 'UZS',
      notes: null,
      rejection_reason: 'Out of stock',
      payment_method: null,
      payment_status: null,
      staff_id: null,
      user_first_name: 'Rejected User',
      user_phone: null,
      created_at: '2026-02-25T10:00:00.000000+00:00',
      reply_image_url: null,
      items: [{ id: 'item-2', medicine_name: 'Ibuprofen', quantity: 1, unit_price: null }],
      prescriptions: [],
    },
  ],
  total: 3,
};

const MOCK_SINGLE_ORDER = MOCK_STAFF_ORDERS.orders[1]; // 'created' order

const MOCK_MEDICINES = {
  medicines: [
    {
      id: 'med-1',
      name: 'Aspirin 500mg',
      name_ru: 'Аспирин 500мг',
      name_uz: null,
      description: 'Pain relief',
      category: 'Analgesic',
      requires_prescription: false,
      availability: [
        { pharmacy_id: 'ph-1', pharmacy_name: 'Test Pharmacy', is_available: true, price: 5000, quantity: 100 },
      ],
    },
    {
      id: 'med-2',
      name: 'Amoxicillin',
      name_ru: 'Амоксициллин',
      name_uz: null,
      description: 'Antibiotic',
      category: 'Antibiotic',
      requires_prescription: true,
      availability: [
        { pharmacy_id: 'ph-1', pharmacy_name: 'Test Pharmacy', is_available: false, price: 15000, quantity: 50 },
      ],
    },
  ],
  total: 2,
};

const AUTH_RESPONSE = {
  access_token: 'test-token',
  token_type: 'bearer',
  expires_in: 604800,
  user_id: 'user-1',
  telegram_user_id: null,
  is_staff: true,
  first_name: 'Staff',
};

async function setupMocks(page: import('@playwright/test').Page) {
  // Set localStorage before navigation so the app thinks we're authenticated
  await page.addInitScript(() => {
    localStorage.setItem('staff_token', 'test-token');
    localStorage.setItem('isStaff', 'true');
  });

  // Mock API routes
  await page.route('**/api/v1/auth/token-login', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AUTH_RESPONSE) })
  );
  await page.route('**/api/v1/staff/orders?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_STAFF_ORDERS) })
  );
  await page.route('**/api/v1/staff/orders/222-bbb', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SINGLE_ORDER) })
  );
  await page.route('**/api/v1/staff/medicines?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MEDICINES) })
  );
}

// -------------------------------------------------------
// Dashboard
// -------------------------------------------------------
test.describe('Staff Dashboard', () => {
  test('renders sidebar, tabs, and order table', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/staff');
    await page.waitForLoadState('networkidle');

    // Sidebar visible
    await expect(page.locator('.staff-sidebar')).toBeVisible();
    await expect(page.locator('text=Pharmacy Staff')).toBeVisible();

    // "All" tab should be active by default and show 3 orders
    await expect(page.locator('text=3').first()).toBeVisible();

    // Table should have rows for all 3 orders
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(3);

    // Order numbers visible
    await expect(page.locator('text=ORD-20260225-IELW')).toBeVisible();
    await expect(page.locator('text=ORD-20260225-ABCD')).toBeVisible();
    await expect(page.locator('text=ORD-20260225-EFGH')).toBeVisible();

    // Customer names visible
    await expect(page.locator('text=Test User')).toBeVisible();
    await expect(page.locator('text=Another User')).toBeVisible();
  });

  test('can switch tabs and filter orders', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/staff');
    await page.waitForLoadState('networkidle');

    // Click on "Yangi buyurtmalar" (created) tab
    // The tab with count 1 for created
    const createdTab = page.locator('button', { hasText: /1/ }).first();
    await createdTab.click();

    // Should show only 1 order (the created one)
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(page.locator('text=ORD-20260225-ABCD')).toBeVisible();
  });

  test('clicking order navigates to detail', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/staff');
    await page.waitForLoadState('networkidle');

    // Click on the second order row (the created one)
    await page.locator('text=ORD-20260225-ABCD').click();
    await expect(page).toHaveURL(/\/staff\/order\/222-bbb/);
  });
});

// -------------------------------------------------------
// Order Detail
// -------------------------------------------------------
test.describe('Staff Order Detail', () => {
  test('renders order info with two-column layout', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/staff/order/222-bbb');
    await page.waitForLoadState('networkidle');

    // Order number visible
    await expect(page.locator('text=#ORD-20260225-ABCD')).toBeVisible();

    // Customer info
    await expect(page.locator('text=Another User')).toBeVisible();
    await expect(page.locator('text=+998907654321')).toBeVisible();

    // Medicine items
    await expect(page.locator('text=Aspirin')).toBeVisible();

    // Two-column layout class
    await expect(page.locator('.staff-order-columns')).toBeVisible();

    // Pricing form visible (order is 'created')
    const priceInput = page.locator('input[type="number"]').first();
    await expect(priceInput).toBeVisible();
  });

  test('back button navigates to dashboard', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/staff/order/222-bbb');
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /←/ }).click();
    await expect(page).toHaveURL(/\/staff$/);
  });
});

// -------------------------------------------------------
// Medicine Catalog
// -------------------------------------------------------
test.describe('Staff Medicine Catalog', () => {
  test('renders medicine table with availability toggles', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/staff/medicines');
    await page.waitForLoadState('networkidle');

    // Table should have 2 medicines
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(2);

    // Medicine names visible
    await expect(page.locator('text=Aspirin 500mg')).toBeVisible();
    await expect(page.locator('text=Amoxicillin')).toBeVisible();

    // Rx badge for amoxicillin (use tbody to avoid matching the th header)
    await expect(page.locator('table tbody').locator('text=Rx')).toBeVisible();

    // Availability toggles
    const toggles = page.locator('table tbody button');
    await expect(toggles).toHaveCount(2);
  });

  test('search filters medicines', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/staff/medicines');
    await page.waitForLoadState('networkidle');

    // Type in search
    const searchInput = page.locator('input[placeholder]').first();
    await searchInput.fill('aspirin');

    // Should show only 1 row
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(page.locator('text=Aspirin 500mg')).toBeVisible();
  });

  test('add medicine form toggles', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/staff/medicines');
    await page.waitForLoadState('networkidle');

    // Click add button
    const addBtn = page.locator('button', { hasText: /\+/ });
    await addBtn.click();

    // Form should be visible
    await expect(page.locator('input').nth(1)).toBeVisible(); // name input (first is search)
  });
});

// -------------------------------------------------------
// Sidebar Navigation
// -------------------------------------------------------
test.describe('Sidebar Navigation', () => {
  test('navigates between dashboard and medicines', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/staff');
    await page.waitForLoadState('networkidle');

    // Click medicines nav link
    await page.locator('.staff-sidebar .staff-nav-link', { hasText: /Dorilar|Medicines|Лекарства/ }).click();
    await expect(page).toHaveURL(/\/staff\/medicines/);

    // Click back to dashboard
    await page.locator('.staff-sidebar .staff-nav-link', { hasText: /Buyurtmalar|Orders|Заказы/ }).click();
    await expect(page).toHaveURL(/\/staff$/);
  });
});
