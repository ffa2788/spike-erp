# SPIKE bot

The bot calls SPIKE with an API key. Create it under Settings → Integrations. The notice shows the key once. SPIKE stores only the hash. Every call is an audit row named SPIKE bot.

```
Authorization: Bearer spike_...
```

Amazon reports, which replace typing those orders:

- `POST /api/amazon/import` multipart fields `orders`, `payments`, `settlement`, and `fba`. Or one file with `kind` and `file`. Needs the `sales` scope.
- `GET /api/amazon/reconciliation?period=2026-11` JSON. Add `format=pdf` for the PDF. Needs a valid key.

The rest of the operation is under `/api/v1`. The list is `GET /api/openapi.json`. That includes customers, products, inventory, coverage, quotes, orders, shipments, invoices, payments, purchase orders, the production plan, dashboard alerts, and draft emails. A customer email is a draft until `POST /api/v1/messages/{id}/confirm`. Nothing is delivered until email is configured.

See `docs/AMAZON-SETUP.md` for the Seller Central files.
