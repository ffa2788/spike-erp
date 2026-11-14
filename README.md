# SPIKE

SPIKE (Sales, Planning, Inventory and Knowledge Engine) is the operations and accounting app for SPER Chemical, a water-treatment phosphates manufacturer in Clearwater, Florida. It is written for a partner who is moving off Sage Peachtree 2011: large type, plain English, and one set of numbers.

SPIKE is original software. Other chemical and apparel systems were used only as a functional reference.

## What you can do

- Customers and suppliers, with one record per name
- One product list for raw materials, finished goods, and utilities that are not stored
- Formulas, including a finished product used inside another product, with a cost that rolls all the way up or is marked unusable
- Inventory by lot, location, and quality status
- Purchasing: purchase order, receipt, supplier bill, payment
- Sales: quote, order, delivery note, invoice, payment
- Production batches, quality release, and lot genealogy in both directions
- Printable GHS-style product, drum, and tote labels, and an NSF/ANSI 60 lot certificate
- Planning: open orders versus ready stock versus open purchase orders, with a buy suggestion
- Florida-style sales tax by state and locality, plus exemption certificates
- Double-entry books: chart of accounts, journal, receivables, payables, profit, and balance sheet
- Bank reconciliation from a CSV statement
- Peachtree 2011 CSV import with a preview that skips bad rows
- Sign-in with a password and an authenticator code, four roles, and a change history
- Tax Center: Florida DR-15 worksheet, 1099 totals with W-9 tracking, a year-end package mapped to Form 1120 or 1120-S, and plain-English savings ideas that cite the code section and tell you to confirm them with your CPA

Amazon uses the Selling Partner API when credentials are set, and a CSV import when they are not. Technical data sheets and 16-section safety data sheets are drafts until a qualified person publishes them. There is no toll-manufacturing module, no credit note, and no outbound email.

## Amazon Selling Partner API

On the Amazon page, SPIKE shows **Not connected** until all of these are set. It does not invent orders or inventory.

1. In Seller Central, open Develop Apps and register a private app for this seller.
2. Request the roles Inventory and Order Tracking, Amazon Fulfillment, and Finance and Accounting.
3. Authorize the app. Amazon gives you a Login with Amazon refresh token, plus the client id and client secret from the app.
4. Create an IAM user that can call Selling Partner API and copy its access key and secret. Requests are signed with those keys.
5. Set the variables and redeploy:

```
AMAZON_LWA_CLIENT_ID=
AMAZON_LWA_CLIENT_SECRET=
AMAZON_REFRESH_TOKEN=
AMAZON_SELLER_ID=
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER
AMAZON_AWS_ACCESS_KEY_ID=
AMAZON_AWS_SECRET_ACCESS_KEY=
```

`ATVPDKIKX0DER` is the United States marketplace. Pull orders only after the page says connected. Settlement fees are read from Amazon's own reports. The CSV import under Bring in data still works when Amazon is not connected.

## NSF/ANSI/CAN 60

The NSF page stores the trade names and maximum use levels read from NSF's public listing for SPER Chemical (company 42880) on 14 November 2026. The mark is shown on labels, certificates, technical data sheets, and safety data sheets only when a product is linked to one of those trade names. PolyPhos Beads is linked in the example data. Rust Preventer is not. Check https://info.nsf.org/Certified/PwsChemicals/Listings.asp?Company=42880 if NSF changes the list, then update the link. SPIKE does not copy NSF's logo artwork.

## Example sign-in

The seed loads example people, customers, prices, and certificates. They are not real. Change them before any real books.

Password for every example user: `example-only-change-me`

| Email | Role | Authenticator secret |
| --- | --- | --- |
| frank@sper.example | Owner | `KWF3ZPUGGKC66FWSLJRYUW4HCPEZZJBC` |
| partner@sper.example | Partner / accounting | `LF2XI7OMRHPZRQPRLIJDFC3PBKWIPM7O` |
| warehouse@sper.example | Warehouse | `35HHBJMQDFOXMDSFGM5NNM7Y5EGAJUH5` |
| readonly@sper.example | Read only | `7KPYKR3E24UGXPZSUKG7H62Q3XIF3UTR` |

Add the secret in an authenticator app (issuer SPIKE). The app will ask for the 6-digit code after the password.

## Run it locally

You need Node 22 and PostgreSQL.

```bash
cp .env.example .env
# Set DATABASE_URL and a long AUTH_SECRET.
npm install
npx prisma migrate deploy
ALLOW_SEED=yes npm run seed
npm run dev
```

Open http://localhost:3000.

`npm run seed` wipes that database and loads the example company. It refuses to run unless `ALLOW_SEED=yes` and the database name contains `spike`.

## Tests

```bash
npm test
```

Domain tests cover recipe roll-up, the NSF ship gate, sales tax, balanced journals, the balance-sheet equation, lot relief, planning, aging, bank matching, Peachtree validation, and roles. They do not need a database.

```bash
npm run test:integration
```

The integration test loads the example company into `DATABASE_URL` (see `.env.test`) and checks that invoices, bills, lots, and the journal agree, that the Rust Preventer cost includes the PolyPhos sub-recipe, and that a quarantine lot cannot ship. It then matches the example bank statement.

## Deploy to Vercel

Use Neon or Supabase for Postgres. Put the direct (non-pooled) connection string in `DATABASE_URL`. Pooled connections often fail during migrations.

In the Vercel project settings:

- `DATABASE_URL` — Postgres connection string
- `AUTH_SECRET` — a long random string, at least 32 characters
- Do not set `ALLOW_SEED` on production

The build command is `prisma generate && prisma migrate deploy && next build`. The first deploy creates the tables. Create the first owner in the database, or run the seed once against a throwaway database and then replace the example users.

After the books are real, turn off the yellow example banner in the `CompanyProfile` row (`showExampleBanner = false`) and delete the example users.

## Backups

The database is the system of record. There are no uploaded files to back up in v1.

- Turn on the host’s daily backups (Neon point-in-time recovery, or Supabase daily backups).
- Once a week, take your own copy:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=spike-$(date +%F).dump
```

- Store that file somewhere other than the database host.
- Practice a restore before you go live:

```bash
pg_restore --clean --no-owner --dbname="$DATABASE_URL" spike-YYYY-MM-DD.dump
```

A backup that has never been restored is not a backup yet.

## How the numbers stay honest

- Selling prices of zero or a bare $1.00 are rejected unless someone explicitly says one dollar is the real price.
- A product name or SKU cannot be saved twice.
- Recipe cost walks into sub-recipes. If any ingredient has no cost, the parent cost is blank. A partial total is never shown.
- Utilities record consumption and do not keep a second on-hand balance.
- New receipts and new finished lots start in quarantine. Only released, unexpired lots can ship or be consumed.
- An NSF/ANSI 60 product ships only when the certificate is current and the lot used the certified formula version.
- Inventory value is the sum of lot quantities times lot cost. The same sum is posted to the journal. The Today page says so when they disagree.
- Profit and the balance sheet are calculated only from posted journal lines.
