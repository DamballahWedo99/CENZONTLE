// READ-ONLY: leer markdown de las 5 stories de la épica booking
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

try {
  const stories = await prisma.story.findMany({
    where: { epicId: { startsWith: '0af79e0d' } },
    select: { id: true, title: true, markdown: true },
    orderBy: { title: 'asc' },
  });

  for (const s of stories) {
    console.log('═══════════════════════════════════════════════════════');
    console.log(`📖 STORY: ${s.title}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log(`(${s.markdown.length} chars)`);
    console.log(s.markdown);
    console.log();
  }
} finally {
  await prisma.$disconnect();
}
