# Smart Power Management System, Project Info

Full reference doc. Read this before touching any code or hardware. Keep it in the repo root so any AI tool working on this project can read it directly for context.

---

## 1. Project Overview

**What it is:** an IoT based system that detects power outages the instant they happen, knows exactly which locality is affected, and sends the right message to the right people, residents get a maintenance notice if staff already flagged the work, or a plain outage alert if it's an unacknowledged fault. Staff get a live dashboard and an urgent alert with the exact location.

**Why it matters:** right now, residents have no way to tell a planned outage from a genuine fault, which causes repeated complaint calls and wastes everyone's time. There's also no existing low-cost way to notify only the affected area instead of broadcasting to everyone.

**Scope for this build:** a working prototype simulating 3 localities (Guntur, Pedaparimi, Namburu) using one ESP32 with 3 independent sensing channels, not 3 separate physical devices. This proves the full logic end to end without the cost and complexity of multiple physical nodes. Multiple physical nodes is a documented future enhancement, not part of this build. SMS is sent entirely through a GSM module wired to the same ESP32, no third-party SMS API or account involved.

**Builder:** solo build, V Sujay Krishna, 3rd Year EEE, VVIT.

---

## 2. How It Works

1. **Detect:** each sensing channel continuously watches whether a monitored power source is present or lost.
2. **Identify locale:** the moment a loss is detected, it's tagged with a fixed area ID (`guntur_node1`, `pedaparimi_node1`, `namburu_node1`), never just "power is down somewhere."
3. **Check maintenance status:** the backend checks whether staff have already marked that area for scheduled work (`maintenance_flag`).
4. **Decide and queue:**
   - If flagged: a maintenance job is queued for that area, message to residents: *"There's maintenance work going on in your area. Please hang on till it's fixed. If this isn't the case, please ignore this message."*
   - If not flagged within a set window (30 seconds for this demo, would be 10 minutes in a real deployment): it's treated as a genuine fault. A fault job is queued, outage notice to residents plus an urgent alert to staff with the area and timestamp.
5. **Send:** the ESP32 picks up the queued job for its own area, sends the actual SMS itself using the GSM module, and marks the job done.
6. **Dashboard:** live view, green means power on, red means power off, per area, plus which areas are under acknowledged maintenance.

Targeting works because every resident's phone number is mapped in advance to a fixed area_id. Alerts are always a filtered lookup, never a broadcast.

---

## 3. Architecture

```
[Adapter DC output] --> [PC817 Optocoupler] --> [ESP32 GPIO]
   (per channel, x3)                                  |
                                                  WiFi (ESP32)
                                                        |
                                          [Firebase Realtime Database]
                                             /                    \
                          [Node.js backend listener]      [Web Dashboard]
                          (decides, writes SMS job          (Firebase JS SDK,
                           to commands/{area_id})            live status,
                                    |                         maintenance toggle)
                                    |
                          [ESP32 reads commands/{own_area}]
                                    |
                          [SIM800L GSM module, AT commands]
                                    |
                          [Resident / Staff phones, real SMS]
```

The ESP32 does double duty: it senses power and pushes status up to Firebase, and it also polls Firebase for pending SMS jobs and sends them out itself via the GSM module. The Node backend decides *what* to send, the ESP32 is the only thing that can actually *send* it, since the SIM card lives on that board.

---

## 4. Tech Stack

**Hardware**
- ESP32 dev board (already have)
- 3x PC817 optocoupler
- 3x small 5V USB adapter/charger (repurposed, one per simulated locality)
- 1kΩ resistors (LED side current limiting) and 10kΩ resistors (pull-up)
- 3x LED (optional, physical status indicator alongside the dashboard)
- SIM800L GSM module, plus an active SIM card with SMS balance
- A dedicated 4V (3.7 to 4.2V), 2A capable power supply or buck converter for the SIM800L, do not power it from the ESP32's own 3.3V or 5V pin
- Breadboard, jumper wires

**Software**
- Node.js (already installed) for the backend listener script
- Firebase Realtime Database, free Spark plan
- Firebase Web SDK for the dashboard
- Plain HTML/CSS/JS for the dashboard front end
- Arduino IDE or PlatformIO for ESP32 firmware, written in C++, including AT command handling for the SIM800L over a hardware UART

**Dev tools**
- Cursor (or VS Code AI)
- Git + GitHub

No third-party SMS account or API is used anywhere in this stack.

---

## 5. Firebase Data Model

