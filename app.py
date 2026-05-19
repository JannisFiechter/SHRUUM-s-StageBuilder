from __future__ import annotations

import json
import os
import hashlib
import math
import sqlite3
import uuid
from functools import wraps
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

try:
    from authlib.integrations.flask_client import OAuth
except Exception:  # pragma: no cover - optional dependency fallback
    OAuth = None
from dotenv import load_dotenv
from flask import Flask, Response, abort, jsonify, redirect, render_template, request, send_file, session, url_for
from werkzeug.middleware.proxy_fix import ProxyFix
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    Frame,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.graphics.shapes import Circle, Drawing, Ellipse, Group, Line, Polygon, Rect, String
from reportlab.graphics import renderPDF


BASE_DIR = Path(__file__).resolve().parent
SYMBOL_PATH = BASE_DIR / "static" / "symbols.json"

SIDES = {"top", "right", "bottom", "left"}
DIFFICULTIES = ("Leicht", "Mittel", "Schwer")
LEGACY_AUTHOR_SETTING = "co" + "achName"
LEGACY_FOOTER_SETTING = "footerText"


app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False
load_dotenv()


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_csv(name: str) -> list[str]:
    raw = os.getenv(name, "")
    return [item.strip().lower() for item in raw.split(",") if item.strip()]


def resolve_db_path() -> Path:
    configured = os.getenv("DATABASE_PATH", "instance/stagebuilder.db").strip() or "instance/stagebuilder.db"
    path = Path(configured)
    return path if path.is_absolute() else BASE_DIR / path


app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "local-dev-secret")
app.config["APP_BASE_URL"] = os.getenv("APP_BASE_URL", "http://127.0.0.1:5000")
app.config["AUTH_ENABLED"] = env_bool("AUTH_ENABLED", False)
app.config["GOOGLE_CLIENT_ID"] = os.getenv("GOOGLE_CLIENT_ID", "").strip()
app.config["GOOGLE_CLIENT_SECRET"] = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
app.config["GOOGLE_REDIRECT_URI"] = os.getenv("GOOGLE_REDIRECT_URI", "").strip() or f"{app.config['APP_BASE_URL'].rstrip('/')}/auth/google/callback"
app.config["ALLOWED_EMAILS"] = env_csv("ALLOWED_EMAILS")
app.config["FLASK_ENV"] = os.getenv("FLASK_ENV", "development").strip().lower()
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = app.config["FLASK_ENV"] == "production" or app.config["AUTH_ENABLED"]

DB_PATH = resolve_db_path()

oauth = OAuth(app) if OAuth else None


def load_symbol_contract() -> dict:
    with SYMBOL_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


SYMBOL_CONTRACT = load_symbol_contract()


def is_production_mode() -> bool:
    return app.config["FLASK_ENV"] == "production"


def validate_runtime_config() -> None:
    secret = app.config.get("SECRET_KEY", "")
    if app.config["AUTH_ENABLED"] and OAuth is None:
        raise RuntimeError("AUTH_ENABLED=true, aber Authlib ist nicht installiert.")
    if (is_production_mode() or app.config["AUTH_ENABLED"]) and (not secret or secret == "change-me" or secret == "local-dev-secret"):
        raise RuntimeError("SECRET_KEY muss in Production/Auth-Modus gesetzt sein und darf kein Default-Wert sein.")
    if app.config["AUTH_ENABLED"] and (
        not app.config["GOOGLE_CLIENT_ID"]
        or not app.config["GOOGLE_CLIENT_SECRET"]
        or not app.config["GOOGLE_REDIRECT_URI"]
    ):
        raise RuntimeError("AUTH_ENABLED=true, aber Google OAuth Konfiguration ist unvollständig.")


def oauth_ready() -> bool:
    return bool(
        oauth is not None
        and
        app.config["GOOGLE_CLIENT_ID"]
        and app.config["GOOGLE_CLIENT_SECRET"]
        and app.config["GOOGLE_REDIRECT_URI"]
    )


def configure_oauth() -> None:
    if not oauth_ready():
        return
    assert oauth is not None
    oauth.register(
        name="google",
        client_id=app.config["GOOGLE_CLIENT_ID"],
        client_secret=app.config["GOOGLE_CLIENT_SECRET"],
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )


def current_user() -> dict:
    if not app.config["AUTH_ENABLED"]:
        return {"email": "local@stagebuilder", "name": "local"}
    return session.get("user") or {}


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not app.config["AUTH_ENABLED"]:
            return fn(*args, **kwargs)
        if session.get("user"):
            return fn(*args, **kwargs)
        if request.path.startswith("/api/"):
            return jsonify({"error": "Nicht eingeloggt"}), 401
        return redirect(url_for("login", next=request.url))

    return wrapper


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ranges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                width_m REAL NOT NULL,
                height_m REAL NOT NULL,
                grid_m REAL NOT NULL DEFAULT 1,
                pixels_per_meter REAL NOT NULL DEFAULT 32,
                boundary_backstops TEXT NOT NULL DEFAULT '[]',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS stages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                range_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                version TEXT NOT NULL DEFAULT 'v1.0',
                description TEXT NOT NULL DEFAULT '',
                training_goal TEXT NOT NULL DEFAULT '',
                procedure TEXT NOT NULL DEFAULT '',
                safety_notes TEXT NOT NULL DEFAULT '',
                training_type TEXT NOT NULL DEFAULT 'statisch',
                weapon_type TEXT NOT NULL DEFAULT 'kurzwaffe',
                start_position_handgun TEXT NOT NULL DEFAULT 'Holster',
                start_position_longgun TEXT NOT NULL DEFAULT 'Low Ready',
                focus_areas TEXT NOT NULL DEFAULT '[]',
                difficulty_calculated TEXT NOT NULL DEFAULT 'Leicht',
                difficulty_manual TEXT NOT NULL DEFAULT '',
                difficulty_override_enabled INTEGER NOT NULL DEFAULT 0,
                difficulty_reasons TEXT NOT NULL DEFAULT '[]',
                default_target_type TEXT NOT NULL DEFAULT 'Target',
                default_target_type_custom TEXT NOT NULL DEFAULT '',
                target_numbering TEXT NOT NULL DEFAULT '{}',
                setup_list_auto INTEGER NOT NULL DEFAULT 1,
                setup_list_text TEXT NOT NULL DEFAULT '',
                ammo TEXT NOT NULL DEFAULT '{}',
                mag_prep TEXT NOT NULL DEFAULT '{}',
                objects TEXT NOT NULL DEFAULT '[]',
                content_hash TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(range_id) REFERENCES ranges(id) ON DELETE CASCADE
            )
            """
        )
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(stages)").fetchall()}
        if "version" not in columns:
            conn.execute("ALTER TABLE stages ADD COLUMN version TEXT NOT NULL DEFAULT 'v1.0'")
        if "content_hash" not in columns:
            conn.execute("ALTER TABLE stages ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''")
        if "default_target_type" not in columns:
            conn.execute("ALTER TABLE stages ADD COLUMN default_target_type TEXT NOT NULL DEFAULT 'Target'")
        if "default_target_type_custom" not in columns:
            conn.execute("ALTER TABLE stages ADD COLUMN default_target_type_custom TEXT NOT NULL DEFAULT ''")
        if "target_numbering" not in columns:
            conn.execute("ALTER TABLE stages ADD COLUMN target_numbering TEXT NOT NULL DEFAULT '{}'")
        if "setup_list_auto" not in columns:
            conn.execute("ALTER TABLE stages ADD COLUMN setup_list_auto INTEGER NOT NULL DEFAULT 1")
        if "setup_list_text" not in columns:
            conn.execute("ALTER TABLE stages ADD COLUMN setup_list_text TEXT NOT NULL DEFAULT ''")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT ''
            )
            """
        )


def as_float(value, fallback: float) -> float:
    try:
        parsed = float(value)
        return parsed if parsed > 0 else fallback
    except (TypeError, ValueError):
        return fallback


def json_loads(value, fallback):
    if value in (None, ""):
        return fallback
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def compact_backstops(items, width_m: float, height_m: float) -> list[dict]:
    result = []
    max_by_side = {
        "top": int(round(width_m)),
        "bottom": int(round(width_m)),
        "left": int(round(height_m)),
        "right": int(round(height_m)),
    }
    seen = set()
    for item in items or []:
        side = item.get("side")
        meter = item.get("meterIndex")
        if side not in SIDES:
            continue
        try:
            meter = int(meter)
        except (TypeError, ValueError):
            continue
        if meter < 0 or meter >= max_by_side[side]:
            continue
        key = (side, meter)
        if key in seen:
            continue
        seen.add(key)
        result.append({"side": side, "meterIndex": meter, "active": bool(item.get("active", True))})
    return sorted(result, key=lambda x: (["top", "right", "bottom", "left"].index(x["side"]), x["meterIndex"]))


