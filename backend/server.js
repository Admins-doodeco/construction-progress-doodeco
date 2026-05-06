const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { S3Client, CreateBucketCommand, PutBucketPolicyCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const { requireAuth, requireEditor, optionalAuth } = require('./auth');
const ExcelJS = require('exceljs');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

// S3 Configuration
const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  forcePathStyle: true, // Required for MinIO
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin123'
  }
});

// Auto-create bucket for local dev if it doesn't exist, and set public-read policy
const bucketName = process.env.S3_BUCKET_NAME || 'construction-images';

const setBucketPolicy = async () => {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucketName }));
    console.log(`Bucket '${bucketName}' created.`);
  } catch (err) {
    if (err.name !== 'BucketAlreadyOwnedByYou' && err.name !== 'BucketAlreadyExists') {
      console.error(`Failed to create bucket:`, err);
    } else {
      console.log(`Bucket '${bucketName}' already exists.`);
    }
  }

  // Apply public read policy so thumbnails are accessible
  try {
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "PublicReadGetObject",
          Effect: "Allow",
          Principal: "*",
          Action: "s3:GetObject",
          Resource: `arn:aws:s3:::${bucketName}/*`
        }
      ]
    };
    await s3.send(new PutBucketPolicyCommand({
      Bucket: bucketName,
      Policy: JSON.stringify(policy)
    }));
    console.log(`Public read policy applied to '${bucketName}'.`);
  } catch (err) {
    console.error(`Failed to set bucket policy:`, err);
  }
};

setBucketPolicy();

