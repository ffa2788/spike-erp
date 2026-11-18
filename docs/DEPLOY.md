# Deploy SPIKE

Production is the Next.js app on Vercel and Postgres on Neon. The public host is `https://erp.sperchemical.com`.

The Vercel build applies database migrations. It does not load data. The first owner is created by a command you run once from your own machine. That command does not load example customers, products, prices, or transactions. Example data loads only when you set `SEED_EXAMPLE=yes`, and it refuses a hosted database.

Do not commit Seller Central downloads. The Amazon files already in this repository (`tests/fixtures/` and `public/examples/`) are synthetic and labeled that way. A private All Orders report, payments file, or settlement file stays off the git history.

## 1. Neon

1. Create a Neon project and a database. The default name `neondb` is fine.
2. Copy the **pooled** connection string. This is `DATABASE_URL`. The host contains `-pooler`.
3. Copy the **direct** connection string. This is `DIRECT_URL`. The host does not contain `-pooler`.
4. Both strings need `sslmode=require`. Add it if Neon omitted it.
5. Turn on Neon point-in-time recovery (the host’s daily backups).

`DATABASE_URL` is what the running app uses. `DIRECT_URL` is what `prisma migrate deploy` uses. A pooled connection fails many migrations.

## 2. Environment variables

Set these on the Vercel project for the **Production** environment. Leave Preview unset until you point it at a separate Neon branch. Do not set `SEED_EXAMPLE`, `ALLOW_SEED`, or `OWNER_PASSWORD` on Vercel.

| Name | Required | What it is | Example or how to generate |
| --- | --- | --- | --- |
| `DATABASE_URL` | Required | Neon pooled connection string. The running app uses this. | `postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require` |
| `DIRECT_URL` | Required | Neon direct connection string. Migrations use this. Same user and password, host without `-pooler`. Locally, set it to the same value as `DATABASE_URL`. | `postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/neondb?sslmode=require` |
| `AUTH_SECRET` | Required | Signs the session cookie. At least 32 characters. The app refuses to sign a session when it is missing or shorter than 16 characters. | `openssl rand -base64 32` |
| `OWNER_EMAIL` | Required for the first seed only. The running app does not read it. | Email of the owner login created by `npm run seed`. | `frank@sperchemical.com` |
| `OWNER_NAME` | Optional | Name stored on that login. Defaults to `FFA`. | `FFA` |
| `OWNER_PASSWORD` | Optional. Do not set this on Vercel. | When set, and at least 8 characters, the seed uses it and does not write a file. When unset, the seed generates a password. | Leave unset. Use the generated file. |
| `OWNER_PASSWORD_FILE` | Optional. Do not set this on Vercel. | Path for a generated password. Default `owner-initial-password.txt` in the directory where you ran the seed. | `owner-initial-password.txt` |
| `COMPANY_LEGAL_NAME` | Optional | Legal name on the blank company profile. Defaults to `SPER Chemical Corporation`. | `SPER Chemical Corporation` |
| `COMPANY_ADDRESS` | Optional | Street on that profile. Blank until you set the real street. | |
| `COMPANY_CITY` | Optional | City on that profile. Defaults to `Clearwater`. | `Clearwater` |
| `COMPANY_STATE` | Optional | State on that profile. Defaults to `FL`. | `FL` |
| `COMPANY_ZIP` | Optional | ZIP on that profile. | `33755` |
| `COMPANY_PHONE` | Optional | Phone on that profile. | |
| `TREVOR_EMAIL` | Optional | Address stored for Trevor’s production plan. Mail stays log-only until a provider is configured, so a placeholder is enough. | `trevor@sperchemical.com` |
| `SEED_EXAMPLE` | Optional. Leave unset in production. | The exact value `yes` is the only switch that loads example data. Anything else, including unset, seeds the owner only. | Leave unset |
| `ALLOW_SEED` | Optional. Leave unset in production. | The exact value `yes` is also required before example data will wipe a database. | Leave unset |
| `AMAZON_LWA_CLIENT_ID` | Optional | Selling Partner API login client id. The connector stays off. Leave blank. | |
| `AMAZON_LWA_CLIENT_SECRET` | Optional | Selling Partner API client secret. Leave blank. | |
| `AMAZON_REFRESH_TOKEN` | Optional | Selling Partner API refresh token. Leave blank. | |
| `AMAZON_SELLER_ID` | Optional | Amazon seller id. Leave blank. | |
| `AMAZON_MARKETPLACE_ID` | Optional | Marketplace id. The United States id is `ATVPDKIKX0DER`. Leave blank while the connector is off. | |
| `AMAZON_AWS_ACCESS_KEY_ID` | Optional | IAM access key for Selling Partner API request signing. Leave blank. | |
| `AMAZON_AWS_SECRET_ACCESS_KEY` | Optional | IAM secret for that signing. Leave blank. | |
| `WALMART_CLIENT_ID` | Optional | Walmart Marketplace client id. Blank shows “Not connected”. | |
| `WALMART_CLIENT_SECRET` | Optional | Walmart Marketplace client secret. Leave blank. | |
| `SPIKE_EMAIL_FROM` | Optional | From address. Blank keeps mail log-only. | |
| `SPIKE_EMAIL_PROVIDER` | Optional | `resend`, `postmark`, `smtp`, or `ses`. Blank keeps mail log-only. SMTP and SES are recognized and still logged rather than sent. | |
| `RESEND_API_KEY` | Optional | Required only when the provider is `resend`. | |
| `POSTMARK_SERVER_TOKEN` | Optional | Required only when the provider is `postmark`. | |
| `SMTP_HOST` | Optional | Required only when the provider is `smtp`. The send is still logged, not delivered. | |
| `SPIKE_SES_REGION` | Optional | Required only when the provider is `ses`. The send is still logged, not delivered. | |
| `CHROME_PATH` | Optional | Absolute path to Chrome or Chromium for letter PDFs. Vercel does not include Chrome. Leave unset there. The profit and loss screen still works. The PDF route needs a machine where this binary exists. | `/usr/bin/google-chrome` |
| `NODE_ENV` | Set by Vercel. Do not override. | `production` on Vercel. Example data refuses to load when this is `production`. | `production` |

