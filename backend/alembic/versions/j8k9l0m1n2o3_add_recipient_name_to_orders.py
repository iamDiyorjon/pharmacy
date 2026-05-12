"""add recipient_name to orders

Revision ID: j8k9l0m1n2o3
Revises: i7j8k9l0m1n2
Create Date: 2026-05-12 01:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "j8k9l0m1n2o3"
down_revision: Union[str, None] = "i7j8k9l0m1n2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("recipient_name", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "recipient_name")
