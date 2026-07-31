/**
 * ============================================================================
 * SMART POWER MANAGEMENT SYSTEM - BACKEND DECISION ENGINE (PHASE 3)
 * Node.js Listener using Firebase Admin SDK
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const admin = require('firebase-admin');

// Load environment variables from root .env or backend .env
const rootEnvPath = path.join(__dirname, '..', '.env');
const localEnvPath = path.join(__dirname, '.env');

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath });
} else {
  dotenv.config();
}

// ----------------------------------------------------------------------------
// 1. FIREBASE SERVICE ACCOUNT & INITIALIZATION
// ----------------------------------------------------------------------------

// Supported service account file locations
const candidatePaths = [
  path.join(__dirname, 'serviceAccountKey.json'),
  path.join(__dirname, '..', 'serviceAccountKey.json'),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH
].filter(Boolean);

let serviceAccountPath = candidatePaths.find(p => fs.existsSync(p));

if (!serviceAccountPath) {
  console.error('\n================================================================');
  console.error('❌ ERROR: Firebase Service Account file missing!');
  console.error('----------------------------------------------------------------');
  console.error('Please download your Service Account JSON file from Firebase Console:');
  console.error('  1. Go to Firebase Console -> Project Settings -> Service accounts');
  console.error('  2. Click "Generate new private key"');
  console.error('  3. Save the downloaded JSON file as:');
  console.error(`     ${path.join(__dirname, 'serviceAccountKey.json')}`);
  console.error('----------------------------------------------------------------');
  console.error('✅ Covered by .gitignore: serviceAccountKey.json is safe & git-ignored.');
  console.error('================================================================\n');
  process.exit(1);
}

const databaseURL = process.env.FIREBASE_DATABASE_URL;

if (!databaseURL) {
  console.error('❌ ERROR: FIREBASE_DATABASE_URL is missing from environment variables / .env file.');
  process.exit(1);
}

// Initialize Firebase Admin App
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: databaseURL
});

const db = admin.database();
console.log('✅ Firebase Admin SDK initialized successfully.');
console.log(`📡 Connected to Database: ${databaseURL}`);
console.log(`🔑 Service Account loaded from: ${serviceAccountPath}\n`);

// ----------------------------------------------------------------------------
// 2. DECISION ENGINE STATE & TIMERS
// ----------------------------------------------------------------------------

// Tracks running 30-second timers per area
// Structure: { [areaId]: TimeoutObject }
const activeTimers = {};

// Tracks previous state of each area for transition detection
// Structure: { [areaId]: { status: 'UP'|'DOWN', maintenance_flag: boolean } }
const previousStates = {};

let isInitialLoad = true;
const TIMER_DURATION_MS = 30000; // 30 seconds for prototype (10 mins in production)

// ----------------------------------------------------------------------------
// 3. DATABASE LISTENER & DECISION LOGIC
// ----------------------------------------------------------------------------

const areasRef = db.ref('areas');

console.log('👀 Listening for power status changes under "areas/*/status"...\n');

areasRef.on('value', (snapshot) => {
  const areasData = snapshot.val();
  if (!areasData) {
    console.warn('⚠️ No data found under "areas" node in database.');
    return;
  }

  // On first load, record initial state without triggering false alerts
  if (isInitialLoad) {
    Object.keys(areasData).forEach((areaId) => {
      previousStates[areaId] = {
        status: areasData[areaId].status || 'UP',
        maintenance_flag: Boolean(areasData[areaId].maintenance_flag)
      };
      console.log(`ℹ️ [INITIAL STATE] ${areaId} -> Status: ${previousStates[areaId].status}, Maintenance: ${previousStates[areaId].maintenance_flag}`);
    });
    isInitialLoad = false;
    console.log('\n🟢 Decision engine ready and active.\n');
    return;
  }

  // Process live state updates per area
  Object.keys(areasData).forEach((areaId) => {
    const currentState = {
      status: areasData[areaId].status || 'UP',
      maintenance_flag: Boolean(areasData[areaId].maintenance_flag)
    };

    const prevState = previousStates[areaId] || { status: 'UP', maintenance_flag: false };

    const statusChanged = currentState.status !== prevState.status;
    const maintenanceChanged = currentState.maintenance_flag !== prevState.maintenance_flag;

    // UPDATE RECORDED STATE
    previousStates[areaId] = currentState;

    // CASE A: Status flipped to DOWN (Outage Detected)
    if (statusChanged && currentState.status === 'DOWN') {
      console.log(`\n🔴 [OUTAGE DETECTED] Power lost for locality: [${areaId}]`);

      if (currentState.maintenance_flag) {
        // Option 1: Maintenance already flagged before outage
        console.log(`📋 [DECISION] MAINTENANCE decision for [${areaId}] (Scheduled work in progress)`);
      } else {
        // Option 2: Not flagged -> start 30s timer
        console.log(`⏱️  [TIMER STARTED] 30-second countdown started for [${areaId}]. Waiting for maintenance flag...`);

        // Cancel existing timer if one was somehow running
        if (activeTimers[areaId]) {
          clearTimeout(activeTimers[areaId]);
        }

        activeTimers[areaId] = setTimeout(() => {
          // Re-fetch current database state at timer expiration
          areasRef.child(areaId).once('value', (areaSnap) => {
            const latestData = areaSnap.val() || {};
            const isNowMaintenance = Boolean(latestData.maintenance_flag);
            const isStillDown = (latestData.status || 'DOWN') === 'DOWN';

            if (isStillDown) {
              if (isNowMaintenance) {
                console.log(`📋 [DECISION] MAINTENANCE decision for [${areaId}] (Flagged during timer window)`);
              } else {
                console.log(`🚨 [DECISION] FAULT decision for [${areaId}] (30s timer expired without maintenance flag!)`);
              }
            }
            delete activeTimers[areaId];
          });
        }, TIMER_DURATION_MS);
      }
    }

    // CASE B: Status flipped back to UP (Power Restored)
    if (statusChanged && currentState.status === 'UP') {
      console.log(`\n🟢 [POWER RESTORED] Power restored for locality: [${areaId}]`);

      if (activeTimers[areaId]) {
        clearTimeout(activeTimers[areaId]);
        delete activeTimers[areaId];
        console.log(`⏹️  [TIMER CANCELLED] 30s timer cancelled for [${areaId}] because power was restored before expiration.`);
      }
    }

    // CASE C: Maintenance flag was turned ON while outage timer was running
    if (maintenanceChanged && currentState.maintenance_flag && currentState.status === 'DOWN') {
      if (activeTimers[areaId]) {
        clearTimeout(activeTimers[areaId]);
        delete activeTimers[areaId];
        console.log(`⏹️  [TIMER CANCELLED] 30s timer cancelled for [${areaId}] because staff flagged maintenance.`);
        console.log(`📋 [DECISION] MAINTENANCE decision for [${areaId}] (Maintenance mode enabled manually)`);
      }
    }
  });
}, (err) => {
  console.error('❌ Firebase Listener Error:', err);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down backend decision listener engine...');
  Object.keys(activeTimers).forEach((areaId) => clearTimeout(activeTimers[areaId]));
  process.exit(0);
});