def default_ammo() -> dict:
    return {
        "autoCalculate": True,
        "targetCount": 0,
        "roundsPerTarget": 2,
        "roundsPerRun": 0,
        "runs": 1,
        "roundsPerShooterTotal": 0,
        "manualAmmoNote": "",
    }


def default_settings() -> dict:
    return {"authorName": "", "customFooterText": "", "defaultVersion": "v1.0"}


def default_target_numbering() -> dict:
    return {"enabled": False, "prefix": "T", "start": 1, "mode": "creation-order"}


def normalize_version(value: str | None) -> str:
    text = str(value or "v1.0").strip().lower()
    if text.startswith("v"):
        text = text[1:]
    try:
        major, minor = text.split(".", 1)
        return f"v{int(major)}.{int(minor)}"
    except Exception:
        return "v1.0"


def bump_version(value: str | None) -> str:
    version = normalize_version(value)
    major, minor = version[1:].split(".", 1)
    return f"v{int(major)}.{int(minor) + 1}"


def stage_snapshot(stage: dict) -> dict:
    return {
        "rangeId": stage.get("rangeId"),
        "name": stage.get("name") or "",
        "description": stage.get("description") or "",
        "trainingGoal": stage.get("trainingGoal") or "",
        "procedure": stage.get("procedure") or "",
        "safetyNotes": stage.get("safetyNotes") or "",
        "trainingType": stage.get("trainingType") or "statisch",
        "weaponType": stage.get("weaponType") or "kurzwaffe",
        "startPositionHandgun": stage.get("startPositionHandgun") or "",
        "startPositionLongGun": stage.get("startPositionLongGun") or "",
        "focusAreas": sorted(stage.get("focusAreas") or []),
        "difficultyManual": stage.get("difficultyManual") or "",
        "difficultyOverrideEnabled": bool(stage.get("difficultyOverrideEnabled")),
        "targetType": stage.get("targetType") or stage.get("defaultTargetType") or "Target",
        "targetTypeCustom": stage.get("targetTypeCustom") or stage.get("defaultTargetTypeCustom") or "",
        "targetNumbering": stage.get("targetNumbering") or default_target_numbering(),
        "setupListAuto": bool(stage.get("setupListAuto", True)),
        "setupListText": stage.get("setupListText") or "",
        "ammo": stage.get("ammo") or {},
        "magPrep": stage.get("magPrep") or {},
        "objects": sorted(stage.get("objects") or [], key=lambda obj: obj.get("id", "")),
    }


