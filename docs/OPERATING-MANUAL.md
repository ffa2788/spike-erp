# SPIKE operating manual

This is how SPER Chemical runs the day in SPIKE. Short steps. If a step is not here, ask FFA before you invent one.

## Who does what {#who-does-what}

### FFA {#ffa}

FFA owns the company and is the only person who can change this manual.

1. Research, formulas, and what we are willing to sell.
2. Customer calls that need a judgment: a new price, a complaint, or a credit.
3. Approve anything the bot is not allowed to finish. The list is in [What the SPIKE bot may do](#bot-permissions).
4. Sign off on payroll numbers and on tax filings. SPIKE prepares worksheets. It does not file them.

### Chris {#chris}

Chris runs the office.

1. Amazon week: reports, assemblies, and the Truist deposit.
2. Direct invoices (S-), export invoices (E-), and Walmart invoices (W-).
3. Purchase orders, receiving, and supplier bills.
4. Customer payments.
5. Release the weekly plan so Trevor gets it by email.

### Trevor {#trevor}

Trevor runs manufacturing. He has no login.

1. He gets one email each week: the production plan, with the batches, the materials, and the packaging.
2. He makes what that sheet says. He does not enter orders or invoices.

### SPIKE bot {#spike-bot}

The bot does the routine work through the API. It can read this manual. It cannot change it.

1. It searches, drafts quotes, creates invoices from orders that are already confirmed, imports Amazon reports, matches a deposit that agrees to the cent, releases Trevor's plan, and drafts emails.
2. It stops and asks when the work is on the approval list.
3. It answers Help requests from this manual. If the manual does not cover it, it tells FFA.

## Chris's daily and weekly work {#chris-routines}

Do Amazon week first. Then the other sales. Then money that arrived, and bills that are due. Release Trevor's plan once a week, before he needs it.

### Amazon week {#amazon-week}

Open Sales, then Amazon week.

1. Upload the Seller Central reports on Sales, Amazon, or let the SPIKE bot post them with the API. Use All Orders, the payments file, and the settlement file.
2. Check the counts. Orders imported and invoices created should agree. FBA and FBM are both A- invoices. Unmapped SKUs are listed under Exceptions. Fix the SKU map before you call the week done.
3. If finished goods were short, SPIKE posts an assembly. Press Confirm the assemblies when the list looks right.
4. Match the Truist deposit. Pick the bank line that equals the deposit to the penny. If nothing matches, stop and follow [The deposit does not match](#deposit-mismatch).

### Direct orders (S-) {#direct-orders}

Open Sales.

1. Make a quote. Use a real price. Add the shipping term, the named place, and the credit term.
2. Accept the quote. That creates the order.
3. Ship it when it leaves Clearwater.
4. Create the invoice. The number starts with S-. That is when the sale hits the books.
5. Record the payment when the money arrives. See [Record a customer payment](#record-a-payment).

### Exports (E-) {#exports}

Same path as a direct order, with the customer set as export.

1. Quote, accept, ship, then invoice.
2. The invoice number starts with E-.
3. Print the commercial invoice, the packing list, and the certificate of origin from the invoice.
4. Do not charge US sales tax on an export.

### Walmart (W-) {#walmart}

1. Import the Walmart file, or let the connection pull orders when it is turned on.
2. Each Walmart order becomes an invoice that starts with W-.
3. The Walmart order id stays on the invoice. Do not retype it onto an S- invoice.

### Receive a purchase order {#receive-a-po}

Open Purchasing.

1. The purchase order is already sent, with a real price.
2. Receive the goods against that purchase order. Do not type a second order.
3. The new lot waits for quality. It is not ready to sell or to make with until it is released.
4. Enter the supplier's bill only for what was received.

### Pay a supplier bill {#pay-a-bill}

Open Purchasing, then Bills. Or Money, if you are in the bank.

1. Open the bill that matches the supplier invoice.
2. Pay the open amount. Do not pay a bill that has no receipt behind it.
3. The payment shows on the bank match later. Match it to the Truist line.

### Record a customer payment {#record-a-payment}

Open the invoice, or Money.

1. Find the invoice by its number: S-, A-, W-, or E-.
2. Enter the amount that arrived and the date.
3. If the terms offer an early-payment discount, SPIKE shows the lower amount. Take it only when this payment finishes the invoice inside the window.
4. A partial payment does not earn the discount.

### Release Trevor's weekly plan {#release-trevor}

Open Inventory, then the production plan.

1. Read the week. Lowest days of cover come first.
2. Check the short materials. Order what is missing before you promise the batch.
3. Press Release to Trevor. He is emailed the plan. He is not given a login.
4. If his email is missing, set it in Settings, Company, then release again.

### Low-stock alerts {#low-stock}

1. Home shows items that are low or critical. Inventory, Coverage, has the same list.
2. SPIKE emails the alert list when mail is configured. The seeded address is marlon@novachem.hn. Change it per product if a different buyer should hear about that item.
3. A low raw material means a purchase. A low finished good means a batch or a purchase, depending on the product path.
4. One email goes out when the status changes. Do not send a second one by hand the same day.

## Product rules {#product-rules}

### Package sizes {#package-sizes}

Liquids: 0.5 gal, 1 gal, 2.5 gal, 35 gal drum, 55 gal drum, 255 gal tote, 265 gal tote.

Powders: 25 kg bag, 50 lb bag, and a 1 lb jar.

The formula is entered in pounds. SPIKE turns that into a percent and a cost per pound and per gallon. Packaging (bottle, cap, label, carton, and the rest) is separate and is used when you pack.

### NSF mark {#nsf}

1. Put the NSF/ANSI/CAN 60 mark only on a product that is linked to a trade name on NSF's public listing for SPER.
2. PolyPhos Beads is listed. Rust Preventer is not. Do not add the mark to Rust Preventer.
3. If you are not sure, leave the mark off and ask FFA.

### Invoice numbers {#invoice-numbers}

1. S- is a direct sale.
2. A- is Amazon, both FBA and FBM.
3. W- is Walmart.
4. E- is export.
5. The number is permanent. A void keeps the number. Nothing is deleted.

### Discounts {#discounts}

Allowed discounts:

1. A line discount, as a percent or a dollar amount.
2. A discount on the whole quote, as a percent or a dollar amount.
3. A customer price level, when that customer has one on file.
4. A volume break, when the quantity earns it.
5. An early-payment term such as 2/10 Net 30. It applies only if they pay the rest inside the window.

A new price, or a discount that is not one of these, needs FFA. The bot must not change a price on its own.

### Shipping terms and credit terms {#terms}

1. Every quote names an Incoterms 2020 term and a place. EXW, FCA, FOB, CFR, CIF, CPT, CIP, DAP, DPU, or DDP.
2. Charge freight only when the term says SPER pays freight. Charge insurance only when the term says SPER insures the goods.
3. Credit terms are Prepaid, COD, Net 15, Net 30, Net 45, Net 60, or a custom net. The terms copy from the quote to the order and the invoice.

## What the SPIKE bot may do {#bot-permissions}

The bot reads this manual with GET /api/v1/manual. It cannot change it.

| The bot | What |
| --- | --- |
| Can do alone | Search. Draft a quote. Create an invoice from an order that is already confirmed. Import Amazon reports. Match a deposit that agrees to the cent. Release Trevor's plan. Draft an email. |
| Needs FFA approval | Sending any customer email. Credits. Refunds. Write-offs. Price or discount changes. Deleting anything. Payroll. Tax filings. |
| Never | Share account info unless the sender's email matches the customer record on file. If it does not match, stop and hand it to FFA. |

A draft email is not sent until a person confirms it. Customer mail, credits, refunds, write-offs, price changes, deletes, payroll, and tax filings wait for FFA.

## Rollout {#rollout}

1. Week 1. SPIKE observes. The bot reads, searches, and drafts. Chris and FFA still post the work. Nothing goes to a customer.
2. Week 2. SPIKE proposes. The bot prepares the quote, the invoice, the Amazon import, and the deposit match. Chris or FFA approve before it is final.
3. Week 3. SPIKE runs the routine work on the "can do alone" list. Anything else, and anything that looks wrong, is escalated to FFA.

## If something looks wrong {#when-wrong}

Stop. Do not delete the record to hide it. Write a Help request from the Help button if you are not sure.

### The deposit does not match {#deposit-mismatch}

1. Do not force a match.
2. Compare the settlement net with the Truist line. Fees, refunds, and labels belong on their own accounts, not inside the deposit.
3. If the cents differ, leave it unmatched and tell FFA. The bot may match a deposit only when it agrees to the cent.

### Stock went negative {#negative-stock}

1. Stop shipping that item.
2. Check the lot. A sale may have shipped before the batch was released, or a report may have sold units that are still at Amazon.
3. Tell FFA. Do not type a fake receipt to cover the hole.

### A report will not upload {#upload-error}

1. Read the error on the screen. Upload the same file only after you know why it failed.
2. The same file twice does not post twice. A cancelled Amazon row is not a sale.
3. If the file is the right report and it still fails, send a Help request and attach a picture of the error.

### The invoice is wrong {#wrong-invoice}

1. Void it. The number stays on file.
2. Reissue a new invoice with the next number.
3. Never delete an invoice, a payment, or a quote.

### Who to contact {#who-to-call}

1. Office work, Amazon week, and a stuck screen: use Help. The bot answers from this manual when it can.
2. A price, a credit, a refund, a write-off, payroll, or a tax question: FFA.
3. What to make this week: Trevor gets the plan by email. He does not need a call unless the sheet itself is wrong. If the sheet is wrong, FFA releases a correction.
4. A low raw-material alert that is already emailed: marlon@novachem.hn is the buyer on the seeded list. Change the recipient in the product if that is no longer right.
