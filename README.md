# Al Madina Fragrances (AMF)

## Run locally

This is a dependency-free browser app. From the project folder run:

```powershell
python -m http.server 8765
```

Open `http://localhost:8765` in a browser.

## Daily use

- **Catalogs**: switch between all four supplier routes, search by name/code/serial, and add, edit, or remove fragrances.
- **Customers**: create a searchable customer key such as `001-abbas`; each customer has a dedicated account page.
- **Billing**: create one invoice using products from any supplier. The supplier and unique serial are retained per line item.
- **Invoices**: use **Invoice** to open a branded print view and choose “Save as PDF” in the browser print dialog.
- **Excel**: catalog and customer records export as spreadsheet-compatible `.xls` files.
- **Settings**: replace the logo, edit shop details, rename suppliers, and download a JSON backup.

Records persist in the browser's local storage. Export a backup before clearing browser data or moving to another device. The supplied Arabian Perfumery catalog is loaded from `src/data/catalog.js`; the remaining three supplier catalogs start empty and can be populated in the app.
