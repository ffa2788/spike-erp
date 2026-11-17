# Amazon reports

SPIKE does not use the Selling Partner API. Chris does not type Amazon orders. The SPIKE bot signs into Seller Central, downloads the reports, and posts them.

The customer on every A- invoice is the Amazon channel customer (name it Amazon Customer). Buyer names and buyer IDs are not stored. FBA and FBM stay on separate A- invoices.

## What to download

In Seller Central, Reports:

1. **All Orders**. Request a date range, tab-delimited. This creates the A- invoices for shipped lines and lists unmapped SKUs.
2. **Payments — Date Range Transaction**. CSV. This posts referral fees, FBA fees, shipping labels, storage, refunds, reimbursements, and the payout to the bank. The same transaction uploaded twice is kept once.
3. **Settlement flat file** (optional if you already upload the payments file). Tab-separated, one amount per row. It posts the same way.

Upload one or two files a week. A month of orders is fine in one All Orders file.

## In SPIKE

Sales → Amazon. Three upload boxes: All Orders, Payments date range, Settlement flat file. The summary line is the count of invoices, refunds, fees, and the deposit. Unmapped SKUs stay in **Exceptions** until you pick the SPIKE product.

## The bot

Create a key in Settings → Integrations. It needs the `sales` scope to post and `read` to fetch the cross-check.

```bash
curl -X POST https://YOUR-HOST/api/amazon/import \
  -H "Authorization: Bearer spike_..." \
  -F "orders=@all-orders.txt" \
  -F "payments=@payments.csv" \
  -F "settlement=@settlement.txt"
```

One file at a time also works: `-F "kind=orders" -F "file=@all-orders.txt"` (`orders`, `payments`, `settlement`, or `fba`).

The response is the summary: invoices created, refunds, fees, and the deposit. Uploading the same file again does not create a second invoice or a second deposit.

Cross-check a month or a settlement id:

```bash
curl -H "Authorization: Bearer spike_..." \
  "https://YOUR-HOST/api/amazon/reconciliation?period=2026-11"

curl -H "Authorization: Bearer spike_..." \
  "https://YOUR-HOST/api/amazon/reconciliation?period=2026-11&format=pdf" \
  -o amazon-2026-11.pdf
```

The JSON lists orders, invoices, gross sales, fees, refunds, reimbursements, the expected payout, the bank deposit, and any difference: missing order, duplicate, unmapped SKU, fee mismatch, or a payout that does not match the deposit.

## Selling Partner API

Left in the code and switched off (`AMAZON_SP_API_ENABLED` is false). Do not register a developer app for this. If that changes later, the environment names are `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`, `AMAZON_REFRESH_TOKEN`, `AMAZON_SELLER_ID`, `AMAZON_MARKETPLACE_ID`, `AMAZON_AWS_ACCESS_KEY_ID`, and `AMAZON_AWS_SECRET_ACCESS_KEY`. None of those belong in the repo.
