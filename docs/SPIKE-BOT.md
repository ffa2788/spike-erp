# SPIKE bot

The bot calls SPIKE with an API key. Create it under Settings → Integrations. The notice shows the key once. SPIKE stores only the hash. Every call is an audit row named SPIKE bot.

```
Authorization: Bearer spike_...
```

Scopes are `read`, `sales`, `purchasing`, `planning`, and `money`. A GET needs `read`. Posting a quote, an order, a shipment, an invoice, or an Amazon report needs `sales`. A purchase order needs `purchasing`. Releasing the week to Trevor needs `planning`. A customer payment needs `money`.

Nothing is delivered until email is configured. A customer email is a draft until you confirm it.

The operating manual says what the bot may do alone, what needs FFA, and what it must never do. Read it with `GET /api/v1/manual`. There is no call that changes the manual. Only the owner can edit it in Settings, Manual.

Help requests from the Help button:

- `GET /api/v1/help-requests?status=open`
- `POST /api/v1/help-requests/{id}/answer` with `{ "answer": "..." }`

The answer shows in that person's Help panel, with a badge on the Help button. Opening a request emails FFA, or logs the email if mail is not configured. Both calls are audit rows.

## Amazon reports

- `POST /api/amazon/import` multipart fields `orders`, `payments`, `settlement`, and `fba`. Or one file with `kind` and `file`.
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
- `GET /api/v1/help-requests?status=open`
- `POST /api/v1/help-requests/{id}/answer`
