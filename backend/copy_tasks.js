const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sourceFloor = '27TH FLOOR';
  const sourceZone = 'Technologist & PL Office';
  const targetFloor = '27TH FLOOR';
  const targetZone = 'Flavorist Office';

  // 1. Get source location and its tasks
  const sourceLoc = await prisma.location.findFirst({
    where: { floor: sourceFloor, zone_room: sourceZone },
    include: { tasks: true }
  });

  if (!sourceLoc) {
    console.log('Source location not found!');
    return;
  }

  // 2. Create target location (or get if it already exists)
  let targetLoc = await prisma.location.findUnique({
    where: { floor_zone_room: { floor: targetFloor, zone_room: targetZone } }
  });

  if (!targetLoc) {
    targetLoc = await prisma.location.create({
      data: {
        floor: targetFloor,
        zone_room: targetZone
      }
    });
    console.log(`Created new location: ${targetFloor} - ${targetZone}`);
  } else {
    console.log(`Location already exists: ${targetFloor} - ${targetZone}`);
  }

  // 3. Copy tasks
  for (const sourceTask of sourceLoc.tasks) {
    // Check if task already exists in target location
    const existingTask = await prisma.task.findUnique({
      where: {
        location_id_job_type: {
          location_id: targetLoc.id,
          job_type: sourceTask.job_type
        }
      }
    });

    if (!existingTask) {
      await prisma.task.create({
        data: {
          job_type: sourceTask.job_type,
          start_date: sourceTask.start_date,
          finish_date: sourceTask.finish_date,
          progress: sourceTask.progress,
          area_finish: sourceTask.area_finish,
          area_remaining: sourceTask.area_remaining,
          manpower_plan: sourceTask.manpower_plan,
          manpower_actual: sourceTask.manpower_actual,
          material: sourceTask.material,
          supplier: sourceTask.supplier,
          remark: sourceTask.remark,
          updated_date: sourceTask.updated_date,
          location_id: targetLoc.id
        }
      });
      console.log(`Copied task: ${sourceTask.job_type}`);
    } else {
      console.log(`Task already exists: ${sourceTask.job_type}`);
    }
  }
  
  console.log('Copy operation completed successfully.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
