# Smart Power Management System, AI Prompts

Written for Cursor or VS Code AI, since they can read and write files and run terminal commands themselves. Use one prompt at a time, in order. Review what it builds before moving to the next prompt, later prompts assume earlier files already exist and work.

Keep `project_info.md` in the repo root the whole time. Every prompt below tells the AI to read it first, so you're not re-explaining the project each time.

---

## Setup: paste this first, once, at the start of the project

```
Read docs/project_info.md in this repo fully before doing anything else. This is the
single source of truth for the project, its architecture, data model, and phased
development plan. Confirm you've read and understood it by summarizing the phase
list back to me in one line each, then stop and wait for my next instruction.
Do not write any code yet.
```

---

## Phase 0: Environment and Accounts Setup

```
Referring to Phase 0 in docs/project_info.md, set up the repo structure exactly as
described in section 6 (firmware/, backend/, dashboard/, docs/, .env, .gitignore).
Create a .gitignore that excludes node_modules/, .env, any file matching
*serviceAccount*.json or *credentials*.json, and any firmware config header with
WiFi credentials. Do not create the .env file's contents yet, just create an empty
.env with comments showing which keys will go there (FIREBASE_*), I'll fill in the
real values myself. Initialize git if it isn't already, and make the first commit.
```

Do the actual Firebase project creation yourself in the browser, an AI in your editor can't do that part. Once done, fill the real values into `.env` yourself, never paste real credentials into a chat with the AI.

---

## Phase 1: Firebase Schema Sanity Check

No AI prompt needed here, this is a manual step in the Firebase console: create the `areas`, `residents`, and `commands` nodes matching the schema in section 5 of project_info.md, and manually test flipping a status value.

---

## Phase 2: Web Dashboard

```
Referring to Phase 2 in docs/project_info.md and the data model in section 5, build
the dashboard in dashboard/ using plain HTML, CSS, and JavaScript with the Firebase
JS SDK (not React, keep it framework-free). It should:
- Read the FIREBASE_* config from a config file I'll provide (don't hardcode real
  keys, use placeholders and tell me exactly where to put my real config)
- Show all 3 areas (guntur_node1, pedaparimi_node1, namburu_node1) as live cards,
  green if status is UP, red if DOWN, updating in real time without a page refresh
- Each card has a "Mark as Scheduled Maintenance" button that writes
  maintenance_flag: true to that area
- Each card also has a "Simulate Outage" button, clearly styled differently (e.g.
  a dashed border, labeled "DEV ONLY") that manually flips status to DOWN, for
  testing before hardware exists. Make it easy for me to find and delete this
  later.
Explain where to put my real Firebase config values once you're done.
```

---

## Phase 3: Node.js Backend Listener

```
Referring to Phase 3 in docs/project_info.md, build the backend in backend/ using
Node.js and the Firebase Admin SDK. It should:
- Initialize using a Firebase service account file (tell me exactly what filename
  to save mine as, and confirm it's covered by .gitignore before writing any code
  that reads it)
- Listen for changes to areas/*/status
- On a change to DOWN, check that area's maintenance_flag. If true, log
  "MAINTENANCE decision for [area]". If false, start a 30 second timer, and if
  maintenance_flag is still false when it fires, log "FAULT decision for [area]"
- If status flips back to UP before the timer fires, cancel the timer and log that
  it was cancelled
Don't write to the commands node yet, just get the decision logic right with
console logs first. Set up package.json with a "start" script so I can run this
with npm start.
```

---

## Phase 4: SMS Command Queue

```
Referring to Phase 4 in docs/project_info.md, extend the backend listener from
Phase 3 so that instead of just logging a decision, it writes a full job object to
commands/{area_id} in Firebase, matching the schema in section 5:
- For a MAINTENANCE decision: message_type "MAINTENANCE", resident_message set to
  the maintenance text, resident_numbers pulled from residents/{area_id}, pending
  set to true, created_at set to now
- For a FAULT decision: message_type "FAULT", resident_message as the plain
  outage notice, resident_numbers pulled from residents/{area_id}, staff_message
  and staff_number filled in (staff number comes from a STAFF_PHONE_NUMBER value
  in .env), pending set to true
Wrap the Firebase write in a try/catch that logs failures clearly without crashing
the listener.
```

