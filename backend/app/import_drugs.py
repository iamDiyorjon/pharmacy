"""
CLI command to manually import drugs from an Excel file.

Usage:
    python -m app.import_drugs --file data/drugs/adika.xlsx --pharmacy-id <UUID>
"""

import argparse
import asyncio
import logging
from uuid import UUID

from app.services.drug_import import import_drugs_from_excel

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="Import drugs from Excel into the database")
    parser.add_argument("--file", required=True, help="Path to the Excel file")
    parser.add_argument("--pharmacy-id", required=True, help="UUID of the pharmacy")
    args = parser.parse_args()

    pharmacy_id = UUID(args.pharmacy_id)
    logger.info("Importing drugs from %s for pharmacy %s", args.file, pharmacy_id)

    stats = asyncio.run(import_drugs_from_excel(args.file, pharmacy_id))
    logger.info("Done! Stats: %s", stats)


if __name__ == "__main__":
    main()
