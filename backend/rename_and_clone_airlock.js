const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const FLOOR        = '26TH FLOOR';
  const OLD_ZONE     = 'Air Lock';
  const NEW_ZONE     = 'Air Lock (Corridor)';
  const CLONE_ZONE   = 'Air Lock (Smelly Lab)';

  // ── Step 1: Rename 'Air Lock' → 'Air Lock (Corridor)' ─────────────────────
  const oldLoc = await prisma.location.findUnique({
    where: { floor_zone_room: { floor: FLOOR, zone_room: OLD_ZONE } },
    include: { tasks: { include: { images: true } }, defects: true }
  });

  if (!oldLoc) {
    console.error(`❌ Location not found: ${FLOOR} - ${OLD_ZONE}`);
    return;
  }

  // Check that the new name doesn't already exist
  const existingCorridor = await prisma.location.findUnique({
    where: { floor_zone_room: { floor: FLOOR, zone_room: NEW_ZONE } }
  });

  if (!existingCorridor) {
    await prisma.location.update({
      where: { id: oldLoc.id },
      data: { zone_room: NEW_ZONE }
    });
    console.log(`✅ Renamed: "${OLD_ZONE}" → "${NEW_ZONE}"`);
  } else {
    console.log(`⚠️  "${NEW_ZONE}" already exists, skip rename.`);
  }

  // Reload after rename
  const corridorLoc = await prisma.location.findUnique({
    where: { floor_zone_room: { floor: FLOOR, zone_room: NEW_ZONE } },
    include: { tasks: true }
  });

  // ── Step 2: Clone to 'Air Lock (Smelly Lab)' ──────────────────────────────
  let smellyLoc = await prisma.location.findUnique({
    where: { floor_zone_room: { floor: FLOOR, zone_room: CLONE_ZONE } }
  });

  if (!smellyLoc) {
    smellyLoc = await prisma.location.create({
      data: { floor: FLOOR, zone_room: CLONE_ZONE }
    });
    console.log(`✅ Created new location: "${CLONE_ZONE}"`);
  } else {
    console.log(`⚠️  "${CLONE_ZONE}" already exists, will skip existing tasks.`);
  }

  // Copy tasks from corridor → smelly lab
  let copied = 0, skipped = 0;
  for (const t of corridorLoc.tasks) {
    const exists = await prisma.task.findUnique({
      where: { location_id_job_type: { location_id: smellyLoc.id, job_type: t.job_type } }
    });
    if (!exists) {
      await prisma.task.create({
        data: {
          job_type:        t.job_type,
          start_date:      t.start_date,
          finish_date:     t.finish_date,
          progress:        t.progress,
          area_finish:     t.area_finish,
          area_remaining:  t.area_remaining,
          manpower_plan:   t.manpower_plan,
          manpower_actual: t.manpower_actual,
          material:        t.material,
          supplier:        t.supplier,
          remark:          t.remark,
          updated_date:    t.updated_date,
          location_id:     smellyLoc.id
        }
      });
      console.log(`  ✓ Copied task: ${t.job_type}`);
      copied++;
    } else {
      console.log(`  – Skipped (exists): ${t.job_type}`);
      skipped++;
    }
  }

  console.log(`\n🎉 Done! ${copied} tasks copied, ${skipped} skipped.`);
  console.log(`   ${FLOOR} - "${NEW_ZONE}" : ${corridorLoc.tasks.length} tasks`);
  console.log(`   ${FLOOR} - "${CLONE_ZONE}" : ${copied + skipped} tasks`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
