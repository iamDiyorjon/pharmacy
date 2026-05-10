"""add normalized_name to medicines, dedupe, enforce unique

Revision ID: g5h6i7j8k9l0
Revises: a5e6f7b8c9d0
Create Date: 2026-05-10 00:00:00.000000

This migration:
  1. Adds a nullable ``normalized_name`` column to ``medicines``.
  2. Backfills it from ``coalesce(name_ru, name)`` using the same
     normalization rule as ``app.models.medicine.normalize_medicine_name``
     (lowercase + strip whitespace/separators).
  3. Merges duplicate rows that collide on the normalized key:
     - The oldest medicine in each group becomes canonical.
     - For ``medicine_availability`` rows that would now collide on
       ``(medicine_id, pharmacy_id)``, the row with the most recent
       ``updated_at`` is kept.
     - Remaining ``medicine_availability`` and ``order_items`` rows are
       re-pointed to the canonical medicine; duplicates are deleted.
  4. Marks the column NOT NULL and adds the unique index.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "g5h6i7j8k9l0"
down_revision: Union[str, None] = "a5e6f7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_NORMALIZE_EXPR = (
    "lower(regexp_replace(coalesce(name_ru, name), '[\\s\\-_,.;:]+', '', 'g'))"
)


def upgrade() -> None:
    op.execute("ALTER TABLE medicines ADD COLUMN normalized_name VARCHAR(300)")
    op.execute(f"UPDATE medicines SET normalized_name = {_NORMALIZE_EXPR}")

    # Merge duplicates so the upcoming UNIQUE index can be created.
    op.execute(
        """
        DO $$
        DECLARE
            dup RECORD;
            canonical_id UUID;
            other_id UUID;
            i INT;
        BEGIN
            FOR dup IN
                SELECT array_agg(id ORDER BY created_at, id) AS ids
                FROM medicines
                WHERE normalized_name IS NOT NULL AND normalized_name <> ''
                GROUP BY normalized_name
                HAVING COUNT(*) > 1
            LOOP
                canonical_id := dup.ids[1];

                FOR i IN 2..array_length(dup.ids, 1) LOOP
                    other_id := dup.ids[i];

                    -- Conflict resolution for medicine_availability:
                    -- if canonical's row is older than duplicate's, drop canonical's so
                    -- duplicate's (newer) row gets re-pointed in the next step.
                    DELETE FROM medicine_availability ma_canon
                    WHERE ma_canon.medicine_id = canonical_id
                      AND EXISTS (
                          SELECT 1 FROM medicine_availability ma_dup
                          WHERE ma_dup.medicine_id = other_id
                            AND ma_dup.pharmacy_id = ma_canon.pharmacy_id
                            AND ma_dup.updated_at > ma_canon.updated_at
                      );

                    -- Drop duplicate's row where canonical still has same pharmacy
                    -- (canonical's row is at least as fresh, so keep it).
                    DELETE FROM medicine_availability
                    WHERE medicine_id = other_id
                      AND pharmacy_id IN (
                          SELECT pharmacy_id FROM medicine_availability
                          WHERE medicine_id = canonical_id
                      );

                    -- Re-point remaining availability rows to canonical.
                    UPDATE medicine_availability
                    SET medicine_id = canonical_id
                    WHERE medicine_id = other_id;

                    -- Re-point order_items references.
                    UPDATE order_items
                    SET medicine_id = canonical_id
                    WHERE medicine_id = other_id;

                    DELETE FROM medicines WHERE id = other_id;
                END LOOP;
            END LOOP;
        END $$;
        """
    )

    # Backfill any rows that ended up with NULL/empty (shouldn't happen, but safe).
    op.execute(
        f"UPDATE medicines SET normalized_name = {_NORMALIZE_EXPR} "
        f"WHERE normalized_name IS NULL OR normalized_name = ''"
    )

    op.execute("ALTER TABLE medicines ALTER COLUMN normalized_name SET NOT NULL")
    op.execute(
        "CREATE UNIQUE INDEX uq_medicines_normalized_name ON medicines(normalized_name)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_medicines_normalized_name")
    op.execute("ALTER TABLE medicines DROP COLUMN normalized_name")
