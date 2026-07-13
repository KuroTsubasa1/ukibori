"use strict";
// Built-in sample project: the Ukibori coin from the README screenshots.
// Single source of truth is examples/ukibori-coin.json — this file mirrors it
// verbatim so the button works offline and over file:// (no fetch at runtime);
// tests/example-project.test.js guards the parity.
(function () {
  window.EXAMPLE_PROJECT =
  {
    "version": 2,
    "body": {
      "shape": "circle",
      "widthMm": 90,
      "heightMm": 90,
      "cornerRadiusMm": 4,
      "thicknessMm": 3,
      "layerHeightMm": 0.2,
      "baseColor": "#ffffff",
      "borderMm": 2,
      "baseThicknessMm": 0,
      "frame": {
        "widthMm": 3,
        "heightMm": 2,
        "color": "#000000"
      },
      "autoSizeFromElementId": null,
      "freeOutlineFromElementId": null
    },
    "mount": {
      "type": "none",
      "xMm": 45,
      "yMm": 10.5,
      "diameterMm": 5,
      "ringThicknessMm": 0,
      "ringHeightMm": 2,
      "marginMm": 8
    },
    "resolution": 1024,
    "colorStepLayers": 2,
    "amsPalette": [],
    "amsSolidBase": false,
    "autoLayerHeights": true,
    "topLayerColor": null,
    "elements": [
      {
        "id": "1",
        "type": "text",
        "cxMm": 45,
        "cyMm": 40,
        "wMm": 52,
        "hMm": 12,
        "rotationDeg": 0,
        "flipH": false,
        "flipV": false,
        "cutout": false,
        "color": "#c73e3a",
        "depth": {
          "mode": "solid",
          "direction": "raised",
          "heightMm": 1,
          "heightOverrideMm": null,
          "stepLayers": 2,
          "reduce": {
            "method": "palette",
            "numColors": 8,
            "levels": 4,
            "remap": {},
            "order": []
          },
          "threshold": 128,
          "invert": false,
          "smooth": 0.5,
          "baseFloorMm": 0,
          "minIsland": 0,
          "flush": false,
          "colorLayerStyle": "stepped"
        },
        "text": "浮彫",
        "fontFamily": "system-ui",
        "fontWeight": "bold"
      },
      {
        "id": "2",
        "type": "text",
        "cxMm": 45,
        "cyMm": 63,
        "wMm": 36,
        "hMm": 9,
        "rotationDeg": 0,
        "flipH": false,
        "flipV": false,
        "cutout": false,
        "color": "#000000",
        "depth": {
          "mode": "solid",
          "direction": "raised",
          "heightMm": 1,
          "heightOverrideMm": null,
          "stepLayers": 2,
          "reduce": {
            "method": "palette",
            "numColors": 8,
            "levels": 4,
            "remap": {},
            "order": []
          },
          "threshold": 128,
          "invert": false,
          "smooth": 0.5,
          "baseFloorMm": 0,
          "minIsland": 0,
          "flush": false,
          "colorLayerStyle": "stepped"
        },
        "text": "ukibori",
        "fontFamily": "system-ui",
        "fontWeight": "normal"
      },
      {
        "id": "3",
        "type": "shape",
        "cxMm": 45,
        "cyMm": 54,
        "wMm": 26,
        "hMm": 1.6,
        "rotationDeg": 0,
        "flipH": false,
        "flipV": false,
        "cutout": false,
        "color": "#000000",
        "depth": {
          "mode": "solid",
          "direction": "raised",
          "heightMm": 1,
          "heightOverrideMm": null,
          "stepLayers": 2,
          "reduce": {
            "method": "palette",
            "numColors": 8,
            "levels": 4,
            "remap": {},
            "order": []
          },
          "threshold": 128,
          "invert": false,
          "smooth": 0.5,
          "baseFloorMm": 0,
          "minIsland": 0,
          "flush": false,
          "colorLayerStyle": "stepped"
        },
        "shape": "rect"
      },
      {
        "id": "4",
        "type": "shape",
        "cxMm": 31,
        "cyMm": 54,
        "wMm": 4,
        "hMm": 4,
        "rotationDeg": 0,
        "flipH": false,
        "flipV": false,
        "cutout": false,
        "color": "#000000",
        "depth": {
          "mode": "solid",
          "direction": "raised",
          "heightMm": 1,
          "heightOverrideMm": null,
          "stepLayers": 2,
          "reduce": {
            "method": "palette",
            "numColors": 8,
            "levels": 4,
            "remap": {},
            "order": []
          },
          "threshold": 128,
          "invert": false,
          "smooth": 0.5,
          "baseFloorMm": 0,
          "minIsland": 0,
          "flush": false,
          "colorLayerStyle": "stepped"
        },
        "shape": "circle"
      },
      {
        "id": "5",
        "type": "shape",
        "cxMm": 59,
        "cyMm": 54,
        "wMm": 4,
        "hMm": 4,
        "rotationDeg": 0,
        "flipH": false,
        "flipV": false,
        "cutout": false,
        "color": "#000000",
        "depth": {
          "mode": "solid",
          "direction": "raised",
          "heightMm": 1,
          "heightOverrideMm": null,
          "stepLayers": 2,
          "reduce": {
            "method": "palette",
            "numColors": 8,
            "levels": 4,
            "remap": {},
            "order": []
          },
          "threshold": 128,
          "invert": false,
          "smooth": 0.5,
          "baseFloorMm": 0,
          "minIsland": 0,
          "flush": false,
          "colorLayerStyle": "stepped"
        },
        "shape": "circle"
      }
    ],
    "fonts": {}
  };
}());
