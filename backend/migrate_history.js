const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tasks = await prisma.task.findMany();
  let count = 0;
  for (const task of tasks) {
    // Update task to have updated_date = 2026-04-28 if not set
    await prisma.task.update({
      where: { id: task.id },
      data: { updated_date: task.updated_date || '2026-04-28' }
    });

    // Upsert into TaskHistory
    await prisma.taskHistory.upsert({
      where: {
        task_id_updated_date: {
          task_id: task.id,
          updated_date: task.updated_date || '2026-04-28'
        }
      },
      update: {},
      create: {
        task_id: task.id,
        progress: task.progress,
        area_finish: task.area_finish,
        area_remaining: task.area_remaining,
        manpower_plan: task.manpower_plan,
        manpower_actual: task.manpower_actual,
        material: task.material,
        supplier: task.supplier,
        remark: task.remark,
        start_date: task.start_date,
        finish_date: task.finish_date,
        updated_date: task.updated_date || '2026-04-28'
      }
    });
    count++;
  }
  console.log(`Migrated ${count} tasks to history.`);
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