```json
{
  "areas": {
    "guntur_node1": {
      "status": "UP",
      "last_updated": 1730000000,
      "maintenance_flag": false
    },
    "pedaparimi_node1": { "status": "UP", "last_updated": 0, "maintenance_flag": false },
    "namburu_node1": { "status": "UP", "last_updated": 0, "maintenance_flag": false }
  },
  "residents": {
    "guntur_node1": ["+91XXXXXXXXXX"],
    "pedaparimi_node1": ["+91XXXXXXXXXX"],
    "namburu_node1": ["+91XXXXXXXXXX"]
  },
  "commands": {
    "guntur_node1": {
      "pending": true,
      "message_type": "MAINTENANCE",
      "resident_message": "There's maintenance work going on in your area...",
      "resident_numbers": ["+91XXXXXXXXXX"],
      "staff_message": "",
      "staff_number": "+91XXXXXXXXXX",
      "created_at": 1730000000
    }
  },
  "events": {
    "guntur_node1": {
      "-Nabc123": { "type": "FAULT_ALERT", "timestamp": 1730000000 }
    }
  }
}
```
`commands/{area_id}` is the job queue. The backend writes to it, the ESP32 reads it, sends the SMS, then sets `pending: false` to acknowledge. `events/` is optional but useful for an alert history in the demo and report.

---

## 6. Repo Structure

```
smart-power-mgmt/
  firmware/          ESP32 code (.ino or PlatformIO project), sensing + GSM sending
  backend/           Node.js listener, decision logic, writes SMS jobs to Firebase
  dashboard/         HTML/CSS/JS front end
  docs/
    project_info.md  this file
    ai_prompts.md     prompt doc
  .env               secrets, never committed
  .gitignore
  README.md
```

**.gitignore must include:** `node_modules/`, `.env`, any Firebase service account JSON, any file with real phone numbers, any firmware config header with WiFi credentials.

**.env holds:** Firebase config values only now, no third-party SMS credentials needed.

---

## 7. Development Phases

Software first, fully working with a mock trigger before any hardware is wired in. Hardware second, wired into the already-working software.

### Phase 0: Environment and Accounts Setup
Goal: repo exists on GitHub, Firebase project exists, folder structure is in place.
Time estimate: 1 to 1.5 hrs
Steps:
1. Create a Firebase project in the Firebase console, enable Realtime Database in test mode for now (lock down rules later).
2. `git init`, create the repo structure above, push an empty GitHub repo, first commit.
3. Create `.env` and `.gitignore`, confirm `.env` is actually ignored before putting any real keys in it.
Definition of Done: repo is on GitHub, Firebase project exists, `.env` has Firebase credentials and is confirmed gitignored.

### Phase 1: Firebase Schema and Manual Sanity Check
Goal: the schema from section 5 exists and can be read/written by hand before any code touches it.
Time estimate: 1 hr
Steps:
1. In the Firebase console, manually create the `areas`, `residents`, and `commands` nodes matching the schema.
2. Manually flip one area's `status` to DOWN and back, confirm it saves correctly.
Definition of Done: you can see and edit the exact structure from section 5 live in the Firebase console.

### Phase 2: Web Dashboard
Goal: a page that shows live area status and lets you toggle maintenance mode.
Time estimate: 3 to 4 hrs
Steps:
1. Set up the Firebase JS SDK in `dashboard/`.
2. Render all 3 areas, green card if UP, red card if DOWN, live (no page refresh needed).
3. Add a "Mark as Scheduled Maintenance" button per area that writes `maintenance_flag: true`.
4. For testing before hardware exists: add a temporary "Simulate Outage" button per area (clearly marked as a dev-only control) that flips `status` to DOWN manually. Remove or hide this before the final hardware demo.
Definition of Done: opening the dashboard in a browser shows live, correct status per area, and both buttons work.

### Phase 3: Node.js Backend Listener
Goal: a running script that watches Firebase and applies the decision logic from section 2.
Time estimate: 3 to 4 hrs
Steps:
1. Initialize a Node project in `backend/`, install the Firebase Admin SDK.
2. Listen for changes on `areas/*/status`.
3. On a change to DOWN: check `maintenance_flag`. If true, log the decision (SMS command comes in Phase 4). If false, start a 30 second timer; if still unflagged when it fires, log the fault decision instead.
4. If status flips back to UP before the timer fires, cancel the timer and log that it was cancelled.
Definition of Done: flipping status in the dashboard (via the simulate button) produces the correct logged decision every time, including both the flagged and unflagged paths.

