"""add manufacturer, price, quantity, expiry_date

Revision ID: b3f7a2e91c4d
Revises: ca6e4d747a0e
Create Date: 2026-02-23 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3f7a2e91c4d'
down_revision: Union[str, None] = 'ca6e4d747a0e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('medicines', sa.Column('manufacturer', sa.String(500), nullable=True))
    op.add_column('medicine_availability', sa.Column('price', sa.Numeric(12, 2), nullable=True))
    op.add_column('medicine_availability', sa.Column('quantity', sa.Numeric(10, 3), nullable=True))
    op.add_column('medicine_availability', sa.Column('expiry_date', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('medicine_availability', 'expiry_date')
    op.drop_column('medicine_availability', 'quantity')
    op.drop_column('medicine_availability', 'price')
    op.drop_column('medicines', 'manufacturer')
