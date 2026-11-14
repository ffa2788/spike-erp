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

Amazon is a file import. It does not call Amazon. A full 16-section safety data sheet is not generated; the label prints the hazard text stored on the product. There is no toll-manufacturing module, no credit note, no landed-cost proration, and no outbound email.

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
