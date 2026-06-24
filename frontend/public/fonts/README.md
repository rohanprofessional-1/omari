# Galaxie Copernicus web fonts

The app uses **Galaxie Copernicus** (Village, https://vllg.com) for all text.
It's a licensed font, so it isn't bundled here. The `@font-face` rules in
`src/index.css` load it **locally-installed first**; for the web (or any machine
without it installed) place the licensed `.woff2` files in this folder using
these exact names:

- `GalaxieCopernicus-Book.woff2`           (weight 400, normal)
- `GalaxieCopernicus-Medium.woff2`         (weight 500, normal)
- `GalaxieCopernicus-Semibold.woff2`       (weight 600, normal)
- `GalaxieCopernicus-Bold.woff2`           (weight 700, normal)
- `GalaxieCopernicus-BookItalic.woff2`     (weight 400, italic)
- `GalaxieCopernicus-SemiboldItalic.woff2` (weight 600, italic)

Files are served from `/fonts/...`. If neither a local copy nor these files are
present, text falls back to a system serif (Georgia → Times New Roman → serif).