## 3. Vercel project settings

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| Root directory | repository root (leave the default) |
| Node.js version | 22.x |
| Install command | `npm install` (the default; `postinstall` runs `prisma generate`) |
| Build command | `npm run build` |
| Output directory | leave empty (Next.js default) |
| Production branch | `main` |

`npm run build` is `prisma generate && prisma migrate deploy && next build`. `prisma` is a production dependency so the build can migrate even when dev dependencies are omitted. The build needs `DATABASE_URL`, `DIRECT_URL`, and `AUTH_SECRET` in the Production environment, because migrate runs in that build.

After the first successful production deployment:

1. In Vercel, open Settings, Domains, and add `erp.sperchemical.com`.
2. In HostGator DNS for `sperchemical.com`, add a CNAME record: host `erp`, value `cname.vercel-dns.com`.
3. Wait until Vercel shows the domain as valid. HTTPS is issued by Vercel.

## 4. Migrations

Against a fresh database, from a machine that has the repo and the Neon URLs:

```bash
npm install
npm run db:deploy
```

`npm run db:deploy` is `prisma migrate deploy`. It applies every migration in `prisma/migrations` and does not wipe data. The same command runs inside the Vercel build, so a normal deploy also migrates.

Do not use `prisma migrate dev` against Neon. That command is for local migration authoring.

## 5. First owner

Run this once, from your machine, with `DATABASE_URL` set to the Neon **direct** URL for this command (the seed uses the Prisma client, which reads `DATABASE_URL`). Keep `DIRECT_URL` as that same direct URL. Do not set `SEED_EXAMPLE`.

```bash
OWNER_EMAIL="frank@sperchemical.com" \
OWNER_NAME="FFA" \
TREVOR_EMAIL="trevor@sperchemical.com" \
npm run seed
```

What that creates:

- One user, role Owner, authenticator not set up yet.
- A blank company profile with the example banner off.
- The chart of accounts, locations, and number sequences, marked as real rather than example.
- No customers, products, lots, invoices, or payments.

When `OWNER_PASSWORD` is unset, the password is written to `owner-initial-password.txt` in the current directory (mode `0600`). The command prints the file path and does not print the password. Put the password in a password manager, then delete the file. It is listed in `.gitignore`. A second run does nothing if any user already exists.

Sign in at `https://erp.sperchemical.com/login` with that email and password. SPIKE then shows a QR code so the owner can enroll an authenticator. The session is not finished until that code is confirmed.

## 6. Example data

Example data is for a local database only.

```bash
ALLOW_SEED=yes SEED_EXAMPLE=yes npm run seed
```

That wipes the database and loads the labeled example company. It refuses to run unless the database name contains `spike`, `NODE_ENV` is not `production`, and the host is not Neon, Supabase, or Vercel storage.

## 7. Mail

Leave the mail variables blank. Coverage and Trevor’s plan write the email log and do not send. Set a provider later if you want delivery. Trevor’s address can stay the `TREVOR_EMAIL` placeholder until then.

## 8. Backups

Neon point-in-time recovery is the host backup. Once a week, take your own copy and store it somewhere other than Neon:

```bash
pg_dump "$DIRECT_URL" --format=custom --file=spike-$(date +%F).dump
```

Practice a restore before you depend on it. A backup that has never been restored is not a backup yet.
