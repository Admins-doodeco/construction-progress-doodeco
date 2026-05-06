/**
 * auth.js — Firebase Admin SDK Initialization & Middleware
 *
 * Initializes Firebase Admin using a service account JSON file.
 * Place your downloaded service account key at:
 *   /Users/tiggestguide/Antigravity/BIM Construction/ConstructionProgress/backend/firebase-service-account.json
 *
 * Then set FIREBASE_PROJECT_ID in your .env file.
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ── Initialize Firebase Admin ─────────────────────────────────────────────────
const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');

if (!admin.apps.length) {
  let serviceAccount;

  // 1. Try to load from environment variable (for Vercel/Production)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (e) {
      console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT environment variable:', e.message);
    }
  }
  // 2. Fallback to local JSON file
  else if (fs.existsSync(serviceAccountPath)) {
    serviceAccount = require(serviceAccountPath);
  }

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase Admin initialized.');
  } else {
    console.warn('⚠️  Firebase configuration NOT FOUND. Auth middleware will reject all requests.');
    console.warn('    Download from Firebase Console → Project Settings → Service Accounts → Generate new private key');
    console.warn('    Save as: backend/firebase-service-account.json OR set FIREBASE_SERVICE_ACCOUNT env var.');
  }
}

// ── Auth Middleware ───────────────────────────────────────────────────────────

/**
 * requireAuth — Verifies Firebase ID token from Authorization header.
 * Attaches decoded user info to req.user.
 * Usage: app.use(requireAuth) or per-route: app.put('/api/...', requireAuth, handler)
 */
const requireAuth = async (req, res, next) => {
  // Skip preflight
  if (req.method === 'OPTIONS') return next();

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Auth token verification failed:', err.message);
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
};

/**
 * requireEditor — Allows only users with role === 'editor' (set via custom claims).
 * Must be used AFTER requireAuth.
 *
 * To grant editor role, run:
 *   node set-role.js <user-email> editor
 */
const requireEditor = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const role = req.user.role;
  if (role !== 'editor') {
    return res.status(403).json({ error: 'Forbidden: Editor role required. Contact your administrator.' });
  }
  next();
};

/**
 * optionalAuth — Verifies token if present, but does NOT block unauthenticated requests.
 * Useful for read-only endpoints that are accessible to viewers.
 */
const optionalAuth = async (req, res, next) => {
  if (req.method === 'OPTIONS') return next();

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    req.user = await admin.auth().verifyIdToken(idToken);
  } catch {
    req.user = null;
  }
  next();
};

module.exports = { requireAuth, requireEditor, optionalAuth, admin };
