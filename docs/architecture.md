# Projection Mapping with SAM

A SvelteKit application for projection mapping using the Segment Anything Model (SAM) via fal.ai.

## Overview

The application runs on a MacBook connected to a projector. A USB webcam captures the projection surface for calibration and segmentation.

- `/projection` — Fullscreen output displayed on projector
- `/control` — Control UI on laptop screen (or phone browser later)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SvelteKit App (ui/)                      │
│                                                                 │
│  /control                         /projection                   │
│  ┌─────────────────────┐         ┌────────────────────────────┐ │
│  │ • Dev/Live toggle   │         │ • Fullscreen canvas        │ │
│  │ • Camera selector   │         │ • Solid color + mask       │ │
│  │ • Trigger calibrate │         │ • Calibration patterns     │ │
│  │ • Preview image     │         │                            │ │
│  │ • Click to refine   │         │                            │ │
│  │ • Confirm masks     │         │                            │ │
│  └─────────────────────┘         └────────────────────────────┘ │
│            │                                │                   │
│            │    Poll /api/state             │                   │
│            ▼                                ▼                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   Server State (in-memory)               │   │
│  │   • Current mode (idle | calibrating | projecting)       │   │
│  │   • Calibration data (homography matrix)                 │   │
│  │   • Active masks (transformed to projector space)        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  API Routes                                                     │
│  ├── GET  /api/state           → current app state              │
│  ├── POST /api/state           → update state (homography, etc) │
│  ├── POST /api/segment         → call fal.ai SAM                │
│  └── POST /api/apply-mask      → transform & store mask         │
│                                                                 │
│  $lib/                                                          │
│  ├── aruco.ts          (ArUco detection via camera server)      │
│  ├── homography.ts     (homography via camera server + utils)   │
│  ├── fal.ts            (fal.ai client wrapper)                  │
│  ├── mask.ts           (dilation, transform, compositing)       │
│  ├── state.svelte.ts   (client-side state with polling)         │
│  └── types.ts          (TypeScript interfaces)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP API
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Camera Server (camera/)                       │
│                    Python + FastAPI + OpenCV                     │
│                                                                 │
│  Endpoints:                                                     │
│  ├── GET  /health              → server status + OpenCV version │
│  ├── POST /detect              → ArUco detection (file upload)  │
│  ├── POST /detect-base64       → ArUco detection (base64 image) │
│  └── POST /homography          → compute homography matrix      │
│                                                                 │
│  Uses opencv-contrib-python for ArUco marker detection          │
│  (DICT_4X4_50 dictionary - markers 0-49, 4x4 bit pattern)       │
└─────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### Server-side OpenCV (Python)

OpenCV runs on a separate Python server, not in the browser.

**Rationale:**
- Browser-based OpenCV.js (~10MB) blocks the main thread during load/initialization
- Standard OpenCV.js builds don't include ArUco (requires contrib modules)
- Python opencv-contrib-python has full ArUco support out of the box
- Server-side processing is more reliable and performant
- Camera server can be extended for other image processing tasks

**Architecture:**
- Camera server runs on `localhost:8000` (FastAPI + uvicorn)
- UI sends images as base64 via HTTP POST
- Server returns detected markers with corner coordinates
- Homography calculation also done server-side

**Result:**
- `/projection` — lightweight, no image processing
- `/control` — sends images to camera server for processing
- Phone control works without downloading large libraries

### Polling (No WebSockets)

Both `/control` and `/projection` poll `GET /api/state` on an interval (~500ms).

**Rationale:**
- Simpler implementation
- State changes are infrequent (calibration, mask updates)
- Avoids WebSocket connection management complexity

### No State Persistence

Calibration data lives in memory only. Lost on server restart.

**Rationale:**
- Calibration is per-session anyway (projector position may change)
- Simplifies implementation
- Can add file-based persistence later if needed

### Dev Mode / Live Mode

The `/control` page supports two image source modes:

