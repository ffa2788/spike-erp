-- One Amazon unit can be more than one of the product. Existing maps stay at 1.
ALTER TABLE "AmazonSkuMap" ADD COLUMN "units" INTEGER NOT NULL DEFAULT 1;

-- AMAZON-SALES is the Amazon customer. Leave it alone if another customer already has the channel.
UPDATE "Party"
SET channel = 'AMAZON'
WHERE code = 'AMAZON-SALES'
  AND "isCustomer" = true
  AND NOT EXISTS (
    SELECT 1 FROM "Party" other
    WHERE other.channel = 'AMAZON'
      AND other."isCustomer" = true
      AND other.id <> "Party".id
  );

-- SC-PR1-1-2PK is a case of two of the 1 gal Rust Preventer. Skip when that product is not on file.
INSERT INTO "AmazonSkuMap" ("id", "amazonSku", "asin", "productId", "units")
SELECT 'amazon-map-sc-pr1-1-2pk', 'SC-PR1-1-2PK', '', product.id, 2
FROM "Product" product
WHERE product.sku = 'RUST-PREVENTER-1'
  AND NOT EXISTS (SELECT 1 FROM "AmazonSkuMap" map WHERE map."amazonSku" = 'SC-PR1-1-2PK');
