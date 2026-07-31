/**
 * ============================================================================
 * SMART POWER MANAGEMENT SYSTEM - BACKEND DECISION & COMMAND ENGINE (PHASE 4)
 * Node.js Listener using Firebase Admin SDK
 * Writes SMS job objects to commands/{area_id} for ESP32 consumption
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
  console.error('Please download your Service Account JSON file from Firebase Console');
  console.error(`and save it as: ${path.join(__dirname, 'serviceAccountKey.json')}`);
  console.error('================================================================\n');
  process.exit(1);
}

const databaseURL = process.env.FIREBASE_DATABASE_URL;

if (!databaseURL) {
  console.error('❌ ERROR: FIREBASE_DATABASE_URL is missing from .env file.');
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: databaseURL
});

const db = admin.database();
console.log('✅ Firebase Admin SDK initialized successfully.');
console.log(`📡 Connected to Database: ${databaseURL}`);
console.log(`📱 Staff Phone Number configured: ${process.env.STAFF_PHONE_NUMBER || '(not set in .env)'}\n`);

// ----------------------------------------------------------------------------
// 2. DECISION ENGINE STATE & TIMERS
// ----------------------------------------------------------------------------

const activeTimers = {};
const previousStates = {};
let isInitialLoad = true;
const TIMER_DURATION_MS = 30000; // 30 seconds for demo (10 mins in production)

// ----------------------------------------------------------------------------
// 3. SMS COMMAND QUEUE WRITER
// ----------------------------------------------------------------------------

/**
 * Writes a full job object to commands/{area_id} in Firebase RTDB
 * @param {string} areaId - e.g. "guntur_node1"
 * @param {string} messageType - "MAINTENANCE" | "FAULT"
 */
async function writeSmsCommandJob(areaId, messageType) {
  try {
    // Pull resident phone numbers from residents/{area_id}
    const residentsSnap = await db.ref(`residents/${areaId}`).once('value');
    let residentNumbers = residentsSnap.val();

    if (!Array.isArray(residentNumbers)) {
      if (typeof residentNumbers === 'string') {
        residentNumbers = [residentNumbers];
      } else if (residentNumbers && typeof residentNumbers === 'object') {
        residentNumbers = Object.values(residentNumbers);
      } else {
        residentNumbers = [];
      }
    }

    const staffNumber = process.env.STAFF_PHONE_NUMBER || "";
    const nowTimestamp = Math.floor(Date.now() / 1000);

    let residentMessage = "";
    let staffMessage = "";

    if (messageType === 'MAINTENANCE') {
      residentMessage = "There's maintenance work going on in your area. Please hang on till it's fixed. If this isn't the case, please ignore this message.";
      staffMessage = "";
    } else if (messageType === 'FAULT') {
      residentMessage = "Power outage detected in your locality. Our technical team has been notified.";
      staffMessage = `URGENT FAULT ALERT: Unacknowledged power outage detected at locality [${areaId}] at ${new Date().toLocaleTimeString()}. Please inspect immediately.`;
    }

    const commandObj = {
      pending: true,
      message_type: messageType,
      resident_message: residentMessage,
      resident_numbers: residentNumbers,
      staff_message: staffMessage,
      staff_number: staffNumber,
      created_at: nowTimestamp
    };

    // Write job object to commands/{area_id}
    await db.ref(`commands/${areaId}`).set(commandObj);
    console.log(`✉️  [COMMAND QUEUED] Successfully written to commands/${areaId}:`, {
      type: messageType,
      residentsCount: residentNumbers.length,
      hasStaffAlert: Boolean(staffMessage),
      pending: true
    });

    // Optional event history log
    await db.ref(`events/${areaId}`).push({
      type: `${messageType}_ALERT`,
      timestamp: nowTimestamp
    });

  } catch (err) {
    console.error(`❌ [COMMAND WRITE ERROR] Failed to write SMS job to commands/${areaId}:`, err.message);
  }
}

// ----------------------------------------------------------------------------
// 4. DATABASE LISTENER & DECISION ENGINE
// ----------------------------------------------------------------------------

const areasRef = db.ref('areas');

console.log('👀 Listening for power status changes under "areas/*/status"...\n');

areasRef.on('value', (snapshot) => {
  const areasData = snapshot.val();
  if (!areasData) return;

  // On initial load, record state without firing false alerts
  if (isInitialLoad) {
    Object.keys(areasData).forEach((areaId) => {
      previousStates[areaId] = {
        status: areasData[areaId].status || 'UP',
        maintenance_flag: Boolean(areasData[areaId].maintenance_flag)
      };
      console.log(`ℹ️ [INITIAL STATE] ${areaId} -> Status: ${previousStates[areaId].status}, Maintenance: ${previousStates[areaId].maintenance_flag}`);
    });
    isInitialLoad = false;
    console.log('\n🟢 Decision engine & SMS queue writer ready.\n');
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

    // Update state cache
    previousStates[areaId] = currentState;

    // CASE A: Status flipped to DOWN (Outage Detected)
    if (statusChanged && currentState.status === 'DOWN') {
      console.log(`\n🔴 [OUTAGE DETECTED] Power lost for locality: [${areaId}]`);

      if (currentState.maintenance_flag) {
        console.log(`📋 [DECISION] MAINTENANCE decision for [${areaId}]`);
        writeSmsCommandJob(areaId, 'MAINTENANCE');
      } else {
        console.log(`⏱️  [TIMER STARTED] 30-second countdown started for [${areaId}]. Waiting for maintenance flag...`);

        if (activeTimers[areaId]) {
          clearTimeout(activeTimers[areaId]);
        }

        activeTimers[areaId] = setTimeout(() => {
          areasRef.child(areaId).once('value', (areaSnap) => {
            const latestData = areaSnap.val() || {};
            const isNowMaintenance = Boolean(latestData.maintenance_flag);
            const isStillDown = (latestData.status || 'DOWN') === 'DOWN';

            if (isStillDown) {
              if (isNowMaintenance) {
                console.log(`📋 [DECISION] MAINTENANCE decision for [${areaId}] (Flagged during timer)`);
                writeSmsCommandJob(areaId, 'MAINTENANCE');
              } else {
                console.log(`🚨 [DECISION] FAULT decision for [${areaId}] (30s timer expired without flag!)`);
                writeSmsCommandJob(areaId, 'FAULT');
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
        console.log(`⏹️  [TIMER CANCELLED] 30s timer cancelled for [${areaId}] because power was restored.`);
      }
    }

    // CASE C: Maintenance flag turned ON while timer was running
    if (maintenanceChanged && currentState.maintenance_flag && currentState.status === 'DOWN') {
      if (activeTimers[areaId]) {
        clearTimeout(activeTimers[areaId]);
        delete activeTimers[areaId];
        console.log(`⏹️  [TIMER CANCELLED] 30s timer cancelled for [${areaId}] because maintenance mode was enabled.`);
        console.log(`📋 [DECISION] MAINTENANCE decision for [${areaId}]`);
        writeSmsCommandJob(areaId, 'MAINTENANCE');
      }
    }
  });
}, (err) => {
  console.error('❌ Firebase Listener Error:', err);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down backend decision engine...');
  Object.keys(activeTimers).forEach((areaId) => clearTimeout(activeTimers[areaId]));
  process.exit(0);
});