- **Dev mode**: Loads fixture images from `static/fixtures/` for testing without hardware
- **Live mode**: Captures from USB webcam via `getUserMedia`

The image source is abstracted—calibration and segmentation logic receives a frame regardless of source. This enables full development and testing without a webcam or projector.

**Fixture images** (resized to ~1990×1328 webcam resolution):
- `calibration_isolated.png` — calibration pattern captured at angle
- `IMG_0819.jpeg` — scene for SAM segmentation testing
- `projector.png` — projection with markers visible
- `webcam.jpg` — raw webcam capture

## State Shape

```typescript
interface AppState {
  mode: 'idle' | 'calibrating' | 'projecting';
  calibration: {
    status: 'none' | 'showing-markers' | 'captured' | 'complete';
    homography?: number[][];  // 3x3 matrix
  };
  projection: {
    color: string;            // e.g., "#ff6b6b"
    masks: TransformedMask[]; // in projector coordinates
  };
}

interface TransformedMask {
  id: string;
  imageData: string;  // base64 PNG in projector coordinates
  bounds: { x: number; y: number; width: number; height: number };
}
```

## Calibration Flow

```
/control (browser)              SvelteKit              Camera Server
──────────────────              ────────               ─────────────
      │                           │                         │
      │ POST /api/state           │                         │
      │ {mode: 'calibrating'}     │                         │
      │──────────────────────────►│                         │
      │                           │  state.calibration.     │
      │                           │  status = 'showing-     │
      │                           │  markers'               │
      │                           │────────────────────────►│ /projection
      │                           │  (via poll)             │ renders 4
      │                           │                         │ ArUco markers
      │                           │                         │
      │ Capture frame (fixture    │                         │
      │ in dev mode, webcam in    │                         │
      │ live mode)                │                         │
      │                           │                         │
      │ POST /detect-base64       │                         │
      │ {image: base64}           │─────────────────────────┼────────────►│
      │                           │                         │             │
      │                           │                         │  ArUco      │
      │                           │                         │  detection  │
      │                           │                         │             │
      │   ◄────────────────────────────────────────────────────────────────
      │   {markers: [{id, corners}, ...]}                   │
      │                           │                         │
      │ POST /homography          │                         │
      │ {camera_points,           │─────────────────────────┼────────────►│
      │  projector_points}        │                         │             │
      │                           │                         │  cv2.find   │
      │                           │                         │  Homography │
      │   ◄────────────────────────────────────────────────────────────────
      │   {matrix: [[...], ...]}  │                         │
      │                           │                         │
      │ POST /api/state           │                         │
      │ {calibration: {           │                         │
      │   status: 'complete',     │                         │
      │   homography: [...]}}     │                         │
      │──────────────────────────►│                         │
      │                           │  Store homography       │
```

## Segmentation Flow

```
/control (browser)              Server                  fal.ai
──────────────────              ──────                  ──────
      │                           │                       │
      │ Capture frame from        │                       │
      │ USB webcam                │                       │
      │                           │                       │
      │ POST /api/segment         │                       │
      │ {image, prompt:           │                       │
      │  "gold letters"}          │                       │
      │──────────────────────────►│                       │
      │                           │ fal.subscribe()       │
      │                           │──────────────────────►│
      │                           │   ◄───────────────────│
      │                           │   {masks}             │
      │   ◄────────────────────────                       │
      │   {masks, bounds}         │                       │
      │                           │                       │
      │ (user reviews, confirms)  │                       │
      │                           │                       │
      │ POST /api/apply-mask      │                       │
      │ {maskData, homography}    │                       │
      │──────────────────────────►│                       │
      │                           │ Transform mask        │
      │                           │ camera→projector      │
      │                           │ Dilate 10%            │
      │                           │ Store in state        │
      │                           │                       │
      │                           │──────────────────────►│ /projection
      │                           │  (via poll)           │ draws mask
```

## File Structure

