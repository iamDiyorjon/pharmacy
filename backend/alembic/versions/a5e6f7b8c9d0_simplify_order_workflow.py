"""simplify order workflow: drop priced/confirmed states and payment fields

Revision ID: a5e6f7b8c9d0
Revises: f4d5e6a7b8c9
Create Date: 2026-05-02 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a5e6f7b8c9d0'
down_revision: Union[str, None] = 'f4d5e6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Existing orders are mock/test data — wipe them so we don't carry stale
    # state (priced/confirmed rows, payment fields) into the new schema.
    op.execute("TRUNCATE TABLE orders CASCADE")

    op.drop_column('orders', 'payment_method')
    op.drop_column('orders', 'payment_status')
    op.drop_column('orders', 'priced_at')
    op.drop_column('orders', 'confirmed_at')

    op.add_column(
        'orders',
        sa.Column('rejected_at', sa.DateTime(timezone=True), nullable=True),
    )

    op.execute('DROP TYPE IF EXISTS payment_method')
    op.execute('DROP TYPE IF EXISTS payment_status')

    op.execute('ALTER TYPE order_status RENAME TO order_status_old')
    op.execute(
        "CREATE TYPE order_status AS ENUM "
        "('created', 'ready', 'completed', 'cancelled', 'rejected')"
    )
    op.execute(
        "ALTER TABLE orders ALTER COLUMN status TYPE order_status "
        "USING status::text::order_status"
    )
    op.execute('DROP TYPE order_status_old')


def downgrade() -> None:
    op.execute('ALTER TYPE order_status RENAME TO order_status_old')
    op.execute(
        "CREATE TYPE order_status AS ENUM "
        "('created', 'priced', 'confirmed', 'ready', "
        "'completed', 'cancelled', 'rejected')"
    )
    op.execute(
        "ALTER TABLE orders ALTER COLUMN status TYPE order_status "
        "USING status::text::order_status"
    )
    op.execute('DROP TYPE order_status_old')

    op.execute("CREATE TYPE payment_method AS ENUM ('cash', 'click', 'payme')")
    op.execute("CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed')")

    op.add_column(
        'orders',
        sa.Column(
            'payment_method',
            sa.Enum('cash', 'click', 'payme', name='payment_method'),
            nullable=True,
        ),
    )
    op.add_column(
        'orders',
        sa.Column(
            'payment_status',
            sa.Enum('pending', 'paid', 'failed', name='payment_status'),
            nullable=True,
        ),
    )
    op.add_column(
        'orders',
        sa.Column('priced_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'orders',
        sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
    )

    op.drop_column('orders', 'rejected_at')
