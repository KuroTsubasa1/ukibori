# Ukibori · 浮彫

**Bilder als erhabenes 3D-Relief — Schwarz-Weiß & flache Farben, komplett lokal im Browser.**

Ukibori (jap. *浮彫* „erhabenes Relief") wandelt ein beliebiges Bild in eine
Schwarz-Weiß- oder flache Farbgrafik um und exportiert es als PNG **oder als
druckfertiges 3D-Relief** (`.3mf`) – z. B. für Untersetzer, Schilder oder
Magnete. Alles läuft **vollständig im Browser**: keine Uploads, kein Server,
keine Abhängigkeiten.

## Features

- **Zwei Modi**
  - **Schwarz / Weiß** – Schwellwert (manuell oder *Auto / Otsu*), Invertieren,
    Entfernen kleiner „Inseln".
  - **Farben reduzieren** – Palette (Median-Cut-Quantisierung) oder Posterize,
    plus Inseln entfernen und Kanten glätten.
- **Kreis-Zuschnitt** – rundes Ausschneiden mit verschieb- und zoombarem Kreis
  und optionalem Rahmen.
- **Transparenz erhalten** – transparente Hintergründe bleiben transparent
  (statt weiß) in Vorschau, PNG und 3D.
- **3D-Export (`.3mf`)**
  - Funktioniert mit und ohne Kreis-Zuschnitt.
  - **Sub-Pixel-glatte Konturen** (interpolierte Marching-Squares) – keine
    Treppenstufen, auch bei runden Rändern und feinen Motiven.
  - Einstellbare Dicken (Schwarz/Weiß), **Grundplatte**, **Rand/Rahmen**
    (rund oder rechteckig) und Auflösung; jede Farbe wird als eigenes,
    eingefärbtes Objekt exportiert (Mehrfarb-Druck).
- **PNG-Export** der umgewandelten Grafik.
- **Live-Vorschau** neben den Optionen, responsives Layout.

## Nutzung

Es gibt **keinen Build-Schritt**. Zwei Wege:

1. **Direkt öffnen:** `index.html` im Browser öffnen (Doppelklick / `file://`).
2. **Lokal servieren** (empfohlen, vermeidet vereinzelte `file://`-Einschränkungen):
   ```sh
   python3 -m http.server 8000
   # dann http://localhost:8000/ öffnen
   ```

Dann: Bild per Drag & Drop oder Dateiauswahl laden → Modus und Parameter in der
Seitenleiste einstellen → **PNG herunterladen** oder **3D-Modell (.3mf)**
exportieren.

> Die Verarbeitung passiert komplett lokal im Browser – das Bild verlässt das
> Gerät nicht.

## Projektstruktur

```
index.html        Markup + Einbindung von CSS/JS und Favicon
styles.css        Gesamtes Styling (Layout, Sidebar, Akkordeon-Optionen)
favicon.svg       Marken-Favicon (Kanji 浮, geprägt)
js/
  image-ops.js    Reine Pixel-Operationen (Schwellwert, Otsu, Inseln,
                  Posterize, Median-Cut, Kreismaske …)
  geometry.js     3D-Geometrie ohne DOM: Marching-Squares (Sub-Pixel-Konturen),
                  Triangulation (earcut), ZIP/3MF-Erzeugung
  app.js          DOM, Zustand, Render-Pipeline, Event-Handling, Export
docs/superpowers/specs/   Design-Dokumente der einzelnen Features
```

Reines HTML/CSS/JS, keine Frameworks oder externen Bibliotheken.

## Wie der glatte 3D-Export funktioniert

Das umgewandelte Bild wird in kontinuierliche, vorzeichenbehaftete Felder
übersetzt (Graustufen-Deckung für Schwarz/Weiß, Alpha für Transparenz,
analytische Distanzfelder für Kreis/Ring/Rahmen). Aus diesen Feldern werden per
**interpolierter Marching-Squares** sub-pixel-genaue Konturen extrahiert,
trianguliert und extrudiert – dadurch entstehen glatte Kanten statt einer
achsenparallelen Pixel-Treppe. Der **Glättung**-Regler dient nur noch der
leichten Nachglättung/Vereinfachung.

## Browser-Unterstützung

Moderne Browser (Canvas, SVG-Favicon, ES2017+). Die App ist auf Deutsch.
