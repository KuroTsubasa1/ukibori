# Third-party components

## potrace (JavaScript port)

`js/vendor/potrace.js` is a JavaScript port of **Potrace** by kilobtye
(https://github.com/kilobtye/potrace), based on Potrace by Peter Selinger
(http://potrace.sourceforge.net).

- Copyright (C) 2001-2013 Peter Selinger.
- **Licensed under the GNU General Public License (GPL).**

It is used for image/text vector tracing in the bookmark composer's `.3mf`
export (image → smooth color contours). A small clearly-marked adapter
(`traceData`) was added at the end of the file to trace an in-memory binary mask
synchronously; the upstream algorithm is unmodified.

**Implication:** because this project bundles GPL-licensed code, distributions of
the project that include `js/vendor/potrace.js` are subject to the GPL.
