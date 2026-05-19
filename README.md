# SHRUUM's StageBuilder

Flask/SQLite-Webapp zur Planung von Schiesstrainings mit Stage-Editor, PDF-Export und JSON Import/Export.

## Lokale Installation

1. Python-Umgebung erstellen

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. ENV-Datei anlegen

```bash
cp .env.example .env
```

3. App starten (lokal ohne Auth)

```bash
python app.py
```

Standard lokal:
- `AUTH_ENABLED=false`
- `DATABASE_PATH=instance/stagebuilder.db`
- `APP_BASE_URL=http://127.0.0.1:5000`

## Environment Variablen

- `SECRET_KEY`
- `DATABASE_PATH`
- `APP_BASE_URL`
- `AUTH_ENABLED`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `ALLOWED_EMAILS`
- `FLASK_ENV`

## Auth aktivieren (optional)

Setze in `.env`:

```env
AUTH_ENABLED=true
SECRET_KEY=<starker-zufälliger-wert>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://deine-domain/auth/google/callback
```

Hinweise:
- Wenn `AUTH_ENABLED=true`, ist Login Pflicht.
- Wenn `ALLOWED_EMAILS` leer ist, sind alle Google-User erlaubt.
- Wenn gesetzt (kommagetrennt), sind nur diese E-Mails erlaubt.

Beispiel:

```env
ALLOWED_EMAILS=jannis@example.com,test@example.com
```

OAuth-Routen:
- `/login`
- `/logout`
- `/auth/google`
- `/auth/google/callback`

## Hosting / Production

Gunicorn Start-Command:

```bash
gunicorn app:app --bind 0.0.0.0:$PORT
```

Alternativ über `Procfile`:

```txt
web: gunicorn app:app --bind 0.0.0.0:$PORT
```

Wichtig für SQLite im Hosting:
- `DATABASE_PATH` auf persistenten Pfad setzen (z. B. `/data/stagebuilder.db`).
- Flüchtige Dateisysteme löschen DB-Inhalte nach Deploy/Restart.

## Sicherheit

Bei `FLASK_ENV=production` oder `AUTH_ENABLED=true`:
- `SECRET_KEY` muss gesetzt sein und darf kein Default sein.
- Session-Cookies sind `HttpOnly`, `SameSite=Lax`, `Secure=true`.
- App startet mit Konfigurationsfehler, wenn kritische Secrets fehlen.

## Backup

SQLite-Backup einfach per Dateikopie der DB-Datei aus `DATABASE_PATH`, z. B.:

```bash
cp instance/stagebuilder.db backups/stagebuilder-$(date +%F).db
```
