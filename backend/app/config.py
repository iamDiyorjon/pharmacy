from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Telegram
    telegram_bot_token: str
    telegram_webapp_url: str = ""
    telegram_webhook_url: str = ""
    telegram_webhook_secret: str = ""

    # Database
    database_url: str = (
        "postgresql+asyncpg://pharmacy:pharmacy@localhost:5432/pharmacy_db"
    )

    # MinIO / S3
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "prescriptions"
    minio_use_ssl: bool = False

    # App
    secret_key: str = "change-this-to-a-random-secret-key"
    debug: bool = False

    # Admin
    admin_telegram_id: int = 0
    admin_phones: list[str] = []

    @field_validator("admin_phones", mode="before")
    @classmethod
    def _split_phones(cls, v):
        if isinstance(v, str):
            return [p.strip() for p in v.split(",") if p.strip()]
        return v

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()


def user_is_admin(user) -> bool:
    """True if the user is a platform admin via either Telegram ID or phone."""
    if user is None:
        return False
    if (
        settings.admin_telegram_id
        and user.telegram_user_id == settings.admin_telegram_id
    ):
        return True
    if user.phone and user.phone in settings.admin_phones:
        return True
    return False
