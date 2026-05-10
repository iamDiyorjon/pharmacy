# Customer Phone Collection — Design Spec

**Date:** 2026-05-10
**Goal:** Capture customer phone numbers so pharmacy staff can contact them about orders. Telegram Mini App `initData` does not provide the phone, so we collect it through the bot, allow per-order override at checkout, and let users edit it from their profile.

---

## Problem

The staff order detail page (`/staff/order/<id>`) renders a "Customer info" card that already supports a phone field (`user_phone`), but the field is always empty for Telegram users. `auth_init` only stores `first_name`, `last_name`, `username`, and `language_code` from the Mini App `initData` payload — Telegram does not include the user's phone number for privacy reasons. Today, staff must contact customers via `@username` (Telegram DM) or not at all, which is unreliable.

## Goal

Pharmacy staff should always see a usable phone number on the order detail page. The phone should reflect what the customer wants the pharmacy to call for *this order* (which may differ from their default profile phone — e.g. a relative is picking up).

## Non-goals

- Verifying phone numbers via SMS OTP. Telegram-shared contacts are trusted; manually-entered numbers are accepted as-is.
- Migrating existing customer phones from any external system.
- Updating phones on past orders retroactively when the user changes their profile phone.

---

## User Flow

### First-time phone collection (bot)

1. Customer sends `/start` to the bot.
2. Bot replies with welcome message + a **reply keyboard** containing a single button: `📱 Raqamni ulashish` / `📱 Поделиться номером` / `📱 Share contact` (`KeyboardButton(request_contact=True)`).
3. When the user taps the button, Telegram sends a `Contact` message to the bot.
4. The handler saves `contact.phone_number` to `User.phone` (creating the user row if needed) and replies: "✅ Rahmat! Endi ilovani ochishingiz mumkin." with the existing inline `Open App` button.
5. If the user ignores the contact request and opens the Mini App directly, `User.phone` stays null and they will be prompted at checkout (next flow).

### Per-order phone confirmation (Mini App checkout)

The `Order.tsx` checkout page gains a new section between **Notes** and **Submit**:

```
┌─ Aloqa raqami (kerakli holatda) ────────┐
│ ◉ Mening raqamim:  +998 90 123 45 67    │  (visible only if user.phone set)
│ ○ Boshqa raqam:    [_________________]  │
└──────────────────────────────────────────┘
```

Behavior:
- If `user.phone` is set: **"Mening raqamim"** is selected by default. The user can switch to **"Boshqa raqam"** which reveals an input.
- If `user.phone` is null: only the **"Boshqa raqam"** input shows, and it is **required** to submit. (Hint text: "Dorixona kerak bo'lganda shu raqamga qo'ng'iroq qiladi.")
- If a different number is entered, it is sent as `contact_phone` in the create-order request and stored on the `Order` row only — the user's profile phone is **not** modified. (Future iteration could offer "save as default", but YAGNI for now.)

### Profile phone edit (Settings page)

The `Settings.tsx` profile card gains a row:

```
Telefon raqam      +998 90 123 45 67   [✏️]
```

Tapping the pencil icon opens an inline input. On save:
- Frontend calls `PATCH /api/v1/users/me/phone` with `{phone: "+998..."}`.
- Backend validates against `^\+?\d{9,15}$` and updates `User.phone`.
- Existing orders are not modified.

### Staff view (already supported, refined)

