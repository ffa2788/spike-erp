import { seedDemo } from "../src/lib/seed-demo";

seedDemo()
  .then(() => {
    console.log("Example data loaded.");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
