import "dotenv/config";
import { planAmazonCustomer } from "../src/lib/amazon-customer";
import { prisma } from "../src/lib/db";

function customerArg(): string {
  const flag = process.argv.find((arg) => arg.startsWith("--customer="));
  return flag ? flag.slice("--customer=".length) : "AMAZON-SALES";
}

async function main() {
  const apply = process.argv.includes("--apply");
  const parties = await prisma.party.findMany({
    select: { id: true, code: true, name: true, channel: true, isCustomer: true },
  });
  const plan = planAmazonCustomer(customerArg(), parties);
  if (!plan.ok) throw new Error(plan.error);
  const { party, already } = plan;
  console.log(apply ? "Applying." : "Dry run. Nothing will be written.");
  console.log(`${party.code} ${party.name} (${party.id})`);
  console.log(already ? `Channel is already AMAZON.` : `Channel ${party.channel} -> AMAZON`);
  if (!apply) {
    console.log("Run again with --apply to write.");
    return;
  }
  await prisma.party.update({ where: { id: party.id }, data: { channel: "AMAZON" } });
  console.log(already ? "Left the Amazon customer as it is." : `Set ${party.code} to the Amazon channel.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
