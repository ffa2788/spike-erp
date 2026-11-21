-- A company stays one Party row. isCustomer and isVendor can both be true.
-- Existing rows are left as they are.
COMMENT ON COLUMN "Party"."isCustomer" IS 'True when this company buys from SPER. May also be a vendor.';
COMMENT ON COLUMN "Party"."isVendor" IS 'True when this company sells to SPER. May also be a customer.';
