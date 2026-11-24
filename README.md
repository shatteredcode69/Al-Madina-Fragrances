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
| **Price auto-fill** | In the fragrance form, type the price per kg and the other prices fill in by themselves: ÷ 1000 per gram, ÷ 40 per 25 g, ÷ 10 per 100 g (1 kg = 100,000 PKR gives 100 / 2,500 / 10,000). You can still adjust any of them. |
| **Share a list** | **Share list** (catalog), **Share** (on a fragrance) or **Send price list** (customer page) builds a message with the fragrances you tick, written exactly as they appear in your catalog, plus the details you choose (code, price/kg, /gram, /25g, /100g, serial, size, stock, notes). Send it on WhatsApp, copy it, or print / save it as a branded PDF. |
| **Payment reminders** | Unpaid invoices get WhatsApp reminders on a schedule you set (default: day 1, 2 and 7 after the invoice, then every 7 days). The **Reminders** page, a sidebar badge and a dashboard banner show what is due; one tap opens WhatsApp with the message ready. See below. |
| **One JSON data file** | Every supplier with its own list of fragrances (the same fragrance from two suppliers is listed under each, separately), plus customers, invoices and settings, in one `amf-data.json`. Add more than four suppliers in Settings. In Chrome, Edge or Opera the app can save to that file automatically. See below. |
| **Backups** | **Export backup** downloads a JSON file; **Import backup** restores it (it replaces the current data after a confirmation). |
| **Settings** | Shop details, logo (large images are shrunk automatically), supplier names, light/dark theme. |

Keyboard: `Esc` closes any dialog.

## Keeping new fragrances permanently: the data file

By default the app stores everything in **browser storage**. That storage belongs to one exact address and
profile, so it can look "lost" when you open the app from a different folder, port or host (`localhost` vs
`127.0.0.1`), in a private window, in another browser, or after the browser clears site data. A normal or
hard refresh does not remove it. To be independent of all that, keep a real file:

1. **Settings -> Data file & backups -> Create a data file...** (Chrome, Edge or Opera). Pick where to keep
   `amf-data.json`. From then on every change is written to that file within a moment.
2. If the browser's storage is ever wiped, the app reloads the data from the file by itself. If the remembered
   link is wiped too, use **Open an existing data file...**. A browser restart may ask you to click **Reconnect**
   once (the browser re-asks for permission); until then changes are still saved in the browser.
3. Other browsers (Firefox, Safari) cannot write files automatically: use **Download data file** regularly and
   **Import a data file...** to restore.

The file is organised by supplier, so new entries always appear under the supplier they were added to:

```json
{
  "format": "amf-data", "formatVersion": 3, "kind": "full", "savedAt": "2026-11-23T10:15:00.000Z",
  "suppliers": [
    { "id": "arabian",   "name": "Arabian Perfumery", "note": "Made in Spain",
      "fragrances": [ { "id": "arabian-29", "name": "Janan sports ...", "code": "271062", "serial": "AR-029",
                        "priceKg": 60000, "perGram": 60, "price25g": 1500, "price100g": 6000 } ] },
    { "id": "company-2", "name": "Al Khaleej", "note": "...",
      "fragrances": [ { "id": "company-2-...", "name": "Janan sports ...", "priceKg": 55000, "serial": "AL-001" } ] }
  ],
  "settings": {}, "customers": [], "orders": []
}
```

- **Add suppliers** under Settings -> Add a supplier. Each keeps its own fragrances.
- **Download catalog only** writes the same file without customers, invoices and settings. Importing a catalog
  file replaces the catalogs and keeps your customers and invoices.
- Older backups (flat format) can still be imported.

### Make new fragrances part of the project (for GitHub)

Download **catalog only**, save it as `data/amf-data.json` inside the project, and commit it. Any browser that
opens the app over http(s) (including GitHub Pages) with no saved data starts from that catalog. Files that
contain customers or invoices are refused there on purpose. Keep your private full data file out of the
repository; the `.gitignore` already skips `/amf-data*.json` at the project root, so you can keep your linked
file there.

## WhatsApp: how it works (and what it cannot do)

The app opens WhatsApp (app or web) with the number and the message already filled in; **you press Send**.
It cannot send messages by itself: a page that is closed cannot run, and fully automatic WhatsApp messages
need the paid WhatsApp Business API plus a small server, which would also move your customers' data off
this device. So "automatic" here means *the app tells you who to remind and when*.

- Numbers are cleaned up for you: `0300-1234567`, `+92 300 1234567` and `3001234567` all become `+92 300 1234567`.
  Change the default country code in **Settings -> Payment reminders**.
- Each reminder you open is logged on the invoice (shown as "N reminders sent, last ..."). Use **Tomorrow** to
  postpone, or **Stop** for a customer who promised a date.
- The schedule, repeat interval and message text (with `{name}`, `{invoice}`, `{amount}`, `{total}`, `{paid}`,
  `{date}`, `{days}`, `{shop}`) are editable in Settings.
- Very long lists do not fit in one WhatsApp link; the app tells you, and you can use **Copy text** or the PDF.

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
data/amf-data.json    optional catalog-only file that new browsers start from
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