// Multer Upload Setup (Max 10 files, Max 5MB per file)
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: bucketName,
    acl: 'public-read', // Or depending on bucket policy
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, `tasks/${req.params.id}/${uniqueSuffix}${path.extname(file.originalname)}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));


// ── Security Middleware ──────────────────────────────────────────────────────
//
// Strategy:
//   - GET endpoints: open (any viewer or unauthenticated user can read)
//   - PUT / POST / DELETE: require Firebase Auth token with role='editor'
//
// Legacy fallback: SketchUp Ruby extension can still use x-api-key for
// internal calls (e.g. from main.rb). This is checked BEFORE Firebase auth.
//
const API_KEY = process.env.API_KEY || 'CP-SKETCHUP-SECRET-KEY-2024';

// Middleware: allow x-api-key as a service bypass (for Ruby/backend calls)
// OR require Firebase Bearer token for editor write operations.
const editorOrApiKey = async (req, res, next) => {
  if (req.method === 'OPTIONS') return next();

  // 1. Legacy API key bypass (for SketchUp Ruby / server-to-server)
  const providedKey = req.headers['x-api-key'];
  if (providedKey && providedKey === API_KEY) {
    req.user = { role: 'editor', via: 'api-key' };
    return next();
  }

  // 2. Firebase Bearer token required
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Login required to edit data.' });
  }

  const { admin } = require('./auth');
  try {
    const decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
    req.user = decoded;
    if (decoded.role !== 'editor') {
      return res.status(403).json({ error: 'Forbidden: Editor role required. Contact your administrator.' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token.' });
  }
};

// ── Locations ────────────────────────────────────────────────────────────────

// Get all locations
app.get('/api/locations', async (req, res) => {
  try {
    const locations = await prisma.location.findMany({
      orderBy: [{ floor: 'asc' }, { zone_room: 'asc' }]
    });
    res.json(locations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Lookup location by natural key (floor + zone_room) — stable across reseeds
app.get('/api/locations/lookup', async (req, res) => {
  const { floor, zone_room } = req.query;
  if (!floor || !zone_room) return res.status(400).json({ error: 'floor and zone_room required' });
  try {
    const location = await prisma.location.findUnique({
      where: { floor_zone_room: { floor, zone_room } }
    });
    res.json(location);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update location
app.put('/api/locations/:id', editorOrApiKey, async (req, res) => {
  const { id } = req.params;
  const { as_built } = req.body;
  try {
    const loc = await prisma.location.update({
      where: { id },
      data: { as_built }
    });
    res.json(loc);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

// Get tasks — supports filtering by location_id OR by floor+zone_room natural key
app.get('/api/tasks', async (req, res) => {
  const { location_id, floor, zone_room } = req.query;
  try {
    let whereClause = {};
    if (location_id) {
      whereClause = { location_id };
    } else if (floor && zone_room) {
      // Natural key lookup — doesn't break if DB is reseeded
      const loc = await prisma.location.findUnique({
        where: { floor_zone_room: { floor, zone_room } }
      });
      if (loc) whereClause = { location_id: loc.id };
    }
    const tasks = await prisma.task.findMany({
      where: whereClause,
      include: { location: true, images: true },
      orderBy: { job_type: 'asc' }
    });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Lookup single task by natural key (floor + zone_room + job_type) — stable across reseeds
app.get('/api/tasks/lookup', async (req, res) => {
  const { floor, zone_room, job_type } = req.query;
  if (!floor || !zone_room || !job_type) {
    return res.status(400).json({ error: 'floor, zone_room, and job_type required' });
  }
  try {
    const loc = await prisma.location.findUnique({
      where: { floor_zone_room: { floor, zone_room } }
    });
    if (!loc) return res.json(null);
    const task = await prisma.task.findUnique({
      where: { location_id_job_type: { location_id: loc.id, job_type } },
      include: { location: true, images: true }
    });
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single task by UUID (still used for save/update after lookup)
app.get('/api/tasks/:id', async (req, res) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: { location: true, images: true }
    });
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update task by UUID — requires editor role
app.put('/api/tasks/:id', editorOrApiKey, async (req, res) => {
  try {
    const updateData = { ...req.body };
    delete updateData.id;
    delete updateData.location_id;
    delete updateData.location; // Relation
    delete updateData.images; // Relation

    const updatedTask = await prisma.task.update({
      where: { id: req.params.id },
      data: updateData
    });
    
    // Also update history
    if (updatedTask.updated_date) {
      await prisma.taskHistory.upsert({
        where: {
          task_id_updated_date: {
            task_id: updatedTask.id,
            updated_date: updatedTask.updated_date
          }
        },
        update: {
          progress: updatedTask.progress,
          area_finish: updatedTask.area_finish,
          area_remaining: updatedTask.area_remaining,
          manpower_plan: updatedTask.manpower_plan,
          manpower_actual: updatedTask.manpower_actual,
          material: updatedTask.material,
          supplier: updatedTask.supplier,
          remark: updatedTask.remark,
          start_date: updatedTask.start_date,
          finish_date: updatedTask.finish_date
        },
        create: {
          task_id: updatedTask.id,
          progress: updatedTask.progress,
          area_finish: updatedTask.area_finish,
          area_remaining: updatedTask.area_remaining,
          manpower_plan: updatedTask.manpower_plan,
          manpower_actual: updatedTask.manpower_actual,
          material: updatedTask.material,
          supplier: updatedTask.supplier,
          remark: updatedTask.remark,
          start_date: updatedTask.start_date,
          finish_date: updatedTask.finish_date,
          updated_date: updatedTask.updated_date
        }
      });
    }

    res.json(updatedTask);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update task by natural key — requires editor role
app.put('/api/tasks/by-key', editorOrApiKey, async (req, res) => {
  const { floor, zone_room, job_type, ...updateData } = req.body;
  if (!floor || !zone_room || !job_type) {
    return res.status(400).json({ error: 'floor, zone_room, and job_type required' });
  }
  try {
    const loc = await prisma.location.findUnique({
      where: { floor_zone_room: { floor, zone_room } }
    });
    if (!loc) return res.status(404).json({ error: 'Location not found' });
    const updatedTask = await prisma.task.update({
      where: { location_id_job_type: { location_id: loc.id, job_type } },
      data: updateData
    });

    if (updatedTask.updated_date) {
      await prisma.taskHistory.upsert({
        where: {
          task_id_updated_date: {
            task_id: updatedTask.id,
            updated_date: updatedTask.updated_date
          }
        },
        update: {
          progress: updatedTask.progress,
          area_finish: updatedTask.area_finish,
          area_remaining: updatedTask.area_remaining,
          manpower_plan: updatedTask.manpower_plan,
          manpower_actual: updatedTask.manpower_actual,
          material: updatedTask.material,
          supplier: updatedTask.supplier,
          remark: updatedTask.remark,
          start_date: updatedTask.start_date,
          finish_date: updatedTask.finish_date
        },
        create: {
          task_id: updatedTask.id,
          progress: updatedTask.progress,
          area_finish: updatedTask.area_finish,
          area_remaining: updatedTask.area_remaining,
          manpower_plan: updatedTask.manpower_plan,
          manpower_actual: updatedTask.manpower_actual,
          material: updatedTask.material,
          supplier: updatedTask.supplier,
          remark: updatedTask.remark,
          start_date: updatedTask.start_date,
          finish_date: updatedTask.finish_date,
          updated_date: updatedTask.updated_date
        }
      });
    }

    res.json(updatedTask);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get historical tasks up to a specific date
app.get('/api/history', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
  
  try {
    // We want the state of each task on or before the given date.
    // Easiest is to fetch all tasks, and for each find its history.
    // To do this efficiently, we can fetch tasks, and then do a raw query or fetch history and group.
    
    const tasks = await prisma.task.findMany({
      include: { location: true }
    });
    
    // For each task, get the latest history <= date
    // Note: since SQLite doesn't support complex distinct on, we fetch histories manually
    const histories = await prisma.taskHistory.findMany({
      where: {
        updated_date: { lte: date }
      },
      orderBy: { updated_date: 'desc' }
    });

    const latestHistories = new Map();
    for (const h of histories) {
      if (!latestHistories.has(h.task_id)) {
        latestHistories.set(h.task_id, h);
      }
    }

    const historicalTasks = tasks.map(t => {
      const h = latestHistories.get(t.id);
      if (h) {
        return {
          ...t,
          progress: h.progress,
          area_finish: h.area_finish,
          area_remaining: h.area_remaining,
          manpower_plan: h.manpower_plan,
          manpower_actual: h.manpower_actual,
          material: h.material,
          supplier: h.supplier,
          remark: h.remark,
          start_date: h.start_date,
          finish_date: h.finish_date,
          updated_date: h.updated_date
        };
      }
      return t;
    });

    res.json(historicalTasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Images ────────────────────────────────────────────────────────────────────

const { PutObjectCommand } = require('@aws-sdk/client-s3');

// Upload images — requires editor role
app.post('/api/tasks/:id/images', editorOrApiKey, async (req, res) => {
  try {
    const taskId = req.params.id;
    const images = req.body.images; // Array of { name, base64 }
    
    if (!images || !Array.isArray(images)) {
      return res.status(400).json({ error: 'Invalid payload: images array required' });
    }
    
    // Check if task exists
    const task = await prisma.task.findUnique({ where: { id: taskId }, include: { images: true } });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    
    // Check limit
    if (task.images.length + images.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 images allowed per task' });
    }

    const createdImages = [];
    for (const file of images) {
      // Decode base64 (format: data:image/jpeg;base64,/9j/4AAQ...)
      const matches = file.base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      let buffer, mimeType;
      
      if (matches && matches.length === 3) {
        mimeType = matches[1];
        buffer = Buffer.from(matches[2], 'base64');
      } else {
        // Fallback if no prefix
        mimeType = 'application/octet-stream';
        buffer = Buffer.from(file.base64, 'base64');
      }
      
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const key = `tasks/${taskId}/${uniqueSuffix}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      
      // Upload to S3
      await s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ACL: 'public-read'
      }));
      
      // Since it's MinIO local or S3, construct the URL
      const endpointStr = process.env.S3_ENDPOINT || 'http://localhost:9000';
      const fileUrl = `${endpointStr}/${bucketName}/${key}`;

      const img = await prisma.taskImage.create({
        data: {
          task_id: taskId,
          file_url: fileUrl,
          file_name: file.name,
          size_bytes: buffer.length
        }
      });
      createdImages.push(img);
    }

    res.json(createdImages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete an image — requires editor role
app.delete('/api/tasks/:id/images/:imageId', editorOrApiKey, async (req, res) => {
  try {
    const { id, imageId } = req.params;
    
    const image = await prisma.taskImage.findUnique({ where: { id: imageId } });
    if (!image || image.task_id !== id) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    // Delete from DB
    await prisma.taskImage.delete({ where: { id: imageId } });
    
    // TODO: Delete from S3 using S3Client (Optional: but good practice)
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Defects ───────────────────────────────────────────────────────────────────

// GET defects by zone (floor + zone_room natural key)
app.get('/api/defects', async (req, res) => {
  const { floor, zone_room } = req.query;
  try {
    let whereClause = {};
    if (floor && zone_room) {
      const loc = await prisma.location.findUnique({
        where: { floor_zone_room: { floor, zone_room } }
      });
      if (loc) whereClause = { location_id: loc.id };
      else return res.json([]);
    }
    const defects = await prisma.defect.findMany({
      where: whereClause,
      include: { location: true, task: true, images: true },
      orderBy: [{ classification: 'asc' }, { number: 'asc' }]
    });
    res.json(defects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET NCR stats: Major defect counts grouped by location_id + task_id — MUST be before /:id
app.get('/api/defects/stats', async (req, res) => {
  try {
    // All Major defects
    const allMajor = await prisma.defect.findMany({
      where: { classification: 'Major' },
      select: { location_id: true, task_id: true, status: true }
    });

    // Build map: "locationId||taskId" → { total, done }
    const statsMap = {};
    for (const d of allMajor) {
      const key = `${d.location_id}||${d.task_id || '__none__'}`;
      if (!statsMap[key]) statsMap[key] = { location_id: d.location_id, task_id: d.task_id, total: 0, done: 0 };
      statsMap[key].total++;
      if (d.status === 'Done') statsMap[key].done++;
    }

    res.json(Object.values(statsMap));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET defect by number_code (for SketchUp instance name lookup) — MUST be before /:id

app.get('/api/defects/lookup', async (req, res) => {
  const { floor, zone_room, number_code } = req.query;
  if (!floor || !zone_room || !number_code) {
    return res.status(400).json({ error: 'floor, zone_room, and number_code required' });
  }
  try {
    const loc = await prisma.location.findUnique({
      where: { floor_zone_room: { floor, zone_room } }
    });
    if (!loc) return res.json(null);
    const defect = await prisma.defect.findFirst({
      where: { location_id: loc.id, number_code },
      include: { location: true, task: true, images: true }
    });
    res.json(defect);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET defect history — state of defects on or before a given date — MUST be before /:id
app.get('/api/defects/history', async (req, res) => {
  const { date, floor, zone_room } = req.query;
  if (!date) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });

  try {
    let defectWhere = {};
    if (floor && zone_room) {
      const loc = await prisma.location.findUnique({
        where: { floor_zone_room: { floor, zone_room } }
      });
      if (loc) defectWhere = { location_id: loc.id };
    }

    const defects = await prisma.defect.findMany({
      where: defectWhere,
      include: { location: true, task: true, images: true }
    });

    const histories = await prisma.defectHistory.findMany({
      where: { updated_date: { lte: date } },
      orderBy: { updated_date: 'desc' }
    });

    const latestHistories = new Map();
    for (const h of histories) {
      if (!latestHistories.has(h.defect_id)) {
        latestHistories.set(h.defect_id, h);
      }
    }

    const historicalDefects = defects.map(d => {
      const h = latestHistories.get(d.id);
      if (h) {
        return {
          ...d,
          name: h.name ?? d.name,
          classification: h.classification ?? d.classification,
          status: h.status ?? d.status,
          start_date: h.start_date ?? d.start_date,
          finish_date: h.finish_date ?? d.finish_date,
          supplier: h.supplier ?? d.supplier,
          remark: h.remark ?? d.remark,
          updated_date: h.updated_date
        };
      }
      return d;
    });

    res.json(historicalDefects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single defect by ID
app.get('/api/defects/:id', async (req, res) => {
  try {
    const defect = await prisma.defect.findUnique({
      where: { id: req.params.id },
      include: { location: true, task: true, images: true, histories: { orderBy: { updated_date: 'desc' } } }
    });
    res.json(defect);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create defect (auto-generate number per location)
app.post('/api/defects', editorOrApiKey, async (req, res) => {
  const { floor, zone_room, name, classification, status, start_date, finish_date, remark, task_id } = req.body;
  if (!floor || !zone_room || !name) {
    return res.status(400).json({ error: 'floor, zone_room, and name required' });
  }
  try {
    // Resolve location
    const loc = await prisma.location.findUnique({
      where: { floor_zone_room: { floor, zone_room } }
    });
    if (!loc) return res.status(404).json({ error: 'Location not found' });

    // Auto-generate next number (1–99) per location
    const existing = await prisma.defect.findMany({
      where: { location_id: loc.id },
      select: { number: true },
      orderBy: { number: 'desc' }
    });
    const nextNumber = existing.length > 0 ? existing[0].number + 1 : 1;
    if (nextNumber > 99) {
      return res.status(400).json({ error: 'Maximum 99 defects per zone reached' });
    }

    // Auto-fill supplier from Task if task_id provided
    let supplier = req.body.supplier || null;
    let resolvedTask = null;
    if (task_id) {
      resolvedTask = await prisma.task.findUnique({ where: { id: task_id } });
      if (resolvedTask && !supplier) supplier = resolvedTask.supplier || null;
    }

    // Build number_code: "01 (JobType - Zone - Floor)"
    const numStr = String(nextNumber).padStart(2, '0');
    const jobLabel = resolvedTask ? resolvedTask.job_type : (req.body.job_type_label || '');
    const numberCode = jobLabel
      ? `${numStr} (${jobLabel} - ${zone_room} - ${floor})`
      : `${numStr} (${zone_room} - ${floor})`;

    const defect = await prisma.defect.create({
      data: {
        number: nextNumber,
        number_code: numberCode,
        name,
        classification: classification || 'Minor',
        status: status || 'Not Start',
        start_date: start_date || null,
        finish_date: finish_date || null,
        remark: remark || null,
        supplier,
        location_id: loc.id,
        task_id: task_id || null
      },
      include: { location: true, task: true, images: true }
    });
    res.status(201).json(defect);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update defect
app.put('/api/defects/:id', editorOrApiKey, async (req, res) => {
  try {
    const updateData = { ...req.body };
    delete updateData.id;
    delete updateData.location_id;
    delete updateData.location;
    delete updateData.task;
    delete updateData.images;
    delete updateData.histories;

    const defect = await prisma.defect.update({
      where: { id: req.params.id },
      data: updateData,
      include: { location: true, task: true, images: true, histories: true }
    });

    // Upsert history snapshot when updated_date is set
    if (defect.updated_date) {
      await prisma.defectHistory.upsert({
        where: {
          defect_id_updated_date: {
            defect_id: defect.id,
            updated_date: defect.updated_date
          }
        },
        update: {
          name: defect.name,
          classification: defect.classification,
          status: defect.status,
          start_date: defect.start_date,
          finish_date: defect.finish_date,
          supplier: defect.supplier,
          remark: defect.remark
        },
        create: {
          defect_id: defect.id,
          name: defect.name,
          classification: defect.classification,
          status: defect.status,
          start_date: defect.start_date,
          finish_date: defect.finish_date,
          supplier: defect.supplier,
          remark: defect.remark,
          updated_date: defect.updated_date
        }
      });
    }

    res.json(defect);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET defect history — state of defects on or before a given date
// (history route moved to above /:id — see GET /api/defects/history)

// DELETE defect
app.delete('/api/defects/:id', editorOrApiKey, async (req, res) => {
  try {
    await prisma.defect.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// POST upload images for a defect
app.post('/api/defects/:id/images', editorOrApiKey, async (req, res) => {
  try {
    const defectId = req.params.id;
    const images = req.body.images;
    if (!images || !Array.isArray(images)) {
      return res.status(400).json({ error: 'Invalid payload: images array required' });
    }
    const defect = await prisma.defect.findUnique({ where: { id: defectId }, include: { images: true } });
    if (!defect) return res.status(404).json({ error: 'Defect not found' });
    if (defect.images.length + images.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 images allowed per defect' });
    }

    const createdImages = [];
    for (const file of images) {
      const matches = file.base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      let buffer, mimeType;
      if (matches && matches.length === 3) {
        mimeType = matches[1];
        buffer = Buffer.from(matches[2], 'base64');
      } else {
        mimeType = 'application/octet-stream';
        buffer = Buffer.from(file.base64, 'base64');
      }
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const key = `defects/${defectId}/${uniqueSuffix}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      await s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ACL: 'public-read'
      }));
      const endpointStr = process.env.S3_ENDPOINT || 'http://localhost:9000';
      const fileUrl = `${endpointStr}/${bucketName}/${key}`;
      const img = await prisma.defectImage.create({
        data: { defect_id: defectId, file_url: fileUrl, file_name: file.name, size_bytes: buffer.length }
      });
      createdImages.push(img);
    }
    res.json(createdImages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE image from a defect
app.delete('/api/defects/:id/images/:imageId', editorOrApiKey, async (req, res) => {
  try {
    const { id, imageId } = req.params;
    const image = await prisma.defectImage.findUnique({ where: { id: imageId } });
    if (!image || image.defect_id !== id) {
      return res.status(404).json({ error: 'Image not found' });
    }
    await prisma.defectImage.delete({ where: { id: imageId } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export Report as Excel
app.get('/api/export-excel', async (req, res) => {
  try {
    const locations = await prisma.location.findMany({
      include: { tasks: true },
      orderBy: [{ floor: 'asc' }, { zone_room: 'asc' }]
    });

    const jobTypesSet = new Set();
    locations.forEach(loc => {
      loc.tasks.forEach(t => jobTypesSet.add(t.job_type));
    });
    const jobTypes = Array.from(jobTypesSet).sort();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Report');

    const headerFill1 = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F7FA' } }; // Light blue
    const finishFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD32F2F' } }; // Red
    const totalRowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } }; // Light indigo
    const borderAll = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' }
    };
    const centerAlign = { vertical: 'middle', horizontal: 'center' };

    sheet.getCell('A1').value = 'FLOOR';
    sheet.getCell('B1').value = 'AREA';
    sheet.mergeCells('A1:A2');
    sheet.mergeCells('B1:B2');
    
    ['A1', 'A2', 'B1', 'B2'].forEach(cell => {
      sheet.getCell(cell).fill = headerFill1;
      sheet.getCell(cell).border = borderAll;
      sheet.getCell(cell).alignment = centerAlign;
      sheet.getCell(cell).font = { bold: true };
    });

    let currentColIndex = 3;
    
    jobTypes.forEach(jobType => {
      const startCol = currentColIndex;
      const endCol = currentColIndex + 3;
      
      sheet.mergeCells(1, startCol, 1, endCol);
      const jobCell = sheet.getCell(1, startCol);
      jobCell.value = jobType;
      jobCell.fill = headerFill1;
      jobCell.border = borderAll;
      jobCell.alignment = centerAlign;
      jobCell.font = { bold: true };
      
      const subHeaders = ['Start', 'finish', 'Progress', 'Material'];
      subHeaders.forEach((sub, i) => {
        const subCell = sheet.getCell(2, startCol + i);
        subCell.value = sub;
        subCell.border = borderAll;
        subCell.alignment = centerAlign;
        subCell.font = { bold: true };
        if (sub === 'finish') {
          subCell.fill = finishFill;
          subCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        } else {
          subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
        }
      });
      currentColIndex = endCol + 1;
    });

    const progressByRoomCol = currentColIndex;
    const completionByRoomCol = currentColIndex + 1;
    
    sheet.mergeCells(1, progressByRoomCol, 2, progressByRoomCol);
    const pbrCell = sheet.getCell(1, progressByRoomCol);
    pbrCell.value = 'Progress By Room';
    pbrCell.fill = headerFill1;
    pbrCell.border = borderAll;
    pbrCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    pbrCell.font = { bold: true };
    
    sheet.mergeCells(1, completionByRoomCol, 2, completionByRoomCol);
    const cbrCell = sheet.getCell(1, completionByRoomCol);
    cbrCell.value = 'Completion date by room';
    cbrCell.fill = headerFill1;
    cbrCell.border = borderAll;
    cbrCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cbrCell.font = { bold: true };
    
    let rowNum = 3;
    const floors = {};
    locations.forEach(loc => {
      if (!floors[loc.floor]) floors[loc.floor] = [];
      floors[loc.floor].push(loc);
    });
    
    for (const [floorName, floorLocations] of Object.entries(floors)) {
      const startFloorRow = rowNum;
      let zoneCount = 0;
      const jobTotals = {};
      jobTypes.forEach(jt => {
        jobTotals[jt] = { progressSum: 0, materialSum: 0, count: 0, minDate: null, maxDate: null };
      });
      let floorProgressSum = 0;
      let floorMaxDate = null;
      let roomCount = 0;

      for (const loc of floorLocations) {
        const row = sheet.getRow(rowNum);
        row.getCell(1).value = floorName;
        row.getCell(1).border = borderAll;
        row.getCell(1).alignment = centerAlign;
        
        row.getCell(2).value = loc.zone_room;
        row.getCell(2).border = borderAll;
        
        const tasksMap = {};
        loc.tasks.forEach(t => tasksMap[t.job_type] = t);
        
        let colIdx = 3;
        let roomProgressSum = 0;
        let roomJobCount = 0;
        let roomMaxDate = null;
        
        jobTypes.forEach(jobType => {
          const task = tasksMap[jobType];
          let startVal = '', finishVal = '', progVal = 0, matVal = 0;
          
          if (task) {
             startVal = task.start_date || '';
             finishVal = task.finish_date || '';
             progVal = parseFloat(task.progress) || 0;
             matVal = parseFloat(task.material) || 0;
             
             roomProgressSum += progVal;
             roomJobCount++;
             
             if (finishVal) {
               if (!roomMaxDate || new Date(finishVal) > new Date(roomMaxDate)) roomMaxDate = finishVal;
             }
             
             const tData = jobTotals[jobType];
             tData.progressSum += progVal;
             tData.materialSum += matVal;
             tData.count++;
             if (startVal) {
                if (!tData.minDate || new Date(startVal) < new Date(tData.minDate)) tData.minDate = startVal;
             }
             if (finishVal) {
                if (!tData.maxDate || new Date(finishVal) > new Date(tData.maxDate)) tData.maxDate = finishVal;
             }
          }
          
          const startCell = row.getCell(colIdx);
          startCell.value = startVal;
          startCell.border = borderAll; startCell.alignment = centerAlign;
          
          const finishCell = row.getCell(colIdx + 1);
          finishCell.value = finishVal;
          finishCell.fill = finishFill; finishCell.font = { color: { argb: 'FFFFFFFF' } };
          finishCell.border = borderAll; finishCell.alignment = centerAlign;
          
          const progCell = row.getCell(colIdx + 2);
          progCell.value = progVal ? progVal + '%' : '';
          progCell.border = borderAll; progCell.alignment = centerAlign;
          
          const matCell = row.getCell(colIdx + 3);
          matCell.value = matVal ? matVal + '%' : '';
          matCell.border = borderAll; matCell.alignment = centerAlign;
          
          colIdx += 4;
        });
        
        const avgRoomProg = roomJobCount > 0 ? (roomProgressSum / roomJobCount).toFixed(0) : 0;
        const pbrCellData = row.getCell(progressByRoomCol);
        pbrCellData.value = avgRoomProg + '%';
        pbrCellData.border = borderAll; pbrCellData.alignment = centerAlign;
        
        const cbrCellData = row.getCell(completionByRoomCol);
        cbrCellData.value = roomMaxDate || '';
        cbrCellData.fill = finishFill; cbrCellData.font = { color: { argb: 'FFFFFFFF' } };
        cbrCellData.border = borderAll; cbrCellData.alignment = centerAlign;
        
        floorProgressSum += parseFloat(avgRoomProg);
        if (roomMaxDate) {
          if (!floorMaxDate || new Date(roomMaxDate) > new Date(floorMaxDate)) floorMaxDate = roomMaxDate;
        }
        
        roomCount++;
        zoneCount++;
        rowNum++;
      }
      
      if (startFloorRow < rowNum - 1) {
        sheet.mergeCells(startFloorRow, 1, rowNum - 1, 1);
      }
      
      const totalRow = sheet.getRow(rowNum);
      totalRow.getCell(1).value = 'TOTAL OF FLOOR';
      totalRow.getCell(1).fill = totalRowFill; totalRow.getCell(1).border = borderAll; totalRow.getCell(1).alignment = centerAlign; totalRow.getCell(1).font = { bold: true };
      
      totalRow.getCell(2).value = zoneCount + ' Zones';
      totalRow.getCell(2).fill = totalRowFill; totalRow.getCell(2).border = borderAll; totalRow.getCell(2).alignment = centerAlign; totalRow.getCell(2).font = { bold: true };
      
      let colIdx = 3;
      jobTypes.forEach(jobType => {
        const tData = jobTotals[jobType];
        const avgProg = tData.count > 0 ? (tData.progressSum / tData.count).toFixed(0) : 0;
        const avgMat = tData.count > 0 ? (tData.materialSum / tData.count).toFixed(0) : 0;
        
        const c1 = totalRow.getCell(colIdx);
        c1.value = tData.minDate || '';
        c1.fill = totalRowFill; c1.border = borderAll; c1.alignment = centerAlign;
        
        const c2 = totalRow.getCell(colIdx + 1);
        c2.value = tData.maxDate || '';
        c2.fill = totalRowFill; c2.border = borderAll; c2.alignment = centerAlign;
        
        const c3 = totalRow.getCell(colIdx + 2);
        c3.value = avgProg ? avgProg + '%' : '';
        c3.fill = totalRowFill; c3.border = borderAll; c3.alignment = centerAlign;
        
        const c4 = totalRow.getCell(colIdx + 3);
        c4.value = avgMat ? avgMat + '%' : '';
        c4.fill = totalRowFill; c4.border = borderAll; c4.alignment = centerAlign;
        
        colIdx += 4;
      });
      
      const avgFloorProg = roomCount > 0 ? (floorProgressSum / roomCount).toFixed(0) : 0;
      const cPbr = totalRow.getCell(progressByRoomCol);
      cPbr.value = avgFloorProg ? avgFloorProg + '%' : '';
      cPbr.fill = totalRowFill; cPbr.border = borderAll; cPbr.alignment = centerAlign; cPbr.font = { bold: true };
      
      const cCbr = totalRow.getCell(completionByRoomCol);
      cCbr.value = floorMaxDate || '';
      cCbr.fill = finishFill; cCbr.border = borderAll; cCbr.alignment = centerAlign; cCbr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      
      rowNum++;
    }
    
    sheet.columns.forEach((col, i) => {
      col.width = i < 2 ? 20 : 15;
    });
    
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=progress_report_${today}.xlsx`);
    
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.use((err, req, res, next) => {
  console.error('Express Error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Construction Progress Backend running on http://localhost:${PORT}`);
});
