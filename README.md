# SHRUUM's StageBuilder 2

Trainingsaufbauten fürs Schiessen planen. Installierbare PWA, läuft komplett im Browser und offline. Kein Server, kein Login: alle Daten liegen lokal in IndexedDB.

## Start

```bash
npm install
npm run dev       # Entwicklung
npm run build     # Produktions-Build nach dist/
npm run preview   # Build lokal ansehen (inkl. Service Worker)
npm test          # Unit-Tests (Node Test Runner, keine Zusatzpakete)
```

Node 20 oder neuer.

## Hosting

`dist/` ist statisch und kann überall liegen, auch in einem Unterordner (`base: "./"`). Für GitHub Pages reicht es, `dist/` zu veröffentlichen. Der Service Worker braucht HTTPS (oder localhost).

## Funktionen

- Schiesskeller mit Grösse, Raster und Kugelfang pro Meter und Seite
- Stages mit Bauten, Zielen, Markierungen und Material per Klick oder Drag & Drop
- Verschieben mit Fangen an Objektkanten, Mitten und Raster (Alt hält das Fangen aus)
- Drehgriff mit 15°-Raster (Shift 45°, Alt frei), Längengriff für Wände, Fenster, Türen, Laufweg, Notiz
- Mehrfachauswahl per Shift oder Auswahlrahmen, Ausrichten und Verteilen
- Rückgängig/Wiederholen für alle Änderungen inkl. Kugelfang
- Automatische Zielnummerierung, Munitions- und Materialübersicht
- Automatisches Speichern, Hell- und Dunkelmodus, Touch-Bedienung mit Pinch-Zoom
- Druckansicht und PDF: Planblatt mit Massstab, Legende, Munition und Abhakfeldern, Briefing mit Ablauf, Sicherheit, Material und Zielliste, Resultatblatt zum Ausfüllen
- JSON-Export pro Stage, pro Keller oder als Backup; Import erkennt auch Einzel-Exporte der alten Flask-Version

## Tastaturkürzel

| Taste | Aktion |
|---|---|
| Ctrl+Z / Ctrl+Shift+Z | Rückgängig / Wiederholen |
| Ctrl+D | Duplizieren |
| Ctrl+C / Ctrl+V | Kopieren / Einfügen |
| Ctrl+A | Alles auswählen |
| Entf | Löschen |
| Pfeiltasten | Verschieben 0.1 m (Shift 0.5 m) |
| R / Shift+R | Drehen ±15° |
| G | Raster ein/aus |
| Ctrl+0 | Einpassen |
| Leertaste + Ziehen | Ansicht verschieben |
| Ctrl + Mausrad | Zoom |
| Ctrl+S | Stage als JSON exportieren |
| Ctrl+P | Druckansicht öffnen |

## Aufbau

```
src/
  lib/            Reine Logik, ohne React testbar
    model.js      Datenmodell, Normalisierung, Munition, Nummerierung
    geometry.js   Öffnungen, Rotation, Hüllen, Fangen
    align.js      Ausrichten und Verteilen
    io.js         JSON-Export/-Import inkl. altem Format
    print.js      Layout des Druckblatts (Ausrichtung, Massstab, Zielliste)
    storage.js    IndexedDB
    useEditor.js  Editor-Zustand mit Verlauf
  components/
    Canvas.jsx    Zeichenfläche, Zeiger- und Touch-Interaktion
    Symbol.jsx    Ein Renderer für alle Symbole (Editor, Vorschauen, Palette)
    Inspector.jsx Eigenschaften von Objekt, Stage und Keller
    Library.jsx   Übersicht
    PrintView.jsx Druckansicht (A4, über den Druckdialog als PDF speicherbar)
public/
  sw.js           Service Worker (App-Shell offline)
```

Datenmodell und Feldnamen sind kompatibel zum Export der alten Version, damit bestehende Stages importierbar bleiben.

## Lizenzen

Icons: [Lucide](https://lucide.dev), ISC-Lizenz.

## Drucken und PDF

Die Druckansicht nutzt den Druckdialog des Browsers. Für ein PDF dort «Als PDF speichern» wählen. Damit bleibt alles Vektorgrafik mit auswählbarem Text, ohne zusätzliche Bibliothek. Der Massstab auf dem Planblatt gilt nur bei 100 % Druckgrösse; «Kopf- und Fusszeilen» im Dialog ausschalten.