`StaffOrderDetail.tsx` displays an **effective phone**:
- If `order.contact_phone` is set → show it with a small badge: `🔄 Boshqa raqam` (i18n: "Different number")
- Otherwise → show `order.user_phone` plainly.
- If both are null → hide the row (matches today's behavior).

---

## Data model

### `orders` table — add column

```sql
ALTER TABLE orders ADD COLUMN contact_phone VARCHAR(20) NULL;
```

- Nullable. When null, callers fall back to `user.phone`.
- No index needed — staff lookups go through `order_id`, not phone.

### `users` table — no change

`users.phone` already exists as `VARCHAR(20) NULL UNIQUE`. We will populate it via:
- The new `/contact` bot handler (Telegram-shared contact)
- The new `PATCH /users/me/phone` endpoint (manual edit)

> ⚠️ The existing `UNIQUE` constraint on `users.phone` could conflict if two Telegram accounts share the same phone (e.g., a number was reused after deletion, or a user has both a web account and a Telegram account). Plan: catch `IntegrityError` in both write paths and return a friendly error ("Bu raqam boshqa hisobga biriktirilgan").

---

## API changes

### Modified: `POST /api/v1/orders`

Add optional `contact_phone` to request body:

```json
{
  "pharmacy_id": "...",
  "order_type": "medicine_search",
  "items": [...],
  "notes": "...",
  "contact_phone": "+998901234567"   // ← new, optional, validated
}
```

- Validation: `^\+?\d{9,15}$` (same as auth)
- Stored on `Order.contact_phone`. If absent, the column stays null.

### New: `PATCH /api/v1/users/me/phone`

```http
PATCH /api/v1/users/me/phone
Authorization: tma <initData> | Bearer <jwt>
Content-Type: application/json

{ "phone": "+998901234567" }
```

Response: `200 OK` with `{ "phone": "+998901234567" }`. Errors:
- `400` – invalid format
- `409` – phone already used by a different account

### Modified: `GET /api/v1/staff/orders/{id}` (and list)

`StaffOrderResponse` adds:
```json
{ ..., "contact_phone": "+998..." | null }
```

`user_phone` is unchanged (still reflects `User.phone`). Frontend chooses which to display.

### Modified: `POST /api/v1/auth/init` and `/auth/token-login`

`AuthResponse` adds `phone: string | null` so the Mini App can pre-fill the checkout radio without an extra round-trip.

---

## Backend implementation notes

### `app/bot/handlers.py`

Add a new router (or extend the main one) with:

1. A `_contact_keyboard(lang)` helper returning `ReplyKeyboardMarkup(keyboard=[[KeyboardButton(text=..., request_contact=True)]], one_time_keyboard=True, resize_keyboard=True)`.
2. Modify `cmd_start` to send the contact-request keyboard *if* the user does not yet have `User.phone` saved (look up by `telegram_user_id`). If the phone is already saved, keep today's inline `Open App` keyboard.
3. New handler `@router.message(F.contact)` that:
   - Verifies `message.contact.user_id == message.from_user.id` (so users can't share someone else's contact).
   - Upserts the user (same logic as `auth_init`) and writes `phone = message.contact.phone_number`.
   - Responds with a "thanks" message + the inline `Open App` keyboard.
   - Wraps `IntegrityError` so a unique-collision returns a polite "Bu raqam boshqa hisobga biriktirilgan" message instead of a 500.

### `app/services/order_service.py`

`create_order` gains a `contact_phone: str | None = None` parameter, which is assigned to `order.contact_phone` before commit.

### `app/api/orders.py`

`CreateOrderRequest` adds `contact_phone: str | None = Field(default=None, pattern=r"^\+?\d{9,15}$")`. Pass through to `order_service.create_order`.

### `app/api/staff.py`

`StaffOrderResponse` adds `contact_phone: str | None`. `_staff_order_response` populates it from `order.contact_phone`.

### New file: `app/api/users.py` (or add to existing module)

```python
@router.patch("/users/me/phone")
async def update_my_phone(
    body: UpdatePhoneRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UpdatePhoneResponse:
    ...
```

Register the new router in `app/api/__init__.py`.

### `app/api/auth.py`

`TokenResponse` adds `phone: str | None = None`. Set it from `user.phone` in both `auth_init` and `token_login`.

### Migration

New revision `h6i7j8k9l0m1_add_contact_phone_to_orders.py`:
- Up: `op.add_column('orders', sa.Column('contact_phone', sa.String(20), nullable=True))`
- Down: `op.drop_column('orders', 'contact_phone')`

---

## Frontend implementation notes

### `services/api.ts`

- `CreateOrderRequest`: add `contact_phone?: string`.
- `StaffOrder`: add `contact_phone: string | null`.
- `AuthResponse`: add `phone: string | null`.
- New: `updateMyPhone(phone: string): Promise<{ phone: string }>` calling `PATCH /users/me/phone`.

### `pages/Order.tsx` (checkout)

- Read `user.phone` from `localStorage` (set during auth) or via `AuthResponse`.
- New state: `phoneMode: 'saved' | 'other'`, `otherPhone: string`.
- Default `phoneMode = 'saved'` if `user.phone` exists, else `'other'`.
- New section UI between Notes and Submit (radio + conditional input).
- Validation before `handleSubmit`: if `phoneMode === 'other'`, ensure `otherPhone` matches the regex, otherwise show error.
- Pass `contact_phone: phoneMode === 'other' ? otherPhone.trim() : undefined` to `createOrder`.

### `pages/Settings.tsx`

- Read phone from `localStorage` (or fetch on mount). Display in the profile card with an edit pencil.
- Edit mode shows an inline input + Save/Cancel. On save, call `updateMyPhone`, update local state + `localStorage`. Show error on 400/409.

### `pages/staff/OrderDetail.tsx`

- Replace the existing `user_phone` row with logic:
  - If `order.contact_phone` → render a row with the phone + a small badge (`<span>🔄 {t('staff.alternatePhone')}</span>`).
  - Else if `order.user_phone` → render the standard row.
  - Else → omit the row.

### Auth wiring (`App.tsx` / wherever auth response is consumed)

After `auth_init`, store `phone` in `localStorage` so checkout/settings can read it without extra calls.

### i18n keys (uz/ru/en, all three locale files)

```
order.contactPhone           "Aloqa raqami"
order.contactPhoneHint       "Dorixona kerak bo'lsa shu raqamga qo'ng'iroq qiladi"
order.myPhone                "Mening raqamim"
order.otherPhone             "Boshqa raqam"
order.phoneRequired          "Telefon raqam kiritish shart"
order.phoneInvalid           "Raqam noto'g'ri formatda"
settings.phone               "Telefon raqam"
settings.phoneNotSet         "Kiritilmagan"
settings.editPhone           "Tahrirlash"
settings.savePhone           "Saqlash"
settings.phoneInUse          "Bu raqam boshqa hisobga biriktirilgan"
staff.alternatePhone         "Boshqa raqam"
```

---

## Testing strategy

### Backend (pytest)

- `tests/test_orders.py`: extend to cover `contact_phone` round-trip on create + staff fetch.
- `tests/test_users.py` (new): `PATCH /users/me/phone` happy path, invalid format → 400, conflict → 409.
- `tests/test_bot.py` (if it exists, otherwise skip): the contact handler upserts phone correctly. Telegram bot tests are typically skipped in CI for this repo, so a smoke test with mocked Bot is sufficient.

### Frontend

- Manually verify three flows in browser:
  1. Bot `/start` → tap "Share contact" → check user has `phone` in DB.
  2. Open Mini App as user **with** saved phone → checkout shows the radio defaulting to "Mening raqamim" → submit and confirm staff sees that phone.
  3. Open Mini App as user **without** saved phone → checkout requires manual entry → submit and confirm staff sees `🔄 Boshqa raqam` badge.
- Settings: edit phone, refresh page, verify it persists.

### Regression

- Existing orders without `contact_phone` continue to render the user phone (or hide the row if null) — nothing should break.

---

## Rollout

Single PR. Steps:
1. Migration applied automatically on deploy (alembic upgrade head).
2. Backend changes go live; old clients (still without checkout phone field) keep working — `contact_phone` is optional.
3. Frontend changes go live in the same deploy; new bot handler activates when bot reloads.
4. After deploy, send a one-time announcement via the bot encouraging existing users to share their contact (optional, can be skipped).
