# SPIKE bot

The bot calls SPIKE with an API key. Create it under Settings → Integrations. The notice shows the key once. SPIKE stores only the hash. Every call is an audit row named SPIKE bot.

```
Authorization: Bearer spike_...
```

Scopes are `read`, `sales`, `purchasing`, `planning`, `money`, and `import`. A GET needs `read`. Posting a quote, an order, a shipment, an invoice, or an Amazon report needs `sales`. A purchase order needs `purchasing`. Releasing the week to Trevor needs `planning`. A customer payment needs `money`. A cutover import needs `sales` or `import`. A key that already has `sales` can import. New keys also get `import`.

Nothing is delivered until email is configured. A customer email is a draft until you confirm it.

The operating manual says what the bot may do alone, what needs FFA, and what it must never do. Read it with `GET /api/v1/manual`. There is no call that changes the manual. Only the owner can edit it in Settings, Manual.

Help requests from the Help button:

- `GET /api/v1/help-requests?status=open`
- `POST /api/v1/help-requests/{id}/answer` with `{ "answer": "..." }`

The answer shows in that person's Help panel, with a badge on the Help button. Opening a request emails FFA, or logs the email if mail is not configured. Both calls are audit rows.

## Cutover import

`POST /api/v1/imports` takes multipart field `files` (one or more CSV or XLSX files). Add `dryRun=true` as a form field or query to preview without saving. SPIKE detects each file from its headers, sorts them in the go-live order, and returns the ready rows, the named errors, and the tie-out checks. For an opening trial balance or stock count, send `asOf` as `YYYY-MM-DD` (or put `As of October 31, 2026` above the column headers). That date is the journal date and the stock lot date. A future date is rejected. Without `dryRun`, it posts each file in its own transaction. Sending the same files again does not create duplicates. The key needs `sales` or `import`.

## Amazon reports

- `POST /api/amazon/import` multipart fields `orders`, `payments`, `settlement`, and `fba`. Or one file with `kind` and `file`. Add `dryRun=true` to see the invoices, the SKUs that still need a mapping, the fees, and the FBA levels. A dry run writes nothing.
- `POST /api/v1/amazon/sku-maps` with `{ "mappings": [{ "amazonSku": "SC-PR1-1-4PK", "productId": "…", "units": 4 }], "dryRun": true }`. `units` is how many of the product are in one Amazon unit, a positive whole number, default 1. The key needs `sales`. Unknown product IDs are rejected and nothing is saved. SPIKE does not invent a product for an unmapped SKU.
- `GET /api/amazon/reconciliation?period=2026-11` JSON. Add `format=pdf` for the PDF.
- `GET /api/amazon/invoices.zip?period=2026-11` the stored A- invoice PDFs for that month.

See `docs/AMAZON-SETUP.md` for the Seller Central files.

## Everything else

`GET /api/openapi.json` is the same list. Paths are under `/api/v1`.

- `GET /api/v1/search?q=` customers, products, invoices, and quotes
- `GET /api/v1/dashboard` cash, what customers owe, what we owe, inventory, and alerts
- `GET /api/v1/customers` and `GET /api/v1/customers/{id}`
- `GET /api/v1/products` and `GET /api/v1/products/{id}`
- `GET /api/v1/inventory`
- `GET /api/v1/coverage`
- `POST /api/v1/quotes` and `PATCH /api/v1/quotes/{id}`
- `GET /api/v1/quotes/{id}` and `GET /api/v1/quotes/{id}/pdf`
- `POST /api/v1/quotes/{id}/order` accept the quote
- `POST /api/v1/orders/{id}/ship`
- `POST /api/v1/orders/{id}/invoice`
- `GET /api/v1/invoices/{id}` and `GET /api/v1/invoices/{id}/pdf`
- `POST /api/v1/purchase-orders` and `GET /api/v1/purchase-orders/{id}/pdf`
- `GET /api/v1/work-lists/{id}/pdf`
- `POST /api/v1/payments`
- `POST /api/v1/production-plans/release`
- `POST /api/v1/messages` draft a quote or invoice email
- `GET /api/v1/messages/{id}`
- `POST /api/v1/messages/{id}/confirm` send it, or log it if mail is not configured
- `GET /api/v1/manual` the operating manual, read only
- `GET /api/v1/alerts/low-stock` items to buy soon, from the last eight weeks of use
- `GET /api/v1/reports/sales?period=month&anchor=2026-10-15` and the same pattern for `products`, `customers`, `mrp`, `profit`, `balance`, and `ar`
- `GET /api/v1/help-requests?status=open`
- `POST /api/v1/help-requests/{id}/answer`
