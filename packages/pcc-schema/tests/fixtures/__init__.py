import json
from pathlib import Path
from typing import Any

FIXTURE_DIR = Path(__file__).parent

def load_fixture(name: str) -> Any:
    path = FIXTURE_DIR / f"{name}.json"
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_fixture(name: str, data: Any) -> None:
    path = FIXTURE_DIR / f"{name}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
