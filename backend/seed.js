const fs = require('fs');
const csv = require('csv-parser');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
  const results = [];
  const csvPath = process.argv[2] || '../../v_man_fils_progress.csv';

  console.log(`Reading data from ${csvPath}...`);

  fs.createReadStream(csvPath)
    .pipe(csv())
    .on('data', (data) => {
      // Basic validation: Check if floor, zone/room, and job type are present
      if (data['FLOOR'] && data['ZONE/ ROOM'] && data['Job Type']) {
        results.push(data);
      }
    })
    .on('end', async () => {
      console.log(`Parsed ${results.length} rows. Starting database insertion (with deduplication)...`);

      let insertedLocations = 0;
      let upsertedTasks = 0;

      for (const row of results) {
        const floor = row['FLOOR'].trim();
        const zone_room = row['ZONE/ ROOM'].trim();
        const job_type = row['Job Type'].trim();

        // 1. Create or Find Location
        let location;
        try {
          location = await prisma.location.upsert({
            where: {
              floor_zone_room: {
                floor: floor,
                zone_room: zone_room
              }
            },
            update: {},
            create: {
              floor: floor,
              zone_room: zone_room
            }
          });
        } catch (error) {
          console.error(`Error upserting location ${floor} - ${zone_room}:`, error.message);
          continue;
        }

        // 2. Upsert Task (Deduplication based on location_id and job_type)
        try {
          await prisma.task.upsert({
            where: {
              location_id_job_type: {
                location_id: location.id,
                job_type: job_type
              }
            },
            update: {
              start_date: row['Start'] || null,
              finish_date: row['finish'] || null,
              progress: row['Progress'] || null,
              area_finish: row['Area finish'] || null,
              area_remaining: row['Area remaining'] || null,
              manpower_plan: row['Manpower Plan'] || null,
              manpower_actual: row['Manpower Actual'] || null,
              material: row['Material'] || null,
              supplier: row['supplier'] || null,
              remark: row['Remark'] || null,
            },
            create: {
              job_type: job_type,
              start_date: row['Start'] || null,
              finish_date: row['finish'] || null,
              progress: row['Progress'] || null,
              area_finish: row['Area finish'] || null,
              area_remaining: row['Area remaining'] || null,
              manpower_plan: row['Manpower Plan'] || null,
              manpower_actual: row['Manpower Actual'] || null,
              material: row['Material'] || null,
              supplier: row['supplier'] || null,
              remark: row['Remark'] || null,
              location_id: location.id
            }
          });
          upsertedTasks++;
        } catch (error) {
          console.error(`Error upserting task ${job_type} for ${floor} - ${zone_room}:`, error.message);
        }
      }

      console.log(`✅ Success! Processed and deduplicated tasks.`);
      console.log(`Total Unique Tasks Processed: ${upsertedTasks}`);

      await prisma.$disconnect();
    });
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