### Phase 4: SMS Command Queue
Goal: the backend writes a real, ready-to-send job to Firebase for the ESP32 to pick up.
Time estimate: 1 hr
Steps:
1. Wherever Phase 3 currently just logs a decision, instead write a full job object to `commands/{area_id}` matching the schema in section 5 (message type, resident message and numbers, staff message and number if it's a fault, pending set to true, timestamp).
2. Pull resident numbers from `residents/{area_id}` and a staff number from an env var.
Definition of Done: triggering an outage via the dashboard produces a correctly filled-in job under `commands/{area_id}` in the Firebase console, for both the maintenance and fault paths.

### Phase 5: Full Mock End-to-End Test
Goal: confirm the entire software stack works exactly as designed before any hardware is involved.
Time estimate: 2 hrs
Steps:
1. Run through all 3 areas, both message paths (flagged and unflagged), and confirm the dashboard, backend logs, and the resulting `commands` entries all agree every time.
2. Test edge cases: what happens if you flag maintenance after the 30 second timer already fired, what happens if two areas go down at once.
3. Clean up code, add comments, commit and push.
Definition of Done: you'd be comfortable demoing the entire decision flow live using only the dashboard's simulate button, no hardware needed, just watching the correct job appear in Firebase.

---

### Phase 6: Component Sourcing
Goal: every hardware part is in hand.
Time estimate: 1 hr to order, 2 to 5 days shipping, order this on day 1 so it's not the bottleneck. **Order the SIM800L first, it's the highest-risk component.**
Shopping list (approx India pricing):
| Item | Qty | Approx price | Where |
|---|---|---|---|
| PC817 optocoupler | 3 | ₹15 to 20 each | Robu.in, Amazon.in |
| 1kΩ resistor | 5 | ₹1 to 2 each | any local electronics shop |
| 10kΩ resistor | 5 | ₹1 to 2 each | any local electronics shop |
| LED (any color) | 3 | ₹2 to 5 each | any local electronics shop |
| SIM800L GSM module | 1 | ₹400 to 600 | Robu.in, Amazon.in |
| Active SIM card with SMS balance | 1 | ~₹20 to 50 recharge | any local shop, confirm 2G coverage first |
| 4V/2A buck converter or dedicated supply for the GSM module | 1 | ₹50 to 100 | Robu.in, Amazon.in |
| Small breadboard (if current one's too small) | 1 | ₹80 to 150 | Robu.in, Amazon.in |
| 5V USB adapters | 3 | already own old ones | n/a |
Total: roughly ₹700 to 1200, still cheap, mostly the GSM module and its power supply.

### Phase 7: Safe Sensing Circuit, Single Channel
Goal: prove one channel physically detects power presence/absence correctly.
Time estimate: 1.5 to 2 hrs
**Safety first: only ever touch the low-voltage DC output side of the adapter. Never open the adapter or touch anything on the mains side. The adapter's own casing handles the 230V AC safely, that's exactly why this method is used instead of sensing mains directly.**
Wiring, one channel:
1. Adapter DC output (+) through a 1kΩ resistor into PC817 pin 1 (anode).
2. Adapter DC output (-) into PC817 pin 2 (cathode).
3. ESP32 3.3V through a 10kΩ pull-up resistor into PC817 pin 4 (collector), and that same junction into an ESP32 GPIO pin.
4. PC817 pin 3 (emitter) into ESP32 GND.
Logic note: with this wiring, GPIO reads LOW when power is present (adapter plugged in, LED inside the optocoupler lit, phototransistor conducting, pulling the GPIO down) and HIGH when power is absent. Define this clearly as constants in firmware so it's not confusing later, `POWER_PRESENT = LOW`, `POWER_ABSENT = HIGH`.
Definition of Done: plugging and unplugging the adapter reliably flips a multimeter reading (or a test LED) on the GPIO side, every time, with no flakiness.

### Phase 8: GSM Module Wiring and AT Command Test
Goal: prove the SIM800L can register on the network and send one manual SMS, in isolation, before it touches any of the project's own logic. **This is the highest-risk part of the whole build, get it working early, even in parallel with the software phases if you have the module in hand already, so you have time to get a replacement module if this one's faulty.**
Time estimate: 2 to 2.5 hrs
Steps:
1. Power the SIM800L from its own dedicated 4V/2A supply, common ground with the ESP32, never from the ESP32's own 3.3V/5V pin, it will brownout under transmit current spikes.
2. Wire SIM800L TX/RX to one of the ESP32's spare hardware UART pins (not SoftwareSerial, it's unreliable at the baud rates SIM800L needs).
3. Insert the SIM card, confirm it's unlocked (no PIN) and has SMS balance and 2G coverage where you're testing.
4. Using the Arduino serial monitor, send raw AT commands manually: `AT` (expect OK), `AT+CSQ` (signal quality, confirm it's not 99, which means no signal), `AT+CMGF=1` (text mode), then `AT+CMGS="+91XXXXXXXXXX"` followed by your message text and a Ctrl+Z to send.
Definition of Done: you receive a real SMS on your own phone, sent entirely through manual AT commands, no application code involved yet.

### Phase 9: ESP32 Firmware, Full Logic
Goal: the ESP32 senses power, pushes status to Firebase, and also watches for and executes pending SMS jobs via the GSM module.
Time estimate: 3 to 4 hrs
Steps:
1. WiFi connect with reconnect handling (WiFi will drop sometimes, don't let the whole thing hang).
2. Read the GPIO pin with debounce (require the state to be stable for around 2 to 3 seconds before treating it as a real change, so a half-second flicker doesn't trigger a false outage).
3. On a real change, write `status` and `last_updated` to that area's node in Firebase using the Firebase ESP32 client library.
4. Separately, poll `commands/{own_area_id}` for `pending: true`. When found, loop through `resident_numbers` (and `staff_number` if it's a fault job) and send each SMS using the AT command sequence proven in Phase 8. Once all sends succeed, set `pending: false`.
Definition of Done: unplugging the physical adapter updates the dashboard within a few seconds, and once the backend queues a job for that area, the ESP32 picks it up and a real SMS arrives on your test phone without you touching anything manually.

### Phase 10: Scale to All 3 Channels
Goal: replicate the working single-channel sensing circuit twice more (the GSM module stays single, shared across all 3 simulated areas).
Time estimate: 1.5 to 2 hrs
Steps:
1. Build 2 more identical sensing circuits on the breadboard, each into its own ESP32 GPIO pin.
2. Extend firmware to read all 3 pins and push to their respective area_ids (`guntur_node1`, `pedaparimi_node1`, `namburu_node1`), and to poll `commands/` for all 3 areas, not just one.
Definition of Done: each of the 3 adapters, when pulled independently, updates only its own area on the dashboard, and any resulting SMS job for that area sends correctly.

### Phase 11: Full Hardware and Software Integration Test
Goal: the entire real system, hardware and software, works together exactly like the mock test did in Phase 5.
Time estimate: 1.5 to 2 hrs
Steps: repeat every test from Phase 5, but by physically pulling adapters instead of using the dashboard's simulate button, and confirming a real SMS arrives each time instead of just checking the logged decision. Remove or hide the simulate button once this passes.
Definition of Done: full real outage-to-SMS flow works for all 3 areas, both message paths, with real hardware and a real GSM-sent SMS every time.

### Phase 12: Demo Prep and Backup Recording
Goal: ready to present, with a fallback if live WiFi or the GSM module misbehaves during evaluation.
Time estimate: 1 to 1.5 hrs
Steps: write a short demo script (which adapter to pull, what to point at on the dashboard, when), record a full run-through on video as a backup, including the SMS arriving on a visible phone screen.
Definition of Done: you have a video of the entire flow working end to end, saved somewhere accessible even without your laptop's WiFi or a live GSM signal at the venue.

---

## 8. Suggested Timeline (5 to 10 hrs/week, 2 to 3 weeks)

- **Week 1:** Phase 0 through 3. Order all hardware (Phase 6) on day 1 regardless. If the SIM800L arrives early, run Phase 8's AT command test in parallel this week, it's the biggest risk item and you want failure/replacement time in hand.
- **Week 2:** Phase 4, 5, then Phase 7, 8 (if not already done), and start Phase 9.
- **Week 3:** Finish Phase 9, then Phase 10 through 12.

This build now runs closer to 23 to 29 hours total against your 15 to 30 hour budget, tighter than the Twilio version but still workable if the GSM bring-up happens early.

---

## 9. Known Risks and Gotchas

- WiFi drops happen, firmware needs reconnect logic or the whole demo can freeze mid-presentation.
- The SIM800L is 2G-only, confirm your SIM and location actually have 2G coverage before relying on it, some carriers have been shutting down 2G in parts of India.
- SIM800L power draw spikes during transmission, a shared or weak supply is the single most common reason these modules "don't work," give it its own dedicated 4V/2A source.
- Use a hardware UART on the ESP32 for the SIM800L, not SoftwareSerial, it's too unreliable at the needed baud rate.
- Firebase free tier is plenty for this scale, no need to worry about limits for a prototype.
- Debounce is not optional, without it a half-second power flicker will look like a full outage and spam your test phone.
- Never commit `.env` or any file containing real phone numbers to GitHub, even a private repo. Double check `.gitignore` is working before the first real commit with credentials.

---

*Sign off: V Sujay Krishna, 3rd Year EEE.*
