/**
 * set-role.js — Set custom claims (role) on a Firebase user
 *
 * Usage:
 *   node set-role.js user@example.com editor
 *   node set-role.js user@example.com viewer
 *
 * Roles:
 *   editor — can read and write all task data
 *   viewer — can only read data (default for all users)
 *
 * After running this, the user must sign out and sign back in
 * (or wait up to 1 hour) for the new role to take effect.
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ firebase-service-account.json not found!');
  console.error('   Download from Firebase Console → Project Settings → Service Accounts → Generate new private key');
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const [email, role] = process.argv.slice(2);

if (!email || !role) {
  console.error('Usage: node set-role.js <email> <role>');
  console.error('Roles: editor | viewer');
  process.exit(1);
}

if (!['editor', 'viewer'].includes(role)) {
  console.error(`❌ Invalid role: "${role}". Must be "editor" or "viewer".`);
  process.exit(1);
}

async function setRole() {
  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(user.uid, { role });
    console.log(`✅ Successfully set role="${role}" for ${email} (uid: ${user.uid})`);
    console.log('   Note: The user must sign out and sign back in for changes to take effect.');
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.error(`❌ User not found: ${email}`);
      console.error('   Make sure the user has signed up first via the app login.');
    } else {
      console.error('❌ Error:', err.message);
    }
  }
  process.exit(0);
}

setRole();
