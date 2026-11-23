# Changelog

## 1.1.0

### Added
- **Price auto-fill:** typing the price per kg fills price per gram, per 25 g and per 100 g (kg / 1000, kg / 40,
  kg / 10). Fractional prices are accepted by the browser.
- **Share a customised list:** choose fragrances (search, filter by supplier, select all shown), choose which
  details to include, pick a customer, edit the message, then send on WhatsApp, copy, or print / save as PDF.
  Fragrance names are used exactly as stored. Your chosen details are remembered.
- **WhatsApp payment reminders:** schedule (default day 1, 2, 7, then every 7 days), Reminders page, sidebar badge,
  dashboard banner, snooze until tomorrow, stop / resume per invoice, per-invoice **Remind** button, editable
  message, phone-number normalisation with a configurable country code. Every opened reminder is logged.

## 1.0.0

### Fixed
- **Add / Edit fragrance did nothing.** A hidden form field named `id` shadows `form.id` in browsers, so the
  form was never recognised on submit. Forms are now identified with `getAttribute('id')`.
- Duplicate invoice numbers after deleting an invoice.
- Invoices could not be edited after one of their fragrances was removed from the catalog.
- Failed saves (storage full or blocked) were silent and threw errors; now reported. Oversized logos can no
  longer break saving.
- Several tabs could overwrite each other's data; the app now refreshes when another tab saves.
- Customer search never hid non-matching cards (CSS `display` overrode the `hidden` attribute).
- Invoice dialog overflowed horizontally and clipped its fields; conflicting mobile rules removed.
- Serial placeholder did not match the saved serial; duplicate serials are rejected.
- Changing price/kg left the per-gram, 25 g and 100 g prices stale; float noise (`909.0000000000001`) removed.
- Printing happened before the logo loaded; Excel export garbled Urdu (added UTF-8 BOM); downloads revoked too early.
- Typing in an invoice line's search cleared the chosen fragrance.
- A bad catalog link could create products under a supplier that does not exist.
- Renamed suppliers kept their old avatar initial; names are trimmed; greeting always said "Good evening".
- Two catalog rows (peach, David Beckam) shared the serial `AR-14/15`; they are now `AR-014A` / `AR-014B`.

### Added
- Import backup (restore), with validation and confirmation.
- Edit and delete customers.
- Remove invoice lines; the price field shows the fragrance's default price.
- Stock can be "not set", "out of stock" (0) or a count.
- Overpayment is refused instead of silently capped.
- Uploaded logos are shrunk before being stored; bundled `logo.jpg` reduced from 527 KB to 25 KB.
- `Esc` closes dialogs; dialogs focus their first field.
- Dark theme: gold primary buttons and a readable danger button.
- Favicon, automated tests, CI, versioned data migration.
