"""add staff user_id and make telegram_user_id nullable

Revision ID: d2b3c4e5f6a7
Revises: c1a2b3d4e5f6
Create Date: 2026-02-25 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2b3c4e5f6a7'
down_revision: Union[str, None] = 'c1a2b3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add user_id FK to pharmacy_staff
    op.add_column('pharmacy_staff', sa.Column('user_id', sa.UUID(), nullable=True))
    op.create_foreign_key('fk_staff_user_id', 'pharmacy_staff', 'users', ['user_id'], ['id'])
    op.create_index('ix_pharmacy_staff_user_id', 'pharmacy_staff', ['user_id'], unique=True)

    # Make telegram_user_id nullable on pharmacy_staff
    op.alter_column('pharmacy_staff', 'telegram_user_id',
                    existing_type=sa.BigInteger(),
                    nullable=True)


def downgrade() -> None:
    op.alter_column('pharmacy_staff', 'telegram_user_id',
                    existing_type=sa.BigInteger(),
                    nullable=False)
    op.drop_index('ix_pharmacy_staff_user_id', table_name='pharmacy_staff')
    op.drop_constraint('fk_staff_user_id', 'pharmacy_staff', type_='foreignkey')
    op.drop_column('pharmacy_staff', 'user_id')
