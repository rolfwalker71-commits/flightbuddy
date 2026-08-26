import { seedCoreMasterData } from "../lib/seed";

async function main() {
  const counts = await seedCoreMasterData();
  console.log("Seeded master data", counts);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
