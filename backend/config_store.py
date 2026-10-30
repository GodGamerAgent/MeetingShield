import json
import os
from typing import Dict, Any
from pydantic import BaseModel, Field

CONFIG_FILE = os.environ.get("AURA_CONFIG_FILE") or os.path.join(os.path.dirname(__file__), "config.json")
DEFAULT_AUDIO_DIR = os.environ.get("AURA_AUDIO_DIR") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "recordings"))

class AppConfig(BaseModel):
    lm_studio_base_url: str = Field(default="http://localhost:1234/v1")
    lm_studio_model: str = Field(default="gemma-4")
    temperature: float = Field(default=0.2)
    max_tokens: int = Field(default=2048)
    vad_aggressiveness: int = Field(default=2)
    noise_cleaning_enabled: bool = Field(default=True)
    epoch_window_minutes: int = Field(default=10)
    default_calendar: str = Field(default="google")
    user_name: str = Field(default="Robin")
    audio_export_dir: str = Field(default=DEFAULT_AUDIO_DIR)
    whisper_model: str = Field(default="base")
    whisper_language: str = Field(default="auto")

class ConfigStore:
    def __init__(self, filepath: str = CONFIG_FILE):
        self.filepath = filepath
        self.config = self._load()

    def _load(self) -> AppConfig:
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if "audio_export_dir" not in data or not data["audio_export_dir"]:
                        data["audio_export_dir"] = DEFAULT_AUDIO_DIR
                    return AppConfig(**data)
            except Exception as e:
                print(f"[ConfigStore] Warning loading config: {e}. Using defaults.")
        cfg = AppConfig(audio_export_dir=DEFAULT_AUDIO_DIR)
        self._save(cfg)
        return cfg

    def _save(self, cfg: AppConfig):
        try:
            with open(self.filepath, "w", encoding="utf-8") as f:
                json.dump(cfg.model_dump(), f, indent=2)
        except Exception as e:
            print(f"[ConfigStore] Error saving config: {e}")

    def get(self) -> AppConfig:
        return self.config

    def update(self, updates: Dict[str, Any]) -> AppConfig:
        current_data = self.config.model_dump()
        current_data.update(updates)
        new_config = AppConfig(**current_data)
        self.config = new_config
        self._save(new_config)

        # Ensure audio export dir exists
        try:
            os.makedirs(new_config.audio_export_dir, exist_ok=True)
        except Exception as e:
            print(f"[ConfigStore] Could not create audio export directory: {e}")

        return self.config

config_store = ConfigStore()
# Ensure audio export dir is created
try:
    os.makedirs(config_store.get().audio_export_dir, exist_ok=True)
except Exception:
    pass
