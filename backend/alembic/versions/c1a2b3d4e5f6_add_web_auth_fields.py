"""add web auth fields

Revision ID: c1a2b3d4e5f6
Revises: b3f7a2e91c4d
Create Date: 2026-02-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1a2b3d4e5f6'
down_revision: Union[str, None] = 'b3f7a2e91c4d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add password_hash column
    op.add_column('users', sa.Column('password_hash', sa.String(length=255), nullable=True))

    # Make telegram_user_id nullable (web users won't have it)
    op.alter_column('users', 'telegram_user_id',
                    existing_type=sa.BigInteger(),
                    nullable=True)

    # Add unique index on phone for web login
    op.create_index('ix_users_phone', 'users', ['phone'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_users_phone', table_name='users')
    op.alter_column('users', 'telegram_user_id',
                    existing_type=sa.BigInteger(),
                    nullable=False)
    op.drop_column('users', 'password_hash')
