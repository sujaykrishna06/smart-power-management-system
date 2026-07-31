/**
 * ============================================================================
 * SMART POWER MANAGEMENT SYSTEM - DASHBOARD LOGIC
 * Framework-free JavaScript using Firebase JS SDK v10 (Modular via CDN)
 * ============================================================================
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getDatabase, 
  ref, 
  onValue, 
  update 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

import { firebaseConfig } from "./config.js";

// Local state tracking
const areaData = {
  guntur_node1: { status: "UP", maintenance_flag: false, last_updated: 0 },
  pedaparimi_node1: { status: "UP", maintenance_flag: false, last_updated: 0 },
  namburu_node1: { status: "UP", maintenance_flag: false, last_updated: 0 }
};

let db = null;

// ============================================================================
// INITIALIZATION
// ============================================================================
function initDashboard() {
  const warningBanner = document.getElementById("config-warning");
  const connText = document.getElementById("connection-text");
  const dot = document.getElementById("connection-dot");

  // Check if user has replaced placeholder keys
  if (
    !firebaseConfig || 
    !firebaseConfig.apiKey || 
    firebaseConfig.apiKey.includes("YOUR_FIREBASE_")
  ) {
    if (warningBanner) warningBanner.classList.remove("hidden");
    if (connText) connText.textContent = "Firebase Config Missing";
    console.warn("Firebase configuration placeholders detected in dashboard/config.js");
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);

    // Track Firebase Connection Status
    const connectedRef = ref(db, ".info/connected");
    onValue(connectedRef, (snap) => {
      const isConnected = snap.val() === true;
      if (connText) {
        connText.textContent = isConnected ? "Live Connected" : "Connecting to Firebase...";
      }
      if (dot) {
        dot.style.backgroundColor = isConnected ? "var(--color-online)" : "var(--color-maintenance)";
      }
    }, (err) => {
      console.error("Connection status error:", err);
      if (connText) connText.textContent = "Connection Error";
      if (dot) dot.style.backgroundColor = "var(--color-offline)";
    });

    // Listen for Real-Time Changes on 'areas/' node
    const areasRef = ref(db, "areas");
    onValue(areasRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        Object.keys(data).forEach((areaId) => {
          if (areaData[areaId]) {
            areaData[areaId] = { ...areaData[areaId], ...data[areaId] };
            updateAreaCardUI(areaId, areaData[areaId]);
          }
        });
        updateMetricsSummary();
      } else {
        console.warn("No data under 'areas' node yet in Realtime Database.");
      }
    }, (error) => {
      console.error("Firebase Database read error:", error);
      if (connText) connText.textContent = "Permission Denied / Rules Error";
      if (dot) dot.style.backgroundColor = "var(--color-offline)";
      alert("Firebase Permission Denied! Check your Realtime Database Rules in Firebase Console.\nEnsure .read and .write are set to true for testing.");
    });

  } catch (err) {
    console.error("Error initializing Firebase App:", err);
    if (warningBanner) warningBanner.classList.remove("hidden");
    if (connText) connText.textContent = "Init Error";
  }
}

// ============================================================================
// UI UPDATES
// ============================================================================
function updateAreaCardUI(areaId, data) {
  const card = document.getElementById(`card-${areaId}`);
  const badge = document.getElementById(`badge-${areaId}`);
  const statusTxt = document.getElementById(`status-${areaId}`);
  const maintTag = document.getElementById(`maint-tag-${areaId}`);
  const timeTxt = document.getElementById(`time-${areaId}`);
  const maintBtn = document.getElementById(`btn-maint-${areaId}`);
  
  /* DEV ONLY ELEMENT REFERENCE */
  const outageBtn = document.getElementById(`btn-outage-${areaId}`);

  if (!card) return;

  const isUp = data.status === "UP";
  const isMaint = Boolean(data.maintenance_flag);

  // Update Card Class & Status Badge
  if (isUp) {
    card.classList.remove("status-down");
    card.classList.add("status-up");
    if (badge) {
      badge.className = "status-badge online";
      badge.textContent = "ONLINE";
    }
    if (statusTxt) statusTxt.textContent = "UP";
  } else {
    card.classList.remove("status-up");
    card.classList.add("status-down");
    if (badge) {
      badge.className = "status-badge offline";
      badge.textContent = "OUTAGE";
    }
    if (statusTxt) statusTxt.textContent = "DOWN";
  }

  // Update Maintenance Badge & Button Text
  if (maintTag) {
    if (isMaint) {
      maintTag.className = "maint-tag active";
      maintTag.textContent = "Active Maintenance";
    } else {
      maintTag.className = "maint-tag inactive";
      maintTag.textContent = "Inactive";
    }
  }

  if (maintBtn) {
    if (isMaint) {
      maintBtn.className = "btn btn-maintenance active-state";
      maintBtn.innerHTML = "✅ Clear Scheduled Maintenance";
    } else {
      maintBtn.className = "btn btn-maintenance";
      maintBtn.innerHTML = "⚙️ Mark as Scheduled Maintenance";
    }
  }

  // Update Timestamp
  if (timeTxt) {
    if (data.last_updated && data.last_updated > 0) {
      const date = new Date(data.last_updated > 1e11 ? data.last_updated : data.last_updated * 1000);
      timeTxt.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } else {
      timeTxt.textContent = "Not recorded yet";
    }
  }

  // DEV ONLY BUTTON STATE UPDATE
  /* DEV ONLY CONTROLS START */
  if (outageBtn) {
    if (isUp) {
      outageBtn.className = "btn btn-dev-simulate";
      outageBtn.innerHTML = '⚡ Simulate Outage <span class="dev-tag">DEV ONLY</span>';
    } else {
      outageBtn.className = "btn btn-dev-restore";
      outageBtn.innerHTML = '🔌 Simulate Power Restore <span class="dev-tag">DEV ONLY</span>';
    }
  }
  /* DEV ONLY CONTROLS END */
}