def stage_content_hash(stage: dict) -> str:
    payload = json.dumps(stage_snapshot(stage), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def get_settings() -> dict:
    settings = default_settings()
    with db() as conn:
        rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
    for row in rows:
        if row["key"] in settings:
            settings[row["key"]] = row["value"]
        elif row["key"] == LEGACY_AUTHOR_SETTING and not settings["authorName"]:
            settings["authorName"] = row["value"]
        elif row["key"] == LEGACY_FOOTER_SETTING and not settings["customFooterText"]:
            settings["customFooterText"] = row["value"]
    return settings


def save_settings(data: dict) -> dict:
    settings = default_settings()
    for key in settings:
        settings[key] = str(data.get(key) or "").strip()
    if not settings["authorName"] and data.get(LEGACY_AUTHOR_SETTING):
        settings["authorName"] = str(data.get(LEGACY_AUTHOR_SETTING) or "").strip()
    if not settings["customFooterText"] and data.get(LEGACY_FOOTER_SETTING):
        settings["customFooterText"] = str(data.get(LEGACY_FOOTER_SETTING) or "").strip()
    if not settings["defaultVersion"]:
        settings["defaultVersion"] = "v1.0"
    with db() as conn:
        for key, value in settings.items():
            conn.execute(
                "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )
    return settings


def default_mag_prep() -> dict:
    return {
        "handgun": {
            "magazineCount": 3,
            "magazines": [
                {"name": "Magazin 1", "state": "voll", "rounds": None},
                {"name": "Magazin 2", "state": "voll", "rounds": None},
                {"name": "Magazin 3", "state": "voll", "rounds": None},
            ],
        },
        "longGun": {
            "magazineCount": 3,
            "magazines": [
                {"name": "Magazin 1", "state": "voll", "rounds": None},
                {"name": "Magazin 2", "state": "voll", "rounds": None},
                {"name": "Magazin 3", "state": "voll", "rounds": None},
            ],
        },
    }


def normalize_ammo(ammo: dict | None, objects: list | None = None) -> dict:
    data = default_ammo()
    data.update(ammo or {})
    base_targets = 0
    bonus_shots = 0
    for obj in objects or []:
        obj_type = obj.get("type")
        variant = (obj.get("properties") or {}).get("targetVariant", "full")
        if obj_type in {"target", "swinger", "mover"} and variant != "no-shoot":
            base_targets += 1
            continue
        if obj_type == "popper":
            bonus_shots += 1
        elif obj_type == "steelPlate":
            bonus_shots += 1
        elif obj_type == "plateRack":
            bonus_shots += 5

    target_count = base_targets
    auto = bool(data.get("autoCalculate", True))
    rounds_per_target = max(1, int(data.get("roundsPerTarget") or 2))
    rounds = math.ceil(target_count * rounds_per_target + bonus_shots) if auto else max(0, int(data.get("roundsPerRun") or 0))
    runs = max(1, int(data.get("runs") or 1))
    data["autoCalculate"] = auto
    data["targetCount"] = target_count
    data["roundsPerTarget"] = rounds_per_target
    data["roundsPerRun"] = rounds
    data["runs"] = runs
    data["roundsPerShooterTotal"] = rounds * runs
    data["manualAmmoNote"] = str(data.get("manualAmmoNote") or "")
    return data


def normalize_mag_section(section: dict | None) -> dict:
    count = max(0, int((section or {}).get("magazineCount") or 0))
    mags = list((section or {}).get("magazines") or [])
    while len(mags) < count:
        mags.append({"name": f"Magazin {len(mags) + 1}", "state": "voll", "rounds": None})
    mags = mags[:count]
    clean = []
    for index, mag in enumerate(mags):
        state = mag.get("state") if mag.get("state") in {"voll", "leer", "anzahl"} else "voll"
        rounds = mag.get("rounds")
        if state == "anzahl":
            try:
                rounds = max(0, int(rounds or 0))
            except (TypeError, ValueError):
                rounds = 0
        else:
            rounds = None
        clean.append({"name": mag.get("name") or f"Magazin {index + 1}", "state": state, "rounds": rounds})
    return {"magazineCount": count, "magazines": clean}


def normalize_mag_prep(mag_prep: dict | None) -> dict:
    defaults = default_mag_prep()
    data = mag_prep or {}
    return {
        "handgun": normalize_mag_section(data.get("handgun") or defaults["handgun"]),
        "longGun": normalize_mag_section(data.get("longGun") or defaults["longGun"]),
    }


def normalize_objects(objects: list | None) -> list[dict]:
    clean = []
    for obj in objects or []:
        properties = obj.get("properties") if isinstance(obj.get("properties"), dict) else {}
        obj_type = obj.get("type") or "target"
        if obj_type == "noShoot":
            obj_type = "target"
            properties = {**properties, "targetVariant": "no-shoot"}
        if obj_type in {"target", "swinger", "mover"}:
            raw_variant = properties.get("targetVariant") or "full"
            variant = raw_variant
            if raw_variant in {"hard-cover", "no-shoot-overlay", "partial"}:
                variant = "half"
            if str(properties.get("role") or "").lower() in {"no-shoot", "noshoot"}:
                variant = "no-shoot"
            properties = {
                "targetVariant": variant if variant in {"full", "no-shoot", "half", "head-only", "custom"} else "full",
                "variantDirection": (properties.get("variantDirection") or "right") if (properties.get("variantDirection") or "right") in {"left", "right", "top", "bottom"} else "right",
                "customTargetVariant": str(properties.get("customTargetVariant") or ""),
                "targetNote": str(properties.get("targetNote") or ""),
            }
        clean.append(
            {
                "id": obj.get("id") or uuid.uuid4().hex,
                "type": obj_type,
                "xM": float(obj.get("xM") or 0),
                "yM": float(obj.get("yM") or 0),
                "widthM": max(0.1, float(obj.get("widthM") or 1)),
                "heightM": max(0.1, float(obj.get("heightM") or 1)),
                "rotation": float(obj.get("rotation") or 0),
                "label": str(obj.get("label") or ""),
                "properties": properties,
            }
        )
    return clean


def calculate_difficulty(stage: dict, range_data: dict | None = None) -> tuple[str, list[str]]:
    training_type = stage.get("trainingType", "statisch")
    weapon_type = stage.get("weaponType", "kurzwaffe")
    focus = set(stage.get("focusAreas") or [])
    objects = stage.get("objects") or []
    target_count = sum(1 for obj in objects if obj.get("type") == "target")
    no_shoot_count = sum(
        1
        for obj in objects
        if obj.get("type") == "target" and (obj.get("properties") or {}).get("targetVariant", "full") == "no-shoot"
    )
    backstop_count = sum(1 for obj in objects if obj.get("type") == "backstop")
    light_count = sum(1 for obj in objects if obj.get("type") == "light")
    if "Team" in focus:
        return "Schwer", ["Schwere Schwierigkeit: Teamdrill."]

    is_two_gun_dynamic = weapon_type == "kurzwaffe_langwaffe" and training_type in {"dynamisch", "kombiniert"}
    if is_two_gun_dynamic and target_count >= 4 and backstop_count >= 1:
        return "Schwer", ["Schwere Schwierigkeit: 2-Gun dynamisch mit mindestens vier Scheiben und mobilem Kugelfang."]

    if training_type in {"dynamisch", "kombiniert"}:
        if weapon_type == "kurzwaffe_langwaffe":
            return "Mittel", ["Mittlere Schwierigkeit: dynamische Einzelübung mit Kurzwaffe und Langwaffe."]
        return "Mittel", ["Mittlere Schwierigkeit: dynamische Einzelübung mit Bewegung oder mehreren Zielen."]

    if backstop_count or target_count > 3 or no_shoot_count or light_count:
        return "Mittel", ["Mittlere Schwierigkeit: statische Übung mit mehreren Elementen."]

    if len(objects) <= 4 and target_count <= 3:
        return "Leicht", ["Leichte Schwierigkeit: statische Übung mit klarer Schussrichtung und wenigen Zielen."]
    return "Mittel", ["Mittlere Schwierigkeit: statische Übung mit mehreren Elementen."]


def row_to_range(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "widthM": row["width_m"],
        "heightM": row["height_m"],
        "gridM": row["grid_m"],
        "pixelsPerMeter": row["pixels_per_meter"],
        "boundaryBackstops": json_loads(row["boundary_backstops"], []),
        "notes": row["notes"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def row_to_stage(row: sqlite3.Row, range_data: dict | None = None) -> dict:
    objects = normalize_objects(json_loads(row["objects"], []))
    ammo = normalize_ammo(json_loads(row["ammo"], {}), objects)
    target_numbering = default_target_numbering()
    target_numbering.update(json_loads(row["target_numbering"], {}) or {})
    stage = {
        "id": row["id"],
        "rangeId": row["range_id"],
        "name": row["name"],
        "version": row["version"],
        "description": row["description"],
        "trainingGoal": row["training_goal"],
        "procedure": row["procedure"],
        "safetyNotes": row["safety_notes"],
        "trainingType": row["training_type"],
        "weaponType": row["weapon_type"],
        "startPositionHandgun": row["start_position_handgun"],
        "startPositionLongGun": row["start_position_longgun"],
        "focusAreas": json_loads(row["focus_areas"], []),
        "difficultyCalculated": row["difficulty_calculated"],
        "difficultyManual": row["difficulty_manual"],
        "difficultyOverrideEnabled": bool(row["difficulty_override_enabled"]),
        "difficultyReasons": json_loads(row["difficulty_reasons"], []),
        "targetType": row["default_target_type"] or "Target",
        "targetTypeCustom": row["default_target_type_custom"] or "",
        "targetNumbering": target_numbering,
        "setupListAuto": bool(row["setup_list_auto"]),
        "setupListText": row["setup_list_text"] or "",
        "contentHash": row["content_hash"],
        "ammo": ammo,
        "magPrep": normalize_mag_prep(json_loads(row["mag_prep"], {})),
        "objects": objects,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }
    calculated, reasons = calculate_difficulty(stage, range_data)
    stage["difficultyCalculated"] = calculated
    stage["difficultyReasons"] = reasons
    return stage


def get_range_or_404(range_id: int) -> tuple[dict | None, int]:
    with db() as conn:
        row = conn.execute("SELECT * FROM ranges WHERE id = ?", (range_id,)).fetchone()
    return (row_to_range(row), 200) if row else (None, 404)


def get_stage_or_404(stage_id: int) -> tuple[dict | None, dict | None, int]:
    with db() as conn:
        row = conn.execute("SELECT * FROM stages WHERE id = ?", (stage_id,)).fetchone()
        if not row:
            return None, None, 404
        rrow = conn.execute("SELECT * FROM ranges WHERE id = ?", (row["range_id"],)).fetchone()
    range_data = row_to_range(rrow) if rrow else None
    return row_to_stage(row, range_data), range_data, 200


@app.before_request
def enforce_auth():
    if not app.config["AUTH_ENABLED"]:
        return None
    public_paths = {"/login", "/logout", "/auth/google", "/auth/google/callback"}
    if request.path.startswith("/static/") or request.path in public_paths:
        return None
    if session.get("user"):
        return None
    if request.path.startswith("/api/"):
        return jsonify({"error": "Nicht eingeloggt"}), 401
    return redirect(url_for("login", next=request.url))


@app.get("/login")
def login():
    if not app.config["AUTH_ENABLED"]:
        return redirect(url_for("index"))
    if session.get("user"):
        return redirect(url_for("index"))
    if not oauth_ready():
        abort(503, description="Google OAuth ist nicht konfiguriert.")
    return render_template("login.html")


@app.get("/auth/google")
def auth_google():
    if not app.config["AUTH_ENABLED"]:
        return redirect(url_for("index"))
    if not oauth_ready():
        abort(503, description="Google OAuth ist nicht konfiguriert.")
    redirect_uri = app.config["GOOGLE_REDIRECT_URI"]
    assert oauth is not None
    return oauth.google.authorize_redirect(redirect_uri)


@app.get("/auth/google/callback")
def auth_google_callback():
    if not app.config["AUTH_ENABLED"]:
        return redirect(url_for("index"))
    if not oauth_ready():
        abort(503, description="Google OAuth ist nicht konfiguriert.")
    assert oauth is not None
    token = oauth.google.authorize_access_token()
    userinfo = token.get("userinfo") or oauth.google.userinfo()
    email = (userinfo.get("email") or "").strip().lower()
    if not email:
        session.clear()
        return redirect(url_for("login"))
    allowed = app.config["ALLOWED_EMAILS"]
    if allowed and email not in allowed:
        session.clear()
        return Response("Zugriff verweigert: E-Mail nicht freigegeben.", status=403)
    session["user"] = {
        "email": email,
        "name": userinfo.get("name") or email,
        "picture": userinfo.get("picture"),
    }
    return redirect(url_for("index"))


@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("login" if app.config["AUTH_ENABLED"] else "index"))


@app.route("/")
@login_required
def index():
    return render_template("index.html", symbol_contract=SYMBOL_CONTRACT)


@app.get("/api/ranges")
@login_required
def api_ranges():
    with db() as conn:
        rows = conn.execute("SELECT * FROM ranges ORDER BY updated_at DESC, id DESC").fetchall()
    return jsonify([row_to_range(row) for row in rows])


@app.post("/api/ranges")
@login_required
def api_create_range():
    data = request.get_json(force=True)
    created = now_iso()
    width = as_float(data.get("widthM"), 8)
    height = as_float(data.get("heightM"), 25)
    backstops = compact_backstops(data.get("boundaryBackstops"), width, height)
    with db() as conn:
        cur = conn.execute(
            """
            INSERT INTO ranges (name, description, width_m, height_m, grid_m, pixels_per_meter, boundary_backstops, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.get("name") or "Neuer Schiesskeller",
                data.get("description") or "",
                width,
                height,
                as_float(data.get("gridM"), 1),
                as_float(data.get("pixelsPerMeter"), 32),
                json.dumps(backstops, ensure_ascii=False),
                data.get("notes") or "",
                created,
                created,
            ),
        )
        row = conn.execute("SELECT * FROM ranges WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(row_to_range(row)), 201


@app.put("/api/ranges/<int:range_id>")
@login_required
def api_update_range(range_id):
    data = request.get_json(force=True)
    existing, status = get_range_or_404(range_id)
    if status != 200:
        return jsonify({"error": "Schiesskeller nicht gefunden"}), 404
    width = as_float(data.get("widthM"), existing["widthM"])
    height = as_float(data.get("heightM"), existing["heightM"])
    backstops = compact_backstops(data.get("boundaryBackstops"), width, height)
    with db() as conn:
        conn.execute(
            """
            UPDATE ranges SET name=?, description=?, width_m=?, height_m=?, grid_m=?, pixels_per_meter=?,
            boundary_backstops=?, notes=?, updated_at=? WHERE id=?
            """,
            (
                data.get("name") or "Schiesskeller",
                data.get("description") or "",
                width,
                height,
                as_float(data.get("gridM"), 1),
                as_float(data.get("pixelsPerMeter"), 32),
                json.dumps(backstops, ensure_ascii=False),
                data.get("notes") or "",
                now_iso(),
                range_id,
            ),
        )
        row = conn.execute("SELECT * FROM ranges WHERE id = ?", (range_id,)).fetchone()
    return jsonify(row_to_range(row))


@app.delete("/api/ranges/<int:range_id>")
@login_required
def api_delete_range(range_id):
    with db() as conn:
        conn.execute("DELETE FROM ranges WHERE id = ?", (range_id,))
    return jsonify({"ok": True})


@app.get("/api/stages")
@login_required
def api_stages():
    with db() as conn:
        rows = conn.execute("SELECT * FROM stages ORDER BY updated_at DESC, id DESC").fetchall()
        ranges = {r["id"]: row_to_range(r) for r in conn.execute("SELECT * FROM ranges").fetchall()}
    return jsonify([row_to_stage(row, ranges.get(row["range_id"])) for row in rows])


@app.get("/api/stages/<int:stage_id>")
@login_required
def api_stage(stage_id):
    stage, range_data, status = get_stage_or_404(stage_id)
    if status != 200:
        return jsonify({"error": "Stage nicht gefunden"}), 404
    return jsonify({"stage": stage, "range": range_data})


@app.post("/api/stages")
@login_required
def api_create_stage():
    data = normalize_stage_payload(request.get_json(force=True))
    data["version"] = "v1.0"
    data["contentHash"] = stage_content_hash(data)
    created = now_iso()
    with db() as conn:
        range_row = conn.execute("SELECT * FROM ranges WHERE id = ?", (data["rangeId"],)).fetchone()
        if not range_row:
            return jsonify({"error": "Bitte zuerst einen Schiesskeller wählen"}), 400
        range_data = row_to_range(range_row)
        calculated, reasons = calculate_difficulty(data, range_data)
        data["difficultyCalculated"] = calculated
        data["difficultyReasons"] = reasons
        cur = conn.execute(stage_insert_sql(), stage_values(data, created, created))
        row = conn.execute("SELECT * FROM stages WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(row_to_stage(row, range_data)), 201


@app.put("/api/stages/<int:stage_id>")
@login_required
def api_update_stage(stage_id):
    data = normalize_stage_payload(request.get_json(force=True))
    with db() as conn:
        existing_row = conn.execute("SELECT * FROM stages WHERE id = ?", (stage_id,)).fetchone()
        if not existing_row:
            return jsonify({"error": "Stage nicht gefunden"}), 404
        range_row = conn.execute("SELECT * FROM ranges WHERE id = ?", (data["rangeId"],)).fetchone()
        if not range_row:
            return jsonify({"error": "Bitte zuerst einen Schiesskeller wählen"}), 400
        range_data = row_to_range(range_row)
        calculated, reasons = calculate_difficulty(data, range_data)
        data["difficultyCalculated"] = calculated
        data["difficultyReasons"] = reasons
        existing = row_to_stage(existing_row, range_data)
        existing_hash = existing.get("contentHash") or stage_content_hash(existing)
        new_hash = stage_content_hash(data)
        if new_hash == existing_hash:
            row = existing_row
            return jsonify(row_to_stage(row, range_data))
        data["version"] = bump_version(existing.get("version"))
        data["contentHash"] = new_hash
        conn.execute(stage_update_sql(), stage_values(data, "", now_iso()) + (stage_id,))
        row = conn.execute("SELECT * FROM stages WHERE id = ?", (stage_id,)).fetchone()
    return jsonify(row_to_stage(row, range_data))


@app.post("/api/stages/<int:stage_id>/duplicate")
@login_required
def api_duplicate_stage(stage_id):
    stage, range_data, status = get_stage_or_404(stage_id)
    if status != 200:
        return jsonify({"error": "Stage nicht gefunden"}), 404
    stage["name"] = f"{stage['name']} Kopie"
    stage["version"] = "v1.0"
    stage["contentHash"] = stage_content_hash(stage)
    created = now_iso()
    with db() as conn:
        cur = conn.execute(stage_insert_sql(), stage_values(stage, created, created))
        row = conn.execute("SELECT * FROM stages WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(row_to_stage(row, range_data)), 201


@app.delete("/api/stages/<int:stage_id>")
@login_required
def api_delete_stage(stage_id):
    with db() as conn:
        conn.execute("DELETE FROM stages WHERE id = ?", (stage_id,))
    return jsonify({"ok": True})


@app.get("/api/stages/<int:stage_id>/export.json")
@login_required
def api_export_stage(stage_id):
    stage, range_data, status = get_stage_or_404(stage_id)
    if status != 200:
        return jsonify({"error": "Stage nicht gefunden"}), 404
    payload = {"version": 1, "stage": stage, "range": range_data}
    return Response(
        json.dumps(payload, ensure_ascii=False, indent=2),
        mimetype="application/json; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=stage-{stage_id}.json"},
    )


@app.post("/api/import")
@login_required
def api_import_json():
    payload = request.get_json(force=True)
    range_payload = payload.get("range")
    stage_payload = payload.get("stage") or payload
    with db() as conn:
        range_id = stage_payload.get("rangeId")
        if range_payload:
            width = as_float(range_payload.get("widthM"), 8)
            height = as_float(range_payload.get("heightM"), 25)
            created = now_iso()
            cur = conn.execute(
                """
                INSERT INTO ranges (name, description, width_m, height_m, grid_m, pixels_per_meter, boundary_backstops, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"{range_payload.get('name') or 'Importierter Keller'} Import",
                    range_payload.get("description") or "",
                    width,
                    height,
                    as_float(range_payload.get("gridM"), 1),
                    as_float(range_payload.get("pixelsPerMeter"), 32),
                    json.dumps(compact_backstops(range_payload.get("boundaryBackstops"), width, height), ensure_ascii=False),
                    range_payload.get("notes") or "",
                    created,
                    created,
                ),
            )
            range_id = cur.lastrowid
        if not range_id or not conn.execute("SELECT id FROM ranges WHERE id = ?", (range_id,)).fetchone():
            return jsonify({"error": "Import benötigt einen gültigen Schiesskeller"}), 400
        stage_payload["rangeId"] = range_id
        data = normalize_stage_payload(stage_payload)
        range_data = row_to_range(conn.execute("SELECT * FROM ranges WHERE id = ?", (range_id,)).fetchone())
        data["difficultyCalculated"], data["difficultyReasons"] = calculate_difficulty(data, range_data)
        data["version"] = "v1.0"
        data["contentHash"] = stage_content_hash(data)
        created = now_iso()
        cur = conn.execute(stage_insert_sql(), stage_values(data, created, created))
        row = conn.execute("SELECT * FROM stages WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(row_to_stage(row, range_data)), 201


@app.get("/api/stages/<int:stage_id>/pdf")
@login_required
def api_pdf(stage_id):
    stage, range_data, status = get_stage_or_404(stage_id)
    if status != 200:
        return jsonify({"error": "Stage nicht gefunden"}), 404
    pdf = build_pdf(stage, range_data, get_settings())
    filename = f"{safe_filename(stage['name']) or 'stage'}.pdf"
    return send_file(pdf, mimetype="application/pdf", as_attachment=True, download_name=filename)


@app.get("/api/settings")
@login_required
def api_get_settings():
    return jsonify(get_settings())


@app.put("/api/settings")
@login_required
def api_save_settings():
    return jsonify(save_settings(request.get_json(force=True)))


def normalize_stage_payload(raw: dict) -> dict:
    objects = normalize_objects(raw.get("objects"))
    numbering = raw.get("targetNumbering") if isinstance(raw.get("targetNumbering"), dict) else {}
    stage = {
        "rangeId": int(raw.get("rangeId") or 0),
        "name": raw.get("name") or "Neue Stage",
        "version": normalize_version(raw.get("version") or "v1.0"),
        "description": raw.get("description") or "",
        "trainingGoal": raw.get("trainingGoal") or "",
        "procedure": raw.get("procedure") or "",
        "safetyNotes": raw.get("safetyNotes") or "",
        "trainingType": raw.get("trainingType") if raw.get("trainingType") in {"statisch", "dynamisch", "kombiniert"} else "statisch",
        "weaponType": raw.get("weaponType") if raw.get("weaponType") in {"kurzwaffe", "langwaffe", "kurzwaffe_langwaffe"} else "kurzwaffe",
        "startPositionHandgun": raw.get("startPositionHandgun") or "Holster",
        "startPositionLongGun": raw.get("startPositionLongGun") or "Low Ready",
        "focusAreas": raw.get("focusAreas") if isinstance(raw.get("focusAreas"), list) else [],
        "difficultyManual": raw.get("difficultyManual") if raw.get("difficultyManual") in DIFFICULTIES else "",
        "difficultyOverrideEnabled": bool(raw.get("difficultyOverrideEnabled")),
        "targetType": raw.get("targetType") or raw.get("defaultTargetType") or "Target",
        "targetTypeCustom": str(raw.get("targetTypeCustom") or raw.get("defaultTargetTypeCustom") or ""),
        "targetNumbering": {
            "enabled": bool(numbering.get("enabled")),
            "prefix": str(numbering.get("prefix") or "T"),
            "start": max(1, int(numbering.get("start") or 1)),
            "mode": "creation-order",
        },
        "setupListAuto": bool(raw.get("setupListAuto", True)),
        "setupListText": str(raw.get("setupListText") or ""),
        "ammo": normalize_ammo(raw.get("ammo"), objects),
        "magPrep": normalize_mag_prep(raw.get("magPrep")),
        "objects": objects,
    }
    stage["difficultyCalculated"], stage["difficultyReasons"] = calculate_difficulty(stage)
    return stage


def stage_insert_sql() -> str:
    return """
    INSERT INTO stages (
        range_id, name, version, description, training_goal, procedure, safety_notes, training_type, weapon_type,
        start_position_handgun, start_position_longgun, focus_areas, difficulty_calculated, difficulty_manual,
        difficulty_override_enabled, difficulty_reasons, default_target_type, default_target_type_custom, target_numbering,
        setup_list_auto, setup_list_text, ammo, mag_prep, objects, content_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """


def stage_update_sql() -> str:
    return """
    UPDATE stages SET range_id=?, name=?, version=?, description=?, training_goal=?, procedure=?, safety_notes=?,
    training_type=?, weapon_type=?, start_position_handgun=?, start_position_longgun=?, focus_areas=?,
    difficulty_calculated=?, difficulty_manual=?, difficulty_override_enabled=?, difficulty_reasons=?, default_target_type=?,
    default_target_type_custom=?, target_numbering=?, setup_list_auto=?, setup_list_text=?, ammo=?, mag_prep=?, objects=?, content_hash=?, updated_at=? WHERE id=?
    """


def stage_values(data: dict, created_at: str, updated_at: str) -> tuple:
    values = (
        data["rangeId"],
        data["name"],
        data["version"],
        data["description"],
        data["trainingGoal"],
        data["procedure"],
        data["safetyNotes"],
        data["trainingType"],
        data["weaponType"],
        data["startPositionHandgun"],
        data["startPositionLongGun"],
        json.dumps(data["focusAreas"], ensure_ascii=False),
        data["difficultyCalculated"],
        data["difficultyManual"],
        1 if data["difficultyOverrideEnabled"] else 0,
        json.dumps(data["difficultyReasons"], ensure_ascii=False),
        data["targetType"],
        data["targetTypeCustom"],
        json.dumps(data["targetNumbering"], ensure_ascii=False),
        1 if data["setupListAuto"] else 0,
        data["setupListText"],
        json.dumps(data["ammo"], ensure_ascii=False),
        json.dumps(data["magPrep"], ensure_ascii=False),
        json.dumps(data["objects"], ensure_ascii=False),
        data.get("contentHash") or stage_content_hash(data),
    )
    if created_at:
        return values + (created_at, updated_at)
    return values + (updated_at,)


def safe_filename(name: str) -> str:
    return "".join(ch for ch in name if ch.isalnum() or ch in (" ", "-", "_")).strip().replace(" ", "_")


def active_difficulty(stage: dict) -> str:
    if stage.get("difficultyOverrideEnabled") and stage.get("difficultyManual"):
        return stage["difficultyManual"]
    return stage.get("difficultyCalculated") or "Leicht"


def yes_weapon(stage: dict, weapon: str) -> bool:
    return stage["weaponType"] == weapon or stage["weaponType"] == "kurzwaffe_langwaffe"


def para(text: str, style) -> Paragraph:
    return Paragraph((text or "").replace("\n", "<br/>"), style)


class FooterCanvas(canvas.Canvas):
    def __init__(self, *args, footer_text="", author_name="", version="", **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []
        self.footer_text = footer_text
        self.author_name = author_name
        self.version = version

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        page_count = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_footer(page_count)
            super().showPage()
        super().save()

    def draw_footer(self, page_count):
        page_w, _ = A4
        left_parts = []
        if self.footer_text:
            left_parts.append(self.footer_text)
        if self.author_name:
            left_parts.append(f"Author: {self.author_name}")
        if self.version:
            left_parts.append(f"Version {self.version}")
        self.setStrokeColor(colors.HexColor("#cbd5e1"))
        self.setLineWidth(0.35)
        self.line(14 * mm, 9 * mm, page_w - 14 * mm, 9 * mm)
        self.setFillColor(colors.HexColor("#64748b"))
        self.setFont("Helvetica", 7)
        self.drawString(14 * mm, 5 * mm, " · ".join(left_parts))
        self.drawRightString(page_w - 14 * mm, 5 * mm, f"Seite {self._pageNumber}/{page_count}")


def format_pdf_date() -> str:
    return datetime.now().strftime("%d.%m.%Y")


def build_pdf(stage: dict, range_data: dict, settings: dict | None = None) -> BytesIO:
    settings = settings or default_settings()
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=10 * mm,
        bottomMargin=14 * mm,
        title=stage["name"],
        pageCompression=0,
    )
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="Tiny", fontName="Helvetica", fontSize=7, leading=8.5, alignment=TA_LEFT, textColor=colors.HexColor("#374151")))
    styles.add(ParagraphStyle(name="Small", fontName="Helvetica", fontSize=8, leading=10, alignment=TA_LEFT, textColor=colors.HexColor("#111827")))
    styles.add(ParagraphStyle(name="Meta", fontName="Helvetica", fontSize=7.5, leading=9, textColor=colors.HexColor("#374151")))
    styles.add(ParagraphStyle(name="BoxTitle", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=colors.HexColor("#111827")))
    styles.add(ParagraphStyle(name="TitleStage", fontName="Helvetica-Bold", fontSize=18, leading=21, textColor=colors.HexColor("#0f172a")))
    styles.add(ParagraphStyle(name="Subtitle", fontName="Helvetica", fontSize=8, leading=10, textColor=colors.HexColor("#475569")))
    styles.add(ParagraphStyle(name="Badge", fontName="Helvetica-Bold", fontSize=8, leading=10, alignment=1, textColor=colors.white))

    author = settings.get("authorName") or ""
    header_left = [
        Paragraph("SHRUUM's StageBuilder", styles["Subtitle"]),
        Paragraph(stage["name"], styles["TitleStage"]),
        Paragraph(f"{range_data['name']} / {range_data['widthM']:g} x {range_data['heightM']:g} m", styles["Subtitle"]),
    ]
    right_meta = Table(
        [[difficulty_badge(active_difficulty(stage), styles)], [Paragraph(f"Datum: {format_pdf_date()}<br/>Version: {stage.get('version') or 'v1.0'}" + (f"<br/>Author: {author}" if author else ""), styles["Meta"])]],
        colWidths=[42 * mm],
    )
    right_meta.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    header = Table([[header_left, right_meta]], colWidths=[132 * mm, 42 * mm])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("ALIGN", (1, 0), (1, 0), "LEFT"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story = [header, Spacer(1, 3 * mm)]

    meta_rows = [
        ("Trainingsart", label_training_type(stage["trainingType"])),
        ("Waffe", label_weapon(stage["weaponType"])),
        ("Munition", f"{stage['ammo']['roundsPerShooterTotal']} Schuss"),
    ]
    if yes_weapon(stage, "kurzwaffe"):
        meta_rows.insert(2, ("Start Kurzwaffe", stage["startPositionHandgun"]))
    if yes_weapon(stage, "langwaffe"):
        meta_rows.insert(3, ("Start Langwaffe", stage["startPositionLongGun"]))
    story.append(info_cards(meta_rows, styles))
    story.append(Spacer(1, 4 * mm))

    drawing, used_labels = stage_drawing(stage, range_data, 130 * mm, 119 * mm)
    legend = legend_table(stage, range_data, used_labels, styles)
    right_stack = [legend, Spacer(1, 3 * mm), ammo_box(stage, styles)]
    story.append(Table([[drawing, right_stack]], colWidths=[132 * mm, 42 * mm], style=TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ])))
    story.append(Spacer(1, 4 * mm))
    content_blocks = [("Trainingsziel", stage["trainingGoal"])]
    if stage.get("setupListText"):
        content_blocks.append(("Setup / Material", stage["setupListText"]))
    content_blocks.extend([
        ("Kurzbeschreibung", stage["description"]),
        ("Sicherheitsnotizen", stage["safetyNotes"]),
    ])
    content_blocks = [(title, text) for title, text in content_blocks if text]
    if content_blocks:
        story.append(two_col_boxes(content_blocks, styles))

    story.append(PageBreak())
    page2_right = Table([[difficulty_badge(active_difficulty(stage), styles)], [Paragraph(f"Version: {stage.get('version') or 'v1.0'}<br/>Datum: {format_pdf_date()}" + (f"<br/>Author: {author}" if author else ""), styles["Meta"])]], colWidths=[42 * mm])
    page2_right.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story.append(Table([[[Paragraph("SHRUUM's StageBuilder", styles["Subtitle"]), Paragraph(stage["name"], styles["TitleStage"])], page2_right]], colWidths=[132 * mm, 42 * mm], style=TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "LEFT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ])))
    story.append(Spacer(1, 4 * mm))
    story.append(box("Ablaufbeschreibung", stage["procedure"] or "-", styles, width=170 * mm, min_height=102 * mm))
    story.append(Spacer(1, 4 * mm))
    mag_boxes = []
    if yes_weapon(stage, "kurzwaffe"):
        mag_boxes.append(("Magazinvorbereitung Kurzwaffe", mag_text(stage["magPrep"]["handgun"])))
    if yes_weapon(stage, "langwaffe"):
        mag_boxes.append(("Magazinvorbereitung Langwaffe", mag_text(stage["magPrep"]["longGun"])))
    if stage["ammo"].get("manualAmmoNote"):
        mag_boxes.append(("Munitionsnotiz", stage["ammo"]["manualAmmoNote"]))
    if mag_boxes:
        story.append(two_col_boxes(mag_boxes, styles))
    doc.build(
        story,
        canvasmaker=lambda *args, **kwargs: FooterCanvas(
            *args,
            footer_text=settings.get("customFooterText", ""),
            author_name=author,
            version=stage.get("version") or settings.get("defaultVersion") or "v1.0",
            **kwargs,
        ),
    )
    buffer.seek(0)
    return buffer


def info_table(rows, styles, widths):
    data = [[Paragraph(f"<b>{k}</b>", styles["Small"]), Paragraph(v, styles["Small"])] for k, v in rows]
    table = Table(data, colWidths=widths)
    table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f3f4f6")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return table


def difficulty_badge(level: str, styles):
    color = {
        "Leicht": colors.HexColor("#2f9e62"),
        "Mittel": colors.HexColor("#c98219"),
        "Schwer": colors.HexColor("#c2413b"),
    }.get(level, colors.HexColor("#475569"))
    table = Table([[Paragraph(f"Schwierigkeit<br/>{level}", styles["Badge"])]], colWidths=[42 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), color),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.3, color),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def info_cards(rows, styles):
    cells = []
    widths = []
    for key, value in rows:
        cells.append(Paragraph(f"<b>{key}</b><br/>{value}", styles["Meta"]))
        widths.append(170 * mm / max(1, len(rows)))
    table = Table([cells], colWidths=widths)
    table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


def ammo_box(stage: dict, styles):
    ammo = stage["ammo"]
    rows = [[Paragraph("<b>Munition</b>", styles["BoxTitle"]), ""]]
    if ammo.get("autoCalculate"):
        rows.extend([
            [Paragraph("Scheiben", styles["Small"]), Paragraph(str(ammo["targetCount"]), styles["Small"])],
            [Paragraph("Schüsse/Scheibe", styles["Small"]), Paragraph(str(ammo["roundsPerTarget"]), styles["Small"])],
        ])
    rows.extend([
        [Paragraph("Pro Durchgang", styles["Small"]), Paragraph(str(ammo["roundsPerRun"]), styles["Small"])],
        [Paragraph("Durchgänge", styles["Small"]), Paragraph(str(ammo["runs"]), styles["Small"])],
        [Paragraph("Total pro Schütze", styles["Small"]), Paragraph(f"<b>{ammo['roundsPerShooterTotal']} Schuss</b>", styles["Small"])],
    ])
    if ammo.get("manualAmmoNote"):
        rows.append([Paragraph("Munitionsnotiz", styles["Small"]), para(ammo["manualAmmoNote"], styles["Small"])])
    table = Table(rows, colWidths=[27 * mm, 15 * mm])
    table.setStyle(TableStyle([
        ("SPAN", (0, 0), (-1, 0)),
        ("BOX", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd5e1")),
        ("INNERGRID", (0, 1), (-1, -1), 0.2, colors.HexColor("#e2e8f0")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e5e7eb")),
        ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#f8fafc")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


def box(title: str, text: str, styles, width=82 * mm, min_height=None):
    body = para(text or "nicht definiert", styles["Small"])
    if min_height:
        body = [body, Spacer(1, min_height)]
    return Table(
        [[Paragraph(title, styles["BoxTitle"])], [body]],
        colWidths=[width],
        style=TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd5e1")),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e5e7eb")),
            ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#f8fafc")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]),
    )


def two_col_boxes(items, styles):
    rows = []
    for index in range(0, len(items), 2):
        left = box(items[index][0], items[index][1], styles)
        right = box(items[index + 1][0], items[index + 1][1], styles) if index + 1 < len(items) else ""
        rows.append([left, right])
    table = Table(rows, colWidths=[85 * mm, 85 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    return table


OBJECT_LABELS = {
    "wall": "Wand",
    "backstop": "mobiler Kugelfang",
    "target": "Scheibe",
    "target_no_shoot": "Scheibe (No-Shoot)",
    "popper": "Popper",
    "steelPlate": "Steel Plate",
    "swinger": "Swinger",
    "mover": "Mover",
    "plateRack": "Plate Rack",
    "activator": "Activator",
    "start": "Startmarkierung",
    "barrel": "Fass",
    "cone": "Pylone",
    "barricade": "Barrikade",
    "light": "Licht",
    "note": "Notiz",
    "arrow": "Pfeil",
    "marker": "Positionsmarker",
}

SYMBOL_THEME = SYMBOL_CONTRACT["objects"]
RENDER_ORDER = {
    "wall": 10,
    "backstop": 20,
    "barricade": 30,
    "barrel": 40,
    "cone": 40,
    "light": 40,
    "note": 40,
    "arrow": 40,
    "marker": 40,
    "popper": 68,
    "steelPlate": 68,
    "swinger": 68,
    "mover": 68,
    "plateRack": 68,
    "activator": 68,
    "start": 45,
    "target": 70,
    "noShoot": 80,
}


def sorted_stage_objects(objects: list[dict]) -> list[dict]:
    return sorted(enumerate(objects or []), key=lambda item: (RENDER_ORDER.get(item[1].get("type"), 50), item[0]))


def stage_drawing(stage: dict, range_data: dict, max_w: float, max_h: float):
    width_m = max(1, float(range_data["widthM"]))
    height_m = max(1, float(range_data["heightM"]))
    scale = min(max_w / width_m, max_h / height_m)
    draw_w = width_m * scale
    draw_h = height_m * scale
    drawing = Drawing(max_w, max_h)
    ox = (max_w - draw_w) / 2
    oy = max_h - draw_h
    drawing.add(Rect(ox, oy, draw_w, draw_h, fillColor=colors.white, strokeColor=colors.HexColor("#111827"), strokeWidth=1.2))
    grid = max(0.5, float(range_data.get("gridM") or 1))
    g = grid
    while g < width_m:
        x = ox + g * scale
        drawing.add(Line(x, oy, x, oy + draw_h, strokeColor=colors.HexColor("#e5e7eb"), strokeWidth=0.25))
        g += grid
    g = grid
    while g < height_m:
        y = oy + g * scale
        drawing.add(Line(ox, y, ox + draw_w, y, strokeColor=colors.HexColor("#e5e7eb"), strokeWidth=0.25))
        g += grid
    add_meter_marks_to_drawing(drawing, ox, oy, draw_w, draw_h, width_m, height_m, scale)
    for b in range_data.get("boundaryBackstops", []):
        if not b.get("active"):
            continue
        geom = get_boundary_segment_geometry(range_data, b["side"], int(b["meterIndex"]))
        x1 = ox + geom["x1"] * scale
        y1 = oy + draw_h - geom["y1"] * scale
        x2 = ox + geom["x2"] * scale
        y2 = oy + draw_h - geom["y2"] * scale
        c = colors.HexColor("#ef4444")
        drawing.add(Line(x1, y1, x2, y2, strokeColor=c, strokeWidth=4))
    used = set()
    ordered_objects = [obj for _, obj in sorted_stage_objects(stage.get("objects") or [])]
    ppm = float(range_data.get("pixelsPerMeter") or 32)
    for obj in ordered_objects:
        used.add(obj["type"])
        add_object_to_drawing(drawing, obj, ox, oy, scale, draw_h, ppm)
    for obj in ordered_objects:
        add_pdf_label(drawing, obj, ox, oy, scale, draw_h, ppm)
    return drawing, used


def should_label_meter(i: int, max_meter: int) -> bool:
    return i in (0, max_meter) or i % 5 == 0


def add_meter_marks_to_drawing(drawing, ox: float, oy: float, draw_w: float, draw_h: float, width_m: float, height_m: float, scale: float):
    tick = 2.2
    label_color = colors.HexColor("#64748b")
    max_x = int(width_m)
    max_y = int(height_m)

    for i in range(0, max_y + 1):
        y = oy + draw_h - i * scale
        drawing.add(Line(ox, y, ox - tick, y, strokeColor=label_color, strokeWidth=0.35))
        if should_label_meter(i, max_y):
            drawing.add(String(ox - tick - 12, y - 2, f"{i} m", fontSize=5.8, fillColor=label_color))

    for i in range(0, max_x + 1):
        x = ox + i * scale
        drawing.add(Line(x, oy, x, oy - tick, strokeColor=label_color, strokeWidth=0.35))
        if should_label_meter(i, max_x):
            text = f"{i} m"
            text_w = stringWidth(text, "Helvetica", 5.8)
            drawing.add(String(x - text_w / 2, oy - tick - 6, text, fontSize=5.8, fillColor=label_color))


def get_boundary_segment_geometry(range_data: dict, side: str, meter_index: int) -> dict:
    width = float(range_data["widthM"])
    height = float(range_data["heightM"])
    i = float(meter_index)
    if side == "top":
        return {"x1": i, "y1": 0, "x2": i + 1, "y2": 0}
    if side == "bottom":
        return {"x1": i, "y1": height, "x2": i + 1, "y2": height}
    if side == "left":
        return {"x1": 0, "y1": i, "x2": 0, "y2": i + 1}
    return {"x1": width, "y1": i, "x2": width, "y2": i + 1}


def get_object_geometry(obj: dict, scale: float, stage_origin_x: float, stage_origin_y: float, pixels_per_meter: float) -> dict:
    spec = SYMBOL_THEME.get(obj["type"], {})
    real_w = max(0.1, float(obj["widthM"]))
    real_h = max(0.1, float(obj["heightM"]))
    center_x = stage_origin_x + (float(obj["xM"]) + real_w / 2) * scale
    center_y = stage_origin_y + (float(obj["yM"]) + real_h / 2) * scale
    if spec.get("fixedVisual"):
        ppm = max(10.0, float(pixels_per_meter or 32))
        width_px = float(spec.get("visualWidthPx", 16)) / ppm * scale
        height_px = float(spec.get("visualHeightPx", 16)) / ppm * scale
    else:
        min_m = max(0.22, 20 / max(10.0, float(pixels_per_meter or 32)))
        width_px = max(real_w, min_m) * scale
        height_px = max(real_h, min_m) * scale
    return {
        "xPx": center_x - width_px / 2,
        "yPx": center_y - height_px / 2,
        "widthPx": width_px,
        "heightPx": height_px,
        "centerX": center_x,
        "centerY": center_y,
        "rotationRad": float(obj.get("rotation") or 0) * 3.141592653589793 / 180,
    }


def pdf_y_from_stage_top(stage_origin_y: float, draw_h: float, y_from_top: float) -> float:
    return stage_origin_y + draw_h - y_from_top


def add_object_to_drawing(drawing, obj, ox, oy, scale, draw_h, pixels_per_meter):
    geom = get_object_geometry(obj, scale, ox, 0, pixels_per_meter)
    w = geom["widthPx"]
    h = geom["heightPx"]
    cx = geom["centerX"]
    cy = pdf_y_from_stage_top(oy, draw_h, geom["centerY"])
    group = Group()
    add_pdf_symbol(group, obj["type"], -w / 2, -h / 2, w, h, obj=obj)
    if obj.get("type") in {"target", "swinger", "mover"}:
        add_pdf_target_variant_overlay(group, obj, -w / 2, -h / 2, w, h, obj.get("type"))
    group.translate(cx, cy)
    if obj.get("rotation"):
        group.rotate(-float(obj.get("rotation") or 0))
    drawing.add(group)


def add_pdf_label(drawing, obj, ox, oy, scale, draw_h, pixels_per_meter):
    if obj.get("label"):
        geom = get_object_geometry(obj, scale, ox, 0, pixels_per_meter)
        x = geom["xPx"]
        y = pdf_y_from_stage_top(oy, draw_h, geom["yPx"])
        label = obj["label"][:18]
        drawing.add(String(x + 2, y + 2, label, fontSize=6, fillColor=colors.HexColor("#111827")))


def add_pdf_symbol(group, obj_type: str, x: float, y: float, w: float, h: float, obj: dict | None = None):
    theme = SYMBOL_THEME.get(obj_type, {"fill": "#93c5fd", "stroke": "#111827"})
    fill = colors.HexColor(theme["fill"])
    stroke = colors.HexColor(theme["stroke"])
    if obj_type == "target":
        variant = ((obj or {}).get("properties") or {}).get("targetVariant") or "full"
        is_no_shoot = variant == "no-shoot"
        target_stroke = colors.HexColor("#dc2626") if is_no_shoot else stroke
        target_fill = colors.HexColor("#f8fafc") if is_no_shoot else fill
        group.add(Rect(x, y, w, h, fillColor=target_fill, strokeColor=target_stroke, strokeWidth=0.9 if is_no_shoot else 0.7))
        if not is_no_shoot:
            r = min(w, h)
            group.add(Circle(x + w / 2, y + h / 2, r * 0.30, fillColor=None, strokeColor=stroke, strokeWidth=0.6))
            group.add(Circle(x + w / 2, y + h / 2, r * 0.13, fillColor=None, strokeColor=stroke, strokeWidth=0.6))
    elif obj_type == "start":
        group.add(Rect(x, y, w, h, fillColor=fill, strokeColor=stroke, strokeWidth=0.8))
        group.add(Line(x + w * .35, y + h * .2, x + w * .35, y + h * .82, strokeColor=stroke, strokeWidth=0.8))
        group.add(Polygon([x + w * .35, y + h * .82, x + w * .78, y + h * .68, x + w * .35, y + h * .54], fillColor=colors.HexColor(theme.get("accent", "#ecfeff")), strokeColor=stroke, strokeWidth=0.6))
    elif obj_type == "barrel":
        group.add(Ellipse(x + w / 2, y + h / 2, w * .42, h * .42, fillColor=fill, strokeColor=stroke, strokeWidth=0.7))
        group.add(Line(x + w * .22, y + h * .5, x + w * .78, y + h * .5, strokeColor=stroke, strokeWidth=0.6))
    elif obj_type == "cone":
        group.add(Polygon([x + w * .5, y + h * .95, x + w * .88, y + h * .12, x + w * .12, y + h * .12], fillColor=fill, strokeColor=stroke, strokeWidth=0.7))
        group.add(Line(x + w * .28, y + h * .38, x + w * .72, y + h * .38, strokeColor=stroke, strokeWidth=0.6))
    elif obj_type == "barricade":
        group.add(Rect(x, y, w, h, fillColor=fill, strokeColor=stroke, strokeWidth=0.7))
        for pos in (.25, .5, .75):
            group.add(Line(x + w * pos, y, x + w * max(0, pos - .18), y + h, strokeColor=stroke, strokeWidth=0.5))
    elif obj_type == "light":
        group.add(Rect(x, y, w, h, fillColor=fill, strokeColor=stroke, strokeWidth=0.7))
        group.add(Polygon([x + w * .5, y + h * .9, x + w * .36, y + h * .5, x + w * .5, y + h * .5, x + w * .42, y + h * .1, x + w * .68, y + h * .58, x + w * .52, y + h * .58], fillColor=stroke, strokeColor=stroke))
    elif obj_type == "arrow":
        group.add(Polygon([x, y + h * .34, x + w * .58, y + h * .34, x + w * .58, y + h * .14, x + w, y + h * .5, x + w * .58, y + h * .86, x + w * .58, y + h * .66, x, y + h * .66], fillColor=fill, strokeColor=stroke, strokeWidth=0.7))
    elif obj_type == "popper":
        group.add(Polygon([x + w * .5, y + h, x + w * .72, y + h * .8, x + w * .76, y + h * .4, x + w * .64, y + h * .16, x + w * .36, y + h * .16, x + w * .24, y + h * .4, x + w * .28, y + h * .8], fillColor=fill, strokeColor=stroke, strokeWidth=0.7))
        group.add(Rect(x + w * .42, y, w * .16, h * .12, fillColor=fill, strokeColor=stroke, strokeWidth=0.7))
    elif obj_type == "steelPlate":
        group.add(Circle(x + w / 2, y + h / 2, min(w, h) * .48, fillColor=fill, strokeColor=stroke, strokeWidth=0.9))
    elif obj_type == "swinger":
        variant = ((obj or {}).get("properties") or {}).get("targetVariant") or "full"
        symbol_fill = colors.HexColor("#f8fafc") if variant == "no-shoot" else fill
        group.add(Rect(x + w * .24, y + h * .20, w * .52, h * .66, fillColor=symbol_fill, strokeColor=stroke, strokeWidth=0.9))
        group.add(Rect(x + w * .42, y + h * .10, w * .16, h * .12, fillColor=stroke, strokeColor=stroke, strokeWidth=0.5))
        group.add(Line(x + w * .22, y + h * .42, x + w * .18, y + h * .5, strokeColor=stroke, strokeWidth=0.9))
        group.add(Line(x + w * .18, y + h * .5, x + w * .22, y + h * .58, strokeColor=stroke, strokeWidth=0.9))
        group.add(Polygon([x + w * .2, y + h * .58, x + w * .25, y + h * .57, x + w * .22, y + h * .53], fillColor=stroke, strokeColor=stroke))
        group.add(Line(x + w * .78, y + h * .58, x + w * .82, y + h * .5, strokeColor=stroke, strokeWidth=0.9))
        group.add(Line(x + w * .82, y + h * .5, x + w * .78, y + h * .42, strokeColor=stroke, strokeWidth=0.9))
        group.add(Polygon([x + w * .8, y + h * .42, x + w * .75, y + h * .43, x + w * .78, y + h * .47], fillColor=stroke, strokeColor=stroke))
    elif obj_type == "mover":
        variant = ((obj or {}).get("properties") or {}).get("targetVariant") or "full"
        symbol_fill = colors.HexColor("#f8fafc") if variant == "no-shoot" else fill
        group.add(Rect(x + w * .24, y + h * .20, w * .52, h * .66, fillColor=symbol_fill, strokeColor=stroke, strokeWidth=0.9))
        group.add(Line(x + w * .16, y + h * .18, x + w * .84, y + h * .18, strokeColor=stroke, strokeWidth=0.9))
        group.add(Line(x + w * .22, y + h * .10, x + w * .78, y + h * .10, strokeColor=stroke, strokeWidth=0.9))
        group.add(Polygon([x + w * .22, y + h * .10, x + w * .29, y + h * .14, x + w * .29, y + h * .06], fillColor=stroke, strokeColor=stroke))
        group.add(Polygon([x + w * .78, y + h * .10, x + w * .71, y + h * .14, x + w * .71, y + h * .06], fillColor=stroke, strokeColor=stroke))
    elif obj_type == "plateRack":
        for pos in (.14, .32, .5, .68, .86):
            group.add(Circle(x + w * pos, y + h * .48, min(w, h) * .18, fillColor=fill, strokeColor=stroke, strokeWidth=0.8))
        group.add(Line(x + w * .06, y + h * .82, x + w * .94, y + h * .82, strokeColor=stroke, strokeWidth=0.8))
    elif obj_type == "activator":
        group.add(Rect(x + w * .2, y + h * .12, w * .6, h * .76, fillColor=fill, strokeColor=stroke, strokeWidth=0.7))
        group.add(Polygon([x + w * .5, y + h * .8, x + w * .42, y + h * .5, x + w * .5, y + h * .5, x + w * .56, y + h * .18, x + w * .68, y + h * .5, x + w * .52, y + h * .5], fillColor=stroke, strokeColor=stroke))
    else:
        group.add(Rect(x, y, w, h, fillColor=fill, strokeColor=stroke, strokeWidth=0.7))
        if obj_type == "wall":
            group.add(Line(x, y + h / 2, x + w, y + h / 2, strokeColor=stroke, strokeWidth=0.8))
        if obj_type == "backstop":
            group.add(Polygon([x + w * .08, y + h * .15, x + w * .92, y + h * .15, x + w * .82, y + h * .85, x + w * .18, y + h * .85], fillColor=fill, strokeColor=stroke, strokeWidth=0.8))
            group.add(Line(x + w * .26, y + h * .5, x + w * .74, y + h * .5, strokeColor=colors.HexColor(theme.get("accent", "#fecaca")), strokeWidth=0.7))
        if obj_type == "marker":
            group.add(Circle(x + w / 2, y + h / 2, min(w, h) * .26, fillColor=None, strokeColor=stroke, strokeWidth=0.8))
        if obj_type == "note":
            group.add(String(x + w * .25, y + h * .35, "T", fontSize=min(w, h) * .5, fillColor=stroke))


def add_pdf_target_variant_overlay(group, obj: dict, x: float, y: float, w: float, h: float, obj_type: str = "target"):
    props = obj.get("properties") or {}
    variant = props.get("targetVariant") or "full"
    direction = props.get("variantDirection") or "right"
    if obj_type == "swinger":
        frame = {"x": x + w * .24, "y": y + h * .14, "w": w * .52, "h": h * .66}
    elif obj_type == "mover":
        frame = {"x": x + w * .24, "y": y + h * .14, "w": w * .52, "h": h * .66}
    else:
        frame = {"x": x, "y": y, "w": w, "h": h}
    if variant == "half":
        if direction == "left":
            group.add(Rect(frame["x"] + frame["w"] * .5, frame["y"], frame["w"] * .5, frame["h"], fillColor=colors.HexColor("#f8fafc"), strokeColor=None))
        elif direction == "right":
            group.add(Rect(frame["x"], frame["y"], frame["w"] * .5, frame["h"], fillColor=colors.HexColor("#f8fafc"), strokeColor=None))
        elif direction == "top":
            group.add(Rect(frame["x"], frame["y"] + frame["h"] * .5, frame["w"], frame["h"] * .5, fillColor=colors.HexColor("#f8fafc"), strokeColor=None))
        else:
            group.add(Rect(frame["x"], frame["y"], frame["w"], frame["h"] * .5, fillColor=colors.HexColor("#f8fafc"), strokeColor=None))
    elif variant == "head-only":
        group.add(Rect(frame["x"], frame["y"], frame["w"], frame["h"] * .66, fillColor=colors.HexColor("#f8fafc"), strokeColor=None))
    if variant == "no-shoot":
        group.add(Line(frame["x"], frame["y"], frame["x"] + frame["w"], frame["y"] + frame["h"], strokeColor=colors.HexColor("#dc2626"), strokeWidth=1))
        group.add(Line(frame["x"] + frame["w"], frame["y"], frame["x"], frame["y"] + frame["h"], strokeColor=colors.HexColor("#dc2626"), strokeWidth=1))


def legend_table(stage: dict, range_data: dict, used_labels: set, styles):
    rows = []
    if any(b.get("active") for b in range_data.get("boundaryBackstops", [])):
        rows.append([legend_symbol("boundary"), Paragraph("Kugelfang / Schusszone", styles["Tiny"])])
    for obj_type in sorted(used_labels, key=lambda key: list(OBJECT_LABELS).index(key) if key in OBJECT_LABELS else 99):
        rows.append([legend_symbol(obj_type), Paragraph(OBJECT_LABELS.get(obj_type, obj_type), styles["Tiny"])])
    has_target_noshoot = any(
        obj.get("type") == "target" and ((obj.get("properties") or {}).get("targetVariant") or "full") == "no-shoot"
        for obj in (stage.get("objects") or [])
    )
    if has_target_noshoot:
        rows.append([legend_symbol("target_no_shoot"), Paragraph(OBJECT_LABELS["target_no_shoot"], styles["Tiny"])])
    if not rows:
        rows.append([legend_symbol("empty"), Paragraph("Keine Objekte platziert", styles["Tiny"])])
    table = Table(rows, colWidths=[9 * mm, 27 * mm])
    table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.2, colors.HexColor("#d1d5db")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    outer = Table([[Paragraph("Legende", styles["BoxTitle"])], [table]], colWidths=[38 * mm])
    outer.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd5e1")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e5e7eb")),
        ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#f8fafc")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return outer


def legend_symbol(obj_type: str):
    d = Drawing(8 * mm, 7 * mm)
    if obj_type == "boundary":
        d.add(Line(1 * mm, 3.5 * mm, 7 * mm, 3.5 * mm, strokeColor=colors.HexColor("#ef4444"), strokeWidth=3))
    elif obj_type == "empty":
        d.add(Rect(2 * mm, 2 * mm, 4 * mm, 3 * mm, fillColor=colors.HexColor("#e5e7eb"), strokeColor=colors.HexColor("#94a3b8"), strokeWidth=0.5))
    else:
        g = Group()
        obj = {"type": obj_type, "properties": {"targetVariant": "no-shoot"}} if obj_type == "target_no_shoot" else None
        base_type = "target" if obj_type == "target_no_shoot" else obj_type
        add_pdf_symbol(g, base_type, 1 * mm, 1.3 * mm, 6 * mm, 4.6 * mm, obj=obj)
        d.add(g)
    return d


def label_training_type(value):
    return {"statisch": "Statisch", "dynamisch": "Dynamisch", "kombiniert": "Kombiniert"}.get(value, value)


def label_weapon(value):
    return {"kurzwaffe": "Kurzwaffe", "langwaffe": "Langwaffe", "kurzwaffe_langwaffe": "Kurzwaffe + Langwaffe"}.get(value, value)


def mag_text(section: dict) -> str:
    lines = []
    for mag in section.get("magazines", []):
        if mag["state"] == "voll":
            state = "Voll"
        elif mag["state"] == "leer":
            state = "Leer"
        else:
            state = f"{mag.get('rounds') or 0} Schuss"
        lines.append(f"{mag['name']}: {state}")
    return "\n".join(lines) or "-"


if is_production_mode():
    app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)  # type: ignore[assignment]

validate_runtime_config()
configure_oauth()
init_db()


if __name__ == "__main__":
    app.run(debug=app.config["FLASK_ENV"] == "development")
