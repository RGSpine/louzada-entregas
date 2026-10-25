import { prisma } from "../src/lib/prisma";
import { seedMarketplaceSpecialties } from "../src/lib/marketplace/marketplace-sync";

async function main() {
  const count = await seedMarketplaceSpecialties();
  console.log(`Seed de especialidades: ${count} registros do cadastro.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
