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
3. Import the opening trial balance. It must balance. One line must be account `3900` Opening balances, for the amount that makes debits equal credits. SPIKE posts this as one journal. A second import does nothing.
4. Import the stock count. Lot Number can be blank. SPIKE then uses `OPEN-` plus the item ID. The extended cost of the count must equal the inventory accounts on the trial balance (1200, 1210, and 1240 together).
5. Import open invoices. The total must equal account 1100.
6. Import open bills. The total must equal account 2000.
7. Open Today. It must say the books agree. Spot-check one customer balance and one item quantity against Peachtree.
8. Sign in is email and password. An authenticator code is asked only when `REQUIRE_2FA` is `true`.

New invoices after cutover are `S-`, `A-`, `W-`, and `E-` with six digits. Keep Peachtree's own invoice and bill numbers on the opening rows. Do not reuse those numbers for a new SPIKE invoice.

## After the first sale

Quote, accept, ship, invoice, and take the payment in SPIKE. Import the Amazon All Orders file when it arrives. Importing that same file again does not create a second invoice. Match the Amazon deposit to the bank line from Money, Bank.