```
/PomPom
├── ui/                              # SvelteKit frontend
│   ├── src/
│   │   ├── routes/
│   │   │   ├── +page.svelte              # Landing page
│   │   │   ├── control/
│   │   │   │   └── +page.svelte          # Control UI
│   │   │   ├── projection/
│   │   │   │   └── +page.svelte          # Fullscreen projector output
│   │   │   └── api/
│   │   │       └── state/
│   │   │           └── +server.ts        # GET/POST state
│   │   │
│   │   └── lib/
│   │       ├── aruco.ts                  # ArUco detection (calls camera server)
│   │       ├── homography.ts             # Homography (calls camera server)
│   │       ├── state.svelte.ts           # Client state with polling
│   │       ├── types.ts                  # TypeScript interfaces
│   │       └── server/
│   │           └── state.ts              # Server-side state management
│   │
│   ├── static/
│   │   ├── markers/                      # ArUco marker SVGs
│   │   │   ├── marker-0.svg
│   │   │   ├── marker-1.svg
│   │   │   ├── marker-2.svg
│   │   │   └── marker-3.svg
│   │   └── fixtures/                     # Dev mode test images
│   │       ├── calibration_isolated.png
│   │       ├── IMG_0819.jpeg
│   │       ├── projector.png
│   │       └── webcam.jpg
│   │
│   ├── package.json
│   ├── svelte.config.js
│   └── tsconfig.json
│
├── camera/                          # Python camera server
│   ├── server.py                    # FastAPI server with ArUco detection
│   ├── requirements.txt             # opencv-contrib-python, fastapi, uvicorn
│   └── venv/                        # Python virtual environment
│
├── docs/
│   └── architecture.md              # This file
│
└── images/                          # Source images (full resolution)
    ├── calibration_isolated.png
    ├── projector.png
    └── resized/                     # Webcam-resolution versions
```

## Running the Application

### 1. Start the Camera Server

```bash
cd camera
source venv/bin/activate
pip install -r requirements.txt
python server.py
# Runs on http://localhost:8000
```

### 2. Start the UI Dev Server

```bash
cd ui
nvm use 22
npm install
npm run dev
# Runs on http://localhost:5173
```

### 3. Open the Application

- Control UI: http://localhost:5173/control
- Projection: http://localhost:5173/projection (fullscreen on projector)

## Implementation Phases

| Phase | What | Testable Without Hardware? |
|-------|------|---------------------------|
| 1 | SvelteKit scaffold, routes, polling state | Yes |
| 2 | Projection canvas renders color + calibration markers | Yes |
| 3 | Camera server with ArUco detection | Yes |
| 4 | Homography calculation via camera server | Yes |
| 5 | fal.ai integration, segment fixture image | Yes |
| 6 | Mask transformation (camera→projector space) | Yes |
| 7 | Mask dilation (10% buffer) | Yes |
| 8 | Control UI: camera selector, preview, click-to-refine, confirm | Yes |
| 9 | USB webcam capture integration | Needs camera |
| 10 | End-to-end with real projector | Needs hardware |

## Dependencies

### UI (SvelteKit)

```json
{
  "dependencies": {
    "@fal-ai/client": "^1.x",
    "@sveltejs/kit": "^2.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tailwindcss": "^4.x"
  }
}
```

### Camera Server (Python)

```
opencv-contrib-python>=4.8.0
fastapi>=0.104.0
uvicorn>=0.24.0
python-multipart>=0.0.6
numpy>=1.24.0
```

## Future Considerations

### Continuous Calibration

Automatic recalibration via brief marker flashes is not viable—humans perceive high-contrast pattern changes even at 30-50ms, and USB webcams need 66-100ms to reliably capture.

**Alternatives if drift becomes a problem:**
- IR markers + IR camera (invisible to humans, ~$50 in hardware)
- Tiny dim corner markers that blend into content
- Calibrate during scene transitions
- Single calibration per session (usually sufficient for stable setups)

### Phone Control

Phone browser support for `/control` now works without downloading large libraries since all image processing happens on the camera server.
