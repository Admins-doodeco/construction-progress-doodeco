const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function copyZone(floor, sourceZone, targetZone) {
  const sourceLoc = await prisma.location.findFirst({
    where: { floor: floor, zone_room: sourceZone },
    include: { tasks: true }
  });

  if (!sourceLoc) {
    console.log(`Source location not found: ${floor} - ${sourceZone}`);
    return;
  }

  let targetLoc = await prisma.location.findFirst({
    where: { floor: floor, zone_room: targetZone }
  });

  if (!targetLoc) {
    targetLoc = await prisma.location.create({
      data: { floor: floor, zone_room: targetZone, as_built: sourceLoc.as_built }
    });
    console.log(`Created new location: ${floor} - ${targetZone}`);
  } else {
    console.log(`Location already exists: ${floor} - ${targetZone}`);
  }

  for (const sourceTask of sourceLoc.tasks) {
    const existingTask = await prisma.task.findFirst({
      where: { location_id: targetLoc.id, job_type: sourceTask.job_type }
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
      console.log(`  Copied task: ${sourceTask.job_type}`);
    } else {
      console.log(`  Task already exists: ${sourceTask.job_type}`);
    }
  }
}

async function main() {
  const f24 = '24TH FLOOR';
  
  // 1. ชั้น 24
  await copyZone(f24, 'Construction', 'Construction 2');
  await copyZone(f24, 'Meeting room 10 seats', 'Meeting room 10 seats 2');
  await copyZone(f24, 'Spare Office', 'Spare Office 2');
  await copyZone(f24, 'Spare Office', 'Spare Office 3');
  await copyZone(f24, 'Storage', 'Storage 2');
  await copyZone(f24, 'Storage', 'Storage 3'); // Assuming typo correction from Spare Office 3 to Storage 3

  // 2. ชั้น 27
  const f27 = '27TH FLOOR';
  const loc27 = await prisma.location.findFirst({
    where: { floor: f27, zone_room: 'Flavorist Office' }
  });

  if (loc27) {
    // Delete Tasks
    const deletedTasks = await prisma.task.deleteMany({
      where: { location_id: loc27.id }
    });
    console.log(`Deleted ${deletedTasks.count} tasks for ${f27} - Flavorist Office`);
    
    // Delete Location
    await prisma.location.delete({
      where: { id: loc27.id }
    });
    console.log(`Deleted location ${f27} - Flavorist Office`);
  } else {
    console.log(`Location not found for deletion: ${f27} - Flavorist Office`);
  }
  
  console.log('Database update completed.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
