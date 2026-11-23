# Go live from Peachtree

Do this on the cutover morning, after the last Peachtree entry and before anyone sells in SPIKE. Use Settings, Import. Every file shows a preview. Bad rows are named and are not saved. Importing the same file again does not create a second copy.

The opening trial balance is the general ledger. The stock count, open invoices, and open bills are the detail behind inventory, accounts receivable, and accounts payable. Those detail files do not post a second journal. After all four are in, Today must say the books agree. If it does not, the detail total does not match the account on the trial balance. Fix the file and import only the rows that were not saved.

## What Chris exports from Sage 50 US

| What SPIKE uses it for | Sage 50 menu | Columns SPIKE expects | Template |
| --- | --- | --- | --- |
| Customers | File > Select Import/Export > Accounts Receivable > Customer List > Export | Customer ID, Customer Name, Contact, E-mail, Telephone 1, Bill to Address-Line One, Bill to City, Bill to State, Bill to Zip | `/examples/peachtree-customers.csv` |
| Suppliers | File > Select Import/Export > Accounts Payable > Vendor List > Export | Vendor ID, Vendor Name, and the same address columns | `/examples/peachtree-customers.csv` with Vendor ID and Vendor Name |
| Chart of accounts | File > Select Import/Export > General Ledger > Chart of Accounts List > Export | Account ID, Account Description, Account Type | Use the chart already in SPIKE, then add only accounts that are missing |
| Items | File > Select Import/Export > Inventory > Inventory Item List > Export | Item ID, Item Description, Item Class, Sales Price, Cost, Unit | `/examples/peachtree-items.csv` |
| Starting quantities and cost | Reports & Forms > Inventory > Inventory Valuation. Export or retype the count. | Item ID, Quantity, Unit Cost, Lot Number | `/examples/peachtree-stock.csv` |
| Open customer invoices | Reports & Forms > Accounts Receivable > Aged Receivables, detail, open only. Or File > Select Import/Export > Accounts Receivable > Sales Journal > Export, then keep the open invoices. | Customer ID, Invoice Number, Date, Due Date, Amount, Description | `/examples/peachtree-ar.csv` |
| Open vendor bills | Reports & Forms > Accounts Payable > Aged Payables, detail, open only. Or File > Select Import/Export > Accounts Payable > Purchase Journal > Export, then keep the open bills. | Vendor ID, Bill Number, Date, Due Date, Amount, Description | `/examples/peachtree-ap.csv` |
| Opening trial balance | Reports & Forms > General Ledger > General Ledger Trial Balance, as of the cutover date | Account ID, Debit, Credit | `/examples/peachtree-trial.csv` |
| Formulas | Peachtree does not store these. Type them once. | Finished SKU, Ingredient SKU, Percent | `/examples/peachtree-formula.csv` |
| Packaging lists | Peachtree does not store these. Type them once. | Finished SKU, Bulk SKU, Package, Units per case, Cases per pallet, Packaging SKU, Qty, Basis | `/examples/peachtree-bom.csv` |

In Sage 50 the export layout can be changed. Add the columns above before you export. Dates can be `11/01/2026` or `2026-11-01`. Money can be `100.00`.

## Order

1. Import customers, then suppliers, then items, then any missing accounts.
2. Import formulas, then packaging lists.
3. Import the opening trial balance. Set the as-of date to the cutover day (October 31, 2026 for this load). If the file has a line such as `As of October 31, 2026` above the column headers, SPIKE fills that date in. Otherwise type it. A future date is rejected. The trial balance must balance. One line must be account `3900` Opening balances, for the amount that makes debits equal credits. SPIKE posts this as one journal on the as-of date. A second import does nothing.
4. Import the stock count with the same as-of date. Lot Number can be blank. SPIKE then uses `OPEN-` plus the item ID. The lot, its receipt, and the inventory movement use that date. The extended cost of the count must equal the inventory accounts on the trial balance (1200, 1210, and 1240 together).
5. Import open invoices. The total must equal account 1100.
6. Import open bills. The total must equal account 2000.
7. Open Today. It must say the books agree. Spot-check one customer balance and one item quantity against Peachtree.
8. Sign in is email and password. An authenticator code is asked only when `REQUIRE_2FA` is `true`.

New invoices after cutover are `S-`, `A-`, `W-`, and `E-` with six digits. Keep Peachtree's own invoice and bill numbers on the opening rows. Do not reuse those numbers for a new SPIKE invoice.

## Move the November 23 opening dates back to October 31

The first production import posted the opening trial balance and the opening stock count on the day of the import. Open invoices and bills already had October 31. This script changes only those dates. It does not change amounts, journal lines, or quantities.

Run it on your own machine, with `DATABASE_URL` and `DIRECT_URL` set to the database. Do not put the connection string in the command.

```
npx tsx scripts/redate-opening.ts
npx tsx scripts/redate-opening.ts --apply
```

The first command prints each journal, lot, and movement: id, current date, and October 31, 2026, plus the totals before and after. Nothing is written. `--apply` writes the dates in one transaction.

It finds the opening trial by source `OPENING` and source id `TRIAL`, and the opening stock by origin `OPENING` and the note `Opening count.` It does not pick rows just because they are dated November 23. Running it again after a successful apply changes nothing.

It refuses, and writes nothing, when the opening trial is not $852,443.20 and balanced, opening stock is not $185,435.37, or these opening-journal balances differ: 1100 $336,087.58 Dr, 2000 $24,286.77 Cr, 1991 $17,026.16 Cr, 1992 $9,475.49 Dr, 1993 $1,400.34 Dr. It also refuses when `BOOKS_CLOSED_THROUGH` is set to a `YYYY-MM-DD` and an opening row, or October 31, falls on or before that day. Leave `BOOKS_CLOSED_THROUGH` unset unless the books are closed through a date. SPIKE does not store a closed period itself.

After `--apply`, the script prints the October 31 balance-sheet totals for those accounts and whether the books agree.

## After the first sale

Quote, accept, ship, invoice, and take the payment in SPIKE. Import the Amazon All Orders file when it arrives. Importing that same file again does not create a second invoice. Match the Amazon deposit to the bank line from Money, Bank.
