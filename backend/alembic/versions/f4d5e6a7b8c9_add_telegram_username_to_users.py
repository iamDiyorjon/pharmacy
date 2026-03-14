"""Add telegram_username to users

Revision ID: f4d5e6a7b8c9
Revises: e3c4d5f6a7b8
Create Date: 2026-03-14
"""

from alembic import op
import sqlalchemy as sa

revision = "f4d5e6a7b8c9"
down_revision = "e3c4d5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("telegram_username", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "telegram_username")