function updateMetricsSummary() {
  let onlineCount = 0;
  let outageCount = 0;
  let maintenanceCount = 0;

  Object.values(areaData).forEach((item) => {
    if (item.status === "UP") onlineCount++;
    else outageCount++;

    if (item.maintenance_flag) maintenanceCount++;
  });

  const onlineEl = document.getElementById("metric-online");
  const outageEl = document.getElementById("metric-outages");
  const maintEl = document.getElementById("metric-maintenance");

  if (onlineEl) onlineEl.textContent = onlineCount;
  if (outageEl) outageEl.textContent = outageCount;
  if (maintEl) maintEl.textContent = maintenanceCount;
}

// ============================================================================
// ACTIONS / EVENT HANDLERS
// ============================================================================

/**
 * Toggles the maintenance_flag for a given locality in Firebase RTDB
 */
window.toggleMaintenance = function(areaId) {
  if (!db) {
    alert("Firebase Database is not initialized. Please ensure you open the dashboard via http://localhost:3000 and check dashboard/config.js.");
    return;
  }

  const currentFlag = Boolean(areaData[areaId]?.maintenance_flag);
  const newFlag = !currentFlag;

  const areaRef = ref(db, `areas/${areaId}`);
  update(areaRef, {
    maintenance_flag: newFlag
  }).then(() => {
    console.log(`[Firebase] Successfully updated maintenance_flag to ${newFlag} for ${areaId}`);
  }).catch((err) => {
    console.error(`[Firebase] Error updating maintenance_flag for ${areaId}:`, err);
    alert("Failed to update maintenance flag in Firebase: " + err.message + "\nCheck Firebase Database Rules!");
  });
};

/* ============================================================================
   DEV ONLY FUNCTIONS - EASY TO DELETE LATER
   ============================================================================ */
/* DEV ONLY CONTROLS START */
/**
 * Flips status between "UP" and "DOWN" for testing before hardware exists
 */
window.simulateOutage = function(areaId) {
  if (!db) {
    alert("Firebase Database is not initialized. Please ensure you open the dashboard via http://localhost:3000 and check dashboard/config.js.");
    return;
  }

  const currentStatus = areaData[areaId]?.status || "UP";
  const newStatus = currentStatus === "UP" ? "DOWN" : "UP";
  const nowTimestamp = Math.floor(Date.now() / 1000);

  const areaRef = ref(db, `areas/${areaId}`);
  update(areaRef, {
    status: newStatus,
    last_updated: nowTimestamp
  }).then(() => {
    console.log(`[DEV ONLY] Simulated status change to '${newStatus}' for ${areaId}`);
  }).catch((err) => {
    console.error(`[DEV ONLY] Error simulating status change for ${areaId}:`, err);
    alert("Failed to update status in Firebase: " + err.message + "\nCheck Firebase Database Rules!");
  });
};
/* DEV ONLY CONTROLS END */

// Run initialization when DOM is ready
document.addEventListener("DOMContentLoaded", initDashboard);
