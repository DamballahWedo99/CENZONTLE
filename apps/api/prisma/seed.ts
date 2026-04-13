import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Clean all data
  await prisma.epicPod.deleteMany();
  await prisma.podProductOwner.deleteMany();
  await prisma.epic.deleteMany();
  await prisma.initiative.deleteMany();
  await prisma.productOwner.deleteMany();
  await prisma.pod.deleteMany();

  console.log('Seed completed: all tables cleared. Create data from the UI.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