---

## Phase 5: Full Mock End-to-End Test

No new code needed. Manually run through every scenario listed in Phase 5 of project_info.md using the dashboard's Simulate Outage and Mark as Scheduled Maintenance buttons, confirm the backend logs and the resulting entries under commands/ match every time. If something's off:

```
Here's what happened when I tested [describe the scenario and what went wrong].
Referring to the decision logic in Phase 3 and 4 of docs/project_info.md, find and
fix the issue in backend/.
```

---

## Phase 8: GSM AT Command Test Sketch

This phase is mostly manual (wiring, testing raw AT commands over the serial monitor), but it helps to have a minimal test sketch first:

```
Referring to Phase 8 in docs/project_info.md, write a minimal ESP32 Arduino sketch
in firmware/ (a separate test file, not the main firmware yet) that opens a
hardware UART to the SIM800L at 9600 baud and simply forwards anything I type in
the Arduino serial monitor straight to the SIM800L, and forwards anything the
SIM800L responds with back to the serial monitor. This is just a passthrough
bridge so I can send raw AT commands manually and see the responses, don't add
any logic yet.
```

Use this to manually walk through the AT command sequence in Phase 8 of project_info.md (`AT`, `AT+CSQ`, `AT+CMGF=1`, `AT+CMGS`) before writing any real application logic.

---

## Phase 9: ESP32 Firmware, Full Logic

```
Referring to Phase 7, 8, and 9 in docs/project_info.md, write the full ESP32
firmware in firmware/ (Arduino framework, C++) that:
- Connects to WiFi using credentials from a config header I'll provide (give me
  the exact filename and format, and make sure it's covered by .gitignore)
- Includes automatic WiFi reconnect handling, it should not hang forever if the
  connection drops
- Reads 3 GPIO pins (I'll tell you which pins once I've wired the breadboard),
  one per simulated area (guntur_node1, pedaparimi_node1, namburu_node1)
- Treats LOW as POWER_PRESENT and HIGH as POWER_ABSENT on each pin, per the wiring
  logic in Phase 7 of project_info.md, define these as named constants, not raw
  LOW/HIGH, so the logic is readable
- Requires a pin's state to be stable for 2 to 3 seconds before treating it as a
  real change (debounce), so a brief flicker doesn't trigger a false outage
- On a confirmed real change, writes status and last_updated to that area's node
  in Firebase using the Firebase ESP32 client library
- Separately, polls commands/{area_id} for each of the 3 areas for pending: true,
  and when found, sends SMS to each number in resident_numbers (and staff_number
  if staff_message is present) using the AT command sequence proven working in
  Phase 8, then sets pending: false once every message succeeds
- Reuses the hardware UART bridge logic from the Phase 8 test sketch for talking
  to the SIM800L, but now driven by application logic instead of manual typing
Comment the code clearly since this will also go into my project report.
```

Once you've wired the physical sensing circuit (Phase 7 in project_info.md is a manual hardware build, not something an AI can do for you), come back and tell Cursor which GPIO pins you used so it can finalize the pin mapping in the firmware.

---

## Phase 10 to 12: Scaling, Integration Testing, Demo Prep

These are mostly physical (breadboard work, testing, filming) rather than code generation. If firmware needs adjusting once all 3 channels are wired in:

```
All 3 sensing channels are now wired (pins: [list them]). Referring to Phase 10 in
docs/project_info.md, confirm the firmware in firmware/ correctly maps each pin to
its area_id and correctly polls commands/ for all 3 areas, not just one.
```

For final cleanup before the demo:

```
Referring to Phase 11 and 12 in docs/project_info.md, review dashboard/,
backend/, and firmware/ for anything left over from testing (the Simulate Outage
button, leftover console.logs, TODO comments) and clean it up so the repo is
demo-ready. Don't change any working logic, just remove dev-only scaffolding.
```

---

*Sign off: V Sujay Krishna, 3rd Year EEE.*
