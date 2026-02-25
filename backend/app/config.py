from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Telegram
    telegram_bot_token: str
    telegram_webapp_url: str = ""

    # Database
    database_url: str = "postgresql+asyncpg://pharmacy:pharmacy@localhost:5432/pharmacy_db"

    # MinIO / S3
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "prescriptions"
    minio_use_ssl: bool = False

    # App
    secret_key: str = "change-this-to-a-random-secret-key"
    debug: bool = False

    # Payment - Click
    click_merchant_id: str = ""
    click_service_id: str = ""
    click_secret_key: str = ""

    # Payment - Payme
    payme_merchant_id: str = ""
    payme_secret_key: str = ""

    # Admin
    admin_telegram_id: int = 0

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
