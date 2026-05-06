const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const loc = await prisma.location.findFirst({
    where: { zone_room: 'Technologist & PL Office' },
    include: { tasks: true }
  });
  console.log(JSON.stringify(loc, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
