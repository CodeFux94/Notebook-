# Notizbuch

Ein klassisches Notizbuch zum Handschreiben mit dem Apple Pencil, als installierbare Web-App (PWA) für das iPad.
Reines HTML, CSS und JavaScript (ES-Module), ohne Build-Schritt, statisch hostbar (z. B. GitHub Pages).

## Funktionen

- Notizbücher anlegen, umbenennen und löschen (Papier: kariert 5 mm oder liniert 8 mm, optional mit Rand links)
- Mehrere Seiten im Format A4: hinzufügen, löschen, blättern, Seitenübersicht
- Bleistift (körnig, Druck → Breite und Deckkraft, Neigung → Schraffur) und Kugelschreiber (gleichmäßig)
- Je 3 Strichstärken, Farben Graphit, Schwarz, Dunkelblau, Rot, Grün
- Radierer: Strich (ganzen Strich entfernen) oder Pixel. Zum Umschalten den Radierer erneut antippen
- Rückgängig/Wiederholen (auch ⌘Z / ⇧⌘Z mit Tastatur)
- Nur der Pencil zeichnet. Finger verschieben (1 Finger) und zoomen (2 Finger). Tippen auf „100 %“ setzt den Zoom zurück
- Speicherung lokal in IndexedDB, vollständig offline nutzbar

## Struktur

```
index.html              App-Gerüst, iOS-Meta-Tags
manifest.webmanifest    PWA-Manifest
sw.js                   Service Worker (Offline-Cache, VERSION bei Änderungen erhöhen!)
css/app.css             Gestaltung
js/app.js               Start, Routing, Service Worker, persist()
js/library.js           Startscreen mit Notizbüchern
js/editor.js            Seite: Canvas-Ebenen, Eingabe, Werkzeuge, Seitenverwaltung
js/ink.js               Strich-Rendering (Bleistift, Kugelschreiber, Radierer)
js/paper.js             Papier-Ebene (Raster/Linien)
js/geometry.js, view.js, history.js, db.js, dialog.js, icons.js, util.js
icons/                  App-Icons (SVG-Quelle + PNG)
tools/make-icons.mjs    PNG-Icons aus SVG erzeugen (nur für Entwicklung, braucht Playwright)
tests/                  Unit-Tests (node --test tests/*.test.mjs) und E2E-Test (node tests/e2e.mjs)
```

**Datenmodell**: `notebooks {id, name, paper, margin, cover, pageIds[], createdAt, updatedAt}`,
`pages {id, notebookId, strokes[], updatedAt}`, ein Strich ist `{id, tool, color, width, pts}`.
`pts` ist ein `Float32Array` mit `x, y, Druck, Neigung` je Punkt (Einheit: mm auf der Seite).
Der Pixelradierer wird als eigener Strich gespeichert und nur auf der Tinten-Ebene ausgestanzt.
Deshalb bleiben Linien und Raster immer erhalten und das Radieren lässt sich rückgängig machen.

## Veröffentlichen (GitHub Pages)

1. Auf github.com das Repository öffnen → **Settings** → **Pages**.
2. Unter *Build and deployment*: Source **Deploy from a branch**, Branch auswählen (z. B. `main`), Ordner **/ (root)** → **Save**.
3. Nach ca. 1 Minute steht oben die Adresse, z. B. `https://<benutzername>.github.io/<repository>/`.

Nach jeder Änderung an den App-Dateien `VERSION` in `sw.js` erhöhen, damit installierte Apps das Update laden.

## Lokal testen

```
python3 -m http.server 8000     # dann http://localhost:8000
node --test tests/*.test.mjs    # Logik
node tests/e2e.mjs              # Browser-Test (Playwright + Chromium)
```
