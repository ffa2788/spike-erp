import "dotenv/config";
import { seedDemo } from "../src/lib/seed-demo";
import { seedChoice, seedOwner } from "../src/lib/seed-owner";

async function main() {
  if (seedChoice() === "example") {
    await seedDemo();
    console.log("Example data loaded. Do not point production at this database.");
    return;
  }
  await seedOwner();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
