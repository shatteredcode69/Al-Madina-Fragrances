# Al Madina Fragrances (AMF)

A local-first desk for a fragrance business: supplier catalogs, customers, invoices and printable
records. It is a static web app (plain HTML, CSS and JavaScript) with **no build step and no server**.
All records stay in your browser.

## Run locally

```bash
python3 -m http.server 8765      # or: npm start
```

Open <http://localhost:8765>. (Opening `index.html` straight from the file system also works, but a local
server is recommended.)

## Features

| Area | What you can do |
| --- | --- |
| **Catalogs** | Four supplier catalogs. Search by name, code or serial; add, edit and remove fragrances; export a catalog to Excel or PDF. Stock is optional: blank = not set, `0` = out of stock. |
| **Customers** | Searchable customer keys such as `001-abbas`, a dedicated account page, edit, and delete (only when the customer has no invoices). |
| **Billing** | One invoice can mix products from all suppliers. Lines keep a snapshot of the name, supplier, serial and price, so old invoices never change. Add or remove lines, record payments, edit invoices later. |
| **Invoices** | **Invoice** opens a branded print view; choose "Save as PDF" in the print dialog. Invoice numbers are unique and never reused. |
| **Backups** | **Export backup** downloads a JSON file; **Import backup** restores it (it replaces the current data after a confirmation). |
| **Settings** | Shop details, logo (large images are shrunk automatically), supplier names, light/dark theme. |

Keyboard: `Esc` closes any dialog.

## Your data

Records are stored in the browser's local storage on this device. **Clearing site data deletes them**, so
export a backup regularly, and before moving to another device or browser. If the browser refuses a save
(storage full or blocked), the app tells you instead of failing silently.

Data saved by older versions is upgraded automatically the first time the new version loads
(see `migrate()` in `app.js`).

## Project layout

```
index.html            page shell
app.js                the whole application (state, views, events)
styles.css            light and dark themes, responsive layout
src/data/catalog.js   bundled Arabian Perfumery price list (source: data.pdf)
logo.jpg              default logo
tests/                automated tests (jsdom)
```

## Tests

```bash
npm install
npm test
```

The tests boot the real `app.js` in jsdom and cover adding/editing fragrances, invoices, customers,
backups, migrations and the regressions listed in [CHANGELOG.md](CHANGELOG.md). CI runs them on every push.

## Deploy (optional): GitHub Pages

Because it is a static site, Pages can host it: **Settings → Pages → Deploy from a branch → `main` / root**.
Note that data lives in each visitor's own browser, never in the repository.

## Before you make the repository public

`src/data/catalog.js` and `data.pdf` contain your supplier **price list**. Keep the repository **private**,
or remove those files (and `git rm --cached` them) before publishing. Customer and invoice data is never
part of the repository.
