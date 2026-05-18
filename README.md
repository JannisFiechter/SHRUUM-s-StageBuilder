# SHRUUM's StageBuilder

Eine  Flask-Webapp zur Planung von Schiesstrainings.  
Mit der App können Schiesskeller, Stages, Munitionsbedarf, Magazinvorbereitung und PDF-Trainingsblätter erstellt und verwaltet werden.

## Funktionen

- Schiesskeller anlegen, speichern und bearbeiten
- Kugelfang-/Schusszonen meterweise am Rand des Schiesskellers definieren
- Stagebuilder mit 2D-Editor
- Objekte platzieren, verschieben, drehen und duplizieren
- Objekte in Metern bearbeiten
- Trainingsdaten erfassen
- Waffenwahl:
  - Kurzwaffe
  - Langwaffe
  - Kurzwaffe + Langwaffe
- Separate Startpositionen je Waffe
- Automatische Munitionsberechnung
- Magazinvorbereitung pro Waffe
- Automatische Schwierigkeit:
  - Leicht
  - Mittel
  - Schwer
- Automatische Versionierung
- PDF-Export mit Stageplan, Legende, Munition und Vorbereitung
- JSON Import / Export
- SQLite als lokale Datenbank

## Technischer Stack

- Python
- Flask
- SQLite
- HTML
- CSS
- JavaScript
- PDF-Export serverseitig

