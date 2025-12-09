<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { startPolling, stopPolling, appState, updateState } from '$lib/state.svelte';
	import { detectMarkers, checkServerHealth, type DetectedMarker } from '$lib/aruco';
	import {
		calculateHomography,
		getProjectorMarkerPositions,
		buildPointCorrespondences,
		extractCameraQuad
	} from '$lib/homography';
	import {
		PROJECTOR_WIDTH,
		PROJECTOR_HEIGHT,
		renderProjection,
		loadMarkerImages
	} from '$lib/projection-renderer';
	import { SIMULATION_QUAD, SAM_PROMPTS, SIMULATION_IMAGE_PATH, CAMERA_IMAGE_SIZE } from '$lib/projection-config';
	import { transformMasksToProjector, type ImageSize } from '$lib/mask-transform';
	import type { Quad } from '$lib/projection-config';
	import { generateMasks, loadMaskImage, type GeneratedMask } from '$lib/sam';
	import { generateWallTextureMask, extractRedAsMask } from '$lib/wall-mask';
	import { detectIslands, type IslandDetectionResult } from '$lib/island-detection';
	import { detectPomPoms, type PomPomInfo, type PomPomDetectionResult } from '$lib/pompom-detection';
	import { drawPerspective } from '$lib/perspective-canvas';
	import {
		createFelizNavidadAnimation,
		createPomPomAnimation,
		createWallTextureAnimation,
		createIslandPhotosAnimation,
		createSpotlightAnimation,
		createHappyBirthdayAnimation,
		createAnimationClock,
		createClockProvider,
		setPhotoPaths,
		LETTER_BACKGROUND_COLOR,
		LETTER_TEXT_COLOR,
		LETTER_FONT,
		type Animation,
		type AnimationRenderState,
		type IslandPhoto,
		type IslandPhotosAnimation,
		type IslandLetter,
		type HappyBirthdayAnimation,
		type SpotlightInfo,
		type SparkParticle,
		type SpotlightAnimation,
		type ClockProvider
	} from '$lib/animations';
	import { PROJECTOR_WIDTH as PROJ_WIDTH, PROJECTOR_HEIGHT as PROJ_HEIGHT } from '$lib/projection-config';

	// Canvas element reference
	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;

	// Offscreen canvas for projection content
	let projectionCanvas: HTMLCanvasElement;
	let projectionCtx: CanvasRenderingContext2D | null = null;

	// Loaded images
	let wallImage: HTMLImageElement | null = null;
	let markerImages: HTMLImageElement[] = [];
	let transformedMasks: HTMLCanvasElement[] = [];

	// Animation instances (keyed by mask ID)
	let animations: Map<string, Animation> = new Map();

	// Current animation render states (keyed by mask ID)
	let animationStates: Map<string, AnimationRenderState> = new Map([
		['feliz-navidad', { opacity: 1, color: '#FFD700' }],
		['pom-pom', { opacity: 0, color: '#FFD700' }], // Hidden - spotlights handle visualization
		['wall-texture', { opacity: 1, color: '#FF0000' }]
	]);

	// Detection state
	let isCapturing = $state(false);
	let detectedMarkers = $state<DetectedMarker[]>([]);
	let detectionError = $state<string | null>(null);
	let calibrationComplete = $state(false);

	// Camera server state
	let serverStatus = $state<'checking' | 'ready' | 'error'>('checking');
	let serverVersion = $state<string | null>(null);
	let serverError = $state<string | null>(null);

	// Dev/Live mode state
	let imageMode = $state<'dev' | 'live'>('dev');
	let webcamStream = $state<MediaStream | null>(null);
	let videoElement: HTMLVideoElement;
	let availableCameras = $state<MediaDeviceInfo[]>([]);
	let selectedCameraId = $state<string>('');
	let webcamError = $state<string | null>(null);
	let liveFrame = $state<ImageData | null>(null);

	// Image save state
	let isSaving = $state(false);
	let saveMessage = $state<string | null>(null);

	/**
	 * Convert ImageData to a base64 data URL
	 */
	function imageDataToBase64(imageData: ImageData): string {
		const canvas = document.createElement('canvas');
		canvas.width = imageData.width;
		canvas.height = imageData.height;
		const tempCtx = canvas.getContext('2d')!;
		tempCtx.putImageData(imageData, 0, 0);
		return canvas.toDataURL('image/png');
	}

	// Mask generation state
	let isGenerating = $state(false);
	let generationError = $state<string | null>(null);
	let generatedMasks = $state<GeneratedMask[]>([]);

	// Wall texture mask state
	let isGeneratingWall = $state(false);
	let wallMaskError = $state<string | null>(null);
	let wallMaskUrl = $state<string | null>(null);

	// Wall mask history state
	interface WallMaskHistoryEntry {
		id: string;
		timestamp: string;
		hasOutput: boolean;
	}
	let wallMaskHistory = $state<WallMaskHistoryEntry[]>([]);
	let isLoadingHistory = $state(false);
	let isLoadingHistoryMask = $state(false);

	// Island detection state
	let isDetectingIslands = $state(false);
	let islandDetectionError = $state<string | null>(null);
	let islandDetectionResult = $state<IslandDetectionResult | null>(null);

	// Island photos animation state
	let islandPhotosAnim: IslandPhotosAnimation | null = null;
	let islandPhotos = $state<IslandPhoto[]>([]);
	let islandsMaskCanvas = $state<HTMLCanvasElement | null>(null);
	// Play/pause state derived from shared state (default: true for photos)
	let islandPhotosPlaying = $derived(appState.current.projection.islandPhotosPlaying !== false);

	// Happy Birthday animation state
	let happyBirthdayAnim: HappyBirthdayAnimation | null = null;
	let happyBirthdayLetters = $state<IslandLetter[]>([]);
	// Play/pause state derived from shared state (default: false for birthday)
	let happyBirthdayPlaying = $derived(appState.current.projection.happyBirthdayPlaying === true);

	// Content refresh state
	let isRefreshingContent = $state(false);
	let contentRefreshMessage = $state<string | null>(null);
	let contentPhotoCount = $state<number>(0);

	// Pom-pom detection state
	let isDetectingPomPoms = $state(false);
	let pomPomDetectionError = $state<string | null>(null);
	let pomPomDetectionResult = $state<PomPomDetectionResult | null>(null);

	// Spotlight animation state
	let spotlightAnim: SpotlightAnimation | null = null;
	let spotlights = $state<SpotlightInfo[]>([]);
	let particles = $state<SparkParticle[]>([]);

	// Shared clock provider for synchronized animations
	let clockProvider: ClockProvider | null = null;

	// Per-mask enabled state and regeneration tracking
	let enabledMasks = $state<Set<string>>(new Set(['pom-pom', 'wall-texture']));
	let regeneratingMask = $state<string | null>(null);

	// Animations enabled state (derived from shared state)
	let animationsEnabled = $derived(appState.current.projection.animationsEnabled !== false);

	// Toggle animations on/off
	async function toggleAnimations() {
		const newValue = !animationsEnabled;
		await updateState({
			projection: {
				...appState.current.projection,
				animationsEnabled: newValue
			}
		});
	}

	// Simulation configuration
	const WALL_IMAGE_SRC = '/fixtures/webcam_capture.png';

	/**
	 * Get the current camera quad and image size based on mode.
	 * In live mode, uses the calibrated quad from state.
	 * In dev mode, uses the hardcoded SIMULATION_QUAD.
	 */
	function getCurrentQuadAndSize(): { quad: Quad; imageSize: ImageSize } {
		if (imageMode === 'live' && appState.current.calibration.cameraQuad) {
			const cq = appState.current.calibration.cameraQuad;
			return {
				quad: {
					topLeft: cq.topLeft,
					topRight: cq.topRight,
					bottomLeft: cq.bottomLeft,
					bottomRight: cq.bottomRight
				},
				imageSize: {
					width: cq.imageWidth,
					height: cq.imageHeight
				}
			};
		}
		// Fallback to simulation quad
		return {
			quad: SIMULATION_QUAD,
			imageSize: CAMERA_IMAGE_SIZE
		};
	}

	/**
	 * Svelte action to draw a scaled canvas to a preview element
	 */
	function drawScaledCanvas(node: HTMLCanvasElement, sourceCanvas: HTMLCanvasElement) {
		const ctx = node.getContext('2d');
		if (ctx && sourceCanvas) {
			ctx.drawImage(sourceCanvas, 0, 0, node.width, node.height);
		}
		return {
			update(newSource: HTMLCanvasElement) {
				if (ctx && newSource) {
					ctx.clearRect(0, 0, node.width, node.height);
					ctx.drawImage(newSource, 0, 0, node.width, node.height);
				}
			}
		};
	}

	onMount(async () => {
		startPolling(500);
		checkServer();

		// Get canvas context (only if canvas exists - may not in live mode)
		if (canvas) {
			ctx = canvas.getContext('2d');
		}

		// Load images
		await loadImages();

		// Create animations with update callbacks
		animations.set('feliz-navidad', createFelizNavidadAnimation((state) => {
			animationStates.set('feliz-navidad', state);
			renderSimulation();
		}));

		animations.set('pom-pom', createPomPomAnimation((state) => {
			animationStates.set('pom-pom', state);
			renderSimulation();
		}));

		animations.set('wall-texture', createWallTextureAnimation((state) => {
			animationStates.set('wall-texture', state);
			renderSimulation();
		}));

		// Create island photos animation
		islandPhotosAnim = createIslandPhotosAnimation((photos) => {
			islandPhotos = photos;
			renderSimulation();
		});

		// Create happy birthday animation
		happyBirthdayAnim = createHappyBirthdayAnimation((letters) => {
			happyBirthdayLetters = letters;
			renderSimulation();
		});

		// Auto-refresh content photos on load
		refreshContent();

		// Create spotlight animation
		spotlightAnim = createSpotlightAnimation((spots) => {
			spotlights = spots;
			// Get particles from the animation
			if (spotlightAnim) {
				particles = spotlightAnim.getParticles();
			}
			renderSimulation();
		}, PROJ_WIDTH, PROJ_HEIGHT);

		// Set up color sampler that reads from the wall image
		spotlightAnim.setColorSampler((x, y) => {
			if (!wallImage) return null;
			// The spotlight coordinates are in projector space
			// We need to map them back to the wall image space via the SIMULATION_QUAD
			// For now, sample directly from the wall image at the corresponding position
			const tempCanvas = document.createElement('canvas');
			tempCanvas.width = wallImage.width;
			tempCanvas.height = wallImage.height;
			const tempCtx = tempCanvas.getContext('2d');
			if (!tempCtx) return null;
			tempCtx.drawImage(wallImage, 0, 0);

			// Map projector coords to image coords using current quad
			// Simple approach: use bilinear interpolation within the quad
			const { quad: q } = getCurrentQuadAndSize();
			const u = x / PROJ_WIDTH;
			const v = y / PROJ_HEIGHT;

			// Bilinear interpolation of quad corners
			const topX = q.topLeft.x + (q.topRight.x - q.topLeft.x) * u;
			const topY = q.topLeft.y + (q.topRight.y - q.topLeft.y) * u;
			const bottomX = q.bottomLeft.x + (q.bottomRight.x - q.bottomLeft.x) * u;
			const bottomY = q.bottomLeft.y + (q.bottomRight.y - q.bottomLeft.y) * u;
			const imgX = Math.round(topX + (bottomX - topX) * v);
			const imgY = Math.round(topY + (bottomY - topY) * v);

			// Get pixel color
			try {
				const imageData = tempCtx.getImageData(imgX, imgY, 1, 1);
				const [r, g, b] = imageData.data;
				return `rgb(${r}, ${g}, ${b})`;
			} catch {
				return null;
			}
		});

		// Initial render
		renderSimulation();

		// Fetch wall mask history
		fetchWallMaskHistory();
	});

	onDestroy(() => {
		stopPolling();
		// Stop all animations
		animations.forEach(anim => anim.stop());
		islandPhotosAnim?.stop();
		happyBirthdayAnim?.stop();
		spotlightAnim?.stop();
		// Stop webcam
		stopWebcam();
	});

	// Webcam functions
	async function enumerateCameras() {
		try {
			// Request permission first to get labeled devices
			const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
			tempStream.getTracks().forEach(track => track.stop());

			const devices = await navigator.mediaDevices.enumerateDevices();
			availableCameras = devices.filter(d => d.kind === 'videoinput');
			if (availableCameras.length > 0 && !selectedCameraId) {
				selectedCameraId = availableCameras[0].deviceId;
			}
		} catch (err) {
			webcamError = err instanceof Error ? err.message : 'Failed to enumerate cameras';
		}
	}

	async function startWebcam() {
		webcamError = null;
		try {
			// Stop existing stream if any
			stopWebcam();

			const constraints: MediaStreamConstraints = {
				video: selectedCameraId
					? {
							deviceId: { exact: selectedCameraId },
							width: { ideal: 4096 },
							height: { ideal: 2160 }
						}
					: {
							width: { ideal: 4096 },
							height: { ideal: 2160 }
						}
			};

			webcamStream = await navigator.mediaDevices.getUserMedia(constraints);

			// Wait for video element to be ready
			if (videoElement) {
				videoElement.srcObject = webcamStream;
				await videoElement.play();
			}
		} catch (err) {
			webcamError = err instanceof Error ? err.message : 'Failed to start webcam';
			webcamStream = null;
		}
	}

	function stopWebcam() {
		if (webcamStream) {
			webcamStream.getTracks().forEach(track => track.stop());
			webcamStream = null;
		}
		if (videoElement) {
			videoElement.srcObject = null;
		}
		liveFrame = null;
	}

	function captureWebcamFrame(): ImageData | null {
		if (!videoElement || !webcamStream || videoElement.readyState < 2) {
			return null;
		}

		// Create temporary canvas to capture frame
		const tempCanvas = document.createElement('canvas');
		tempCanvas.width = videoElement.videoWidth;
		tempCanvas.height = videoElement.videoHeight;
		const tempCtx = tempCanvas.getContext('2d');
		if (!tempCtx) return null;

		tempCtx.drawImage(videoElement, 0, 0);
		return tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
	}

	// Handle mode switch
	async function switchToLiveMode() {
		imageMode = 'live';
		await enumerateCameras();
		if (availableCameras.length > 0) {
			await startWebcam();
		}
	}

	function switchToDevMode() {
		imageMode = 'dev';
		stopWebcam();
		renderSimulation();
	}

	// Handle camera selection change
	async function onCameraChange() {
		if (imageMode === 'live' && selectedCameraId) {
			await startWebcam();
		}
	}

	// Save webcam image to disk
	async function saveWebcamImage() {
		if (imageMode !== 'live' || !videoElement || !webcamStream) {
			saveMessage = 'Webcam not active';
			return;
		}

		isSaving = true;
		saveMessage = null;

		try {
			// Capture frame to canvas and convert to base64
			const tempCanvas = document.createElement('canvas');
			tempCanvas.width = videoElement.videoWidth;
			tempCanvas.height = videoElement.videoHeight;
			const tempCtx = tempCanvas.getContext('2d');
			if (!tempCtx) {
				throw new Error('Failed to get canvas context');
			}

			tempCtx.drawImage(videoElement, 0, 0);
			const imageData = tempCanvas.toDataURL('image/png');

			// Send to server to save
			const response = await fetch('/api/save-image', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ imageData })
			});

			const result = await response.json();

			if (result.success) {
				saveMessage = `Saved: ${result.filename}`;
			} else {
				saveMessage = `Error: ${result.error}`;
			}
		} catch (err) {
			saveMessage = err instanceof Error ? err.message : 'Failed to save image';
		} finally {
			isSaving = false;
			// Clear message after 3 seconds
			setTimeout(() => {
				saveMessage = null;
			}, 3000);
		}
	}

	async function checkServer() {
		serverStatus = 'checking';
		const result = await checkServerHealth();
		if (result.ok) {
			serverStatus = 'ready';
			serverVersion = result.version || null;
			serverError = null;
		} else {
			serverStatus = 'error';
			serverVersion = null;
			serverError = result.error || 'Connection failed';
		}
	}

	async function loadImages() {
		// Load wall image
		wallImage = await loadImage(WALL_IMAGE_SRC);

		// Set canvas size to match wall image (only if canvas exists)
		if (canvas) {
			canvas.width = wallImage.width;
			canvas.height = wallImage.height;
		}

		// Create offscreen projection canvas (same size as projector output)
		projectionCanvas = document.createElement('canvas');
		projectionCanvas.width = PROJECTOR_WIDTH;
		projectionCanvas.height = PROJECTOR_HEIGHT;
		projectionCtx = projectionCanvas.getContext('2d');

		// Load marker images (using shared loader)
		markerImages = await loadMarkerImages();

		// Load existing masks from shared state if available
		await loadMasksFromState();
	}

	function loadImage(src: string): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = reject;
			img.src = src;
		});
	}

	/**
	 * Render the simulation to the canvas
	 * Uses the shared projection renderer to get the exact same output as /projection
	 */
	function renderSimulation() {
		// Skip rendering in live mode - video element handles display
		if (imageMode === 'live') return;
		if (!ctx || !wallImage || !projectionCtx) return;

		const q = SIMULATION_QUAD;

		// 1. Draw wall background with darkening (simulates dark room)
		ctx.save();
		ctx.drawImage(wallImage, 0, 0);
		// Darken the image to simulate projecting in a dark room
		ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; // 60% darkening
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.restore();

		// 2. Render projection content to offscreen canvas (using shared renderer)
		// Filter masks based on enabled state and get corresponding animation states
		const activeMasks: HTMLCanvasElement[] = [];
		const activeAnimStates: AnimationRenderState[] = [];
		for (let i = 0; i < generatedMasks.length; i++) {
			const mask = generatedMasks[i];
			if (mask && enabledMasks.has(mask.id) && transformedMasks[i]) {
				activeMasks.push(transformedMasks[i]);
				activeAnimStates.push(animationStates.get(mask.id) || { opacity: 1, color: '#FFD700' });
			}
		}
		renderProjection(
			projectionCtx,
			appState.current,
			markerImages,
			activeMasks,
			activeAnimStates,
			islandPhotos,
			islandsMaskCanvas || undefined,
			spotlights,
			particles,
			happyBirthdayLetters
		);

		// 3. Draw projection onto wall using WebGL perspective transform
		// Use "screen" blend mode - black has no effect, colors add light
		ctx.save();
		ctx.globalCompositeOperation = 'screen';
		drawPerspective(ctx, projectionCanvas, q);
		ctx.restore();

		// 4. Draw detected markers if any (green circles)
		if (detectedMarkers.length > 0) {
			ctx.strokeStyle = '#00ff00';
			ctx.lineWidth = 3;
			for (const marker of detectedMarkers) {
				// Draw circle at marker center
				const cx = (marker.corners[0].x + marker.corners[2].x) / 2;
				const cy = (marker.corners[0].y + marker.corners[2].y) / 2;
				ctx.beginPath();
				ctx.arc(cx, cy, 20, 0, Math.PI * 2);
				ctx.stroke();

				// Draw marker ID
				ctx.fillStyle = '#00ff00';
				ctx.font = '16px monospace';
				ctx.fillText(`ID:${marker.id}`, cx + 25, cy + 5);
			}
		}
	}

	// Start/stop animations based on mode, animationsEnabled, AND mask enabled state
	$effect(() => {
		// Track only the specific state we care about
		const mode = appState.current.mode;
		const animEnabled = appState.current.projection.animationsEnabled !== false;
		const pomPomsLength = appState.current.projection.pomPoms?.length ?? 0;
		const currentEnabledMasks = enabledMasks;
		const currentIslandsMaskCanvas = islandsMaskCanvas;
		const photosPlaying = islandPhotosPlaying;
		const birthdayPlaying = happyBirthdayPlaying;

		// Use untrack for the actual animation control to avoid creating more dependencies
		untrack(() => {
			const isProjecting = mode === 'projecting';

			// Each mask animation runs only if projecting AND animations enabled AND its mask is enabled
			animations.forEach((anim, maskId) => {
				const shouldRun = isProjecting && animEnabled && currentEnabledMasks.has(maskId);
				if (shouldRun) {
					anim.start();
				} else {
					anim.stop();
				}
			});

			// Spotlight animation runs if projecting AND animations enabled AND pom-poms are set
			if (spotlightAnim) {
				const hasPomPoms = pomPomsLength > 0;
				if (isProjecting && animEnabled && hasPomPoms) {
					spotlightAnim.start();
				} else {
					spotlightAnim.stop();
				}
			}

			// Island photos animation runs if animations enabled AND islands are set AND playing
			// (doesn't require projecting mode - allows preview on control page)
			if (islandPhotosAnim) {
				// Check if islands have been detected (islandsMaskCanvas is set)
				if (animEnabled && currentIslandsMaskCanvas && photosPlaying) {
					islandPhotosAnim.start();
				} else {
					islandPhotosAnim.stop();
				}
			}

			// Happy Birthday animation runs if animations enabled AND islands are set AND playing
			// (doesn't require projecting mode - allows preview on control page)
			if (happyBirthdayAnim) {
				if (animEnabled && currentIslandsMaskCanvas && birthdayPlaying) {
					happyBirthdayAnim.start();
				} else {
					happyBirthdayAnim.stop();
				}
			}
		});
	});

	// Re-render when state changes (only in dev mode)
	$effect(() => {
		// Track relevant state changes that should trigger re-render
		const _ = appState.current.calibration.status;
		const __ = detectedMarkers;
		const ___ = imageMode; // Also track mode changes

		// Use untrack to prevent renderSimulation from adding more dependencies
		untrack(() => renderSimulation());
	});

	async function startCalibration() {
		detectedMarkers = [];
		detectionError = null;
		calibrationComplete = false;

		await updateState({
			mode: 'calibrating',
			calibration: { status: 'showing-markers' }
		});
	}

	async function stopCalibration() {
		detectedMarkers = [];
		detectionError = null;
		calibrationComplete = false;

		await updateState({
			mode: 'idle',
			calibration: { status: 'none' }
		});
	}

	async function captureAndDetect() {
		isCapturing = true;
		detectionError = null;

		try {
			let imageData: ImageData;

			if (imageMode === 'live') {
				// Capture frame from webcam
				const frame = captureWebcamFrame();
				if (!frame) {
					detectionError = 'Failed to capture webcam frame. Is the camera ready?';
					return;
				}
				imageData = frame;
				liveFrame = frame; // Store for display
			} else {
				// Get image data from the simulation canvas (dev mode)
				imageData = ctx!.getImageData(0, 0, canvas.width, canvas.height);
			}

			// Run ArUco detection via server
			const result = await detectMarkers(imageData);
			detectedMarkers = result.markers;

			// Re-render to show detected markers (dev mode only)
			if (imageMode === 'dev') {
				renderSimulation();
			}

			if (detectedMarkers.length === 0) {
				detectionError = result.error || 'No markers detected';
				return;
			}

			// Check if we found all 4 markers
			const foundIds = new Set(detectedMarkers.map((m) => m.id));
			const requiredIds = [0, 1, 2, 3];
			const missing = requiredIds.filter((id) => !foundIds.has(id));

			if (missing.length > 0) {
				detectionError = `Missing markers: ${missing.join(', ')}`;
				return;
			}

			// All 4 markers found - calculate homography
			await calculateAndStoreHomography(imageData.width, imageData.height);
		} catch (err) {
			detectionError = err instanceof Error ? err.message : 'Detection failed';
		} finally {
			isCapturing = false;
		}
	}

	async function calculateAndStoreHomography(imageWidth: number, imageHeight: number) {
		// Get known projector positions
		const projectorPositions = getProjectorMarkerPositions(PROJECTOR_WIDTH, PROJECTOR_HEIGHT);

		// Build point correspondences
		const { cameraPoints, projectorPoints } = buildPointCorrespondences(
			detectedMarkers,
			projectorPositions
		);

		// Calculate homography
		const result = await calculateHomography(cameraPoints, projectorPoints);

		if (!result.success) {
			detectionError = result.error || 'Homography calculation failed';
			return;
		}

		// Extract camera quad from detected markers
		const quad = extractCameraQuad(detectedMarkers);
		if (!quad) {
			detectionError = 'Failed to extract camera quad from markers';
			return;
		}

		// Store in app state (including camera quad with image dimensions)
		await updateState({
			calibration: {
				status: 'complete',
				homography: result.matrix,
				cameraQuad: {
					...quad,
					imageWidth,
					imageHeight
				}
			}
		});

		calibrationComplete = true;
		console.log(`Calibration complete. Camera quad stored for ${imageWidth}x${imageHeight} image`);
	}

	function sortedMarkers(markers: DetectedMarker[]): DetectedMarker[] {
		return [...markers].sort((a, b) => a.id - b.id);
	}

	async function startProjecting() {
		// Clear detected markers so green circles stop showing
		detectedMarkers = [];

		// Create a new animation clock for synchronized animations
		const previousSequence = appState.current.animationClock?.sequenceNumber ?? 0;
		const animationClock = createAnimationClock(previousSequence);
		clockProvider = createClockProvider(animationClock);

		console.log(`[control] Animation clock created: seed=${animationClock.seed}, seq=${animationClock.sequenceNumber}`);

		// Set the clock provider on animations that support it
		if (spotlightAnim) {
			spotlightAnim.setClockProvider(clockProvider);
		}
		if (islandPhotosAnim) {
			islandPhotosAnim.setClockProvider(clockProvider);
		}
		if (happyBirthdayAnim) {
			happyBirthdayAnim.setClockProvider(clockProvider);
		}

		// Update state with mode and the new animation clock
		await updateState({
			mode: 'projecting',
			animationClock
		});
	}

	async function stopProjecting() {
		await updateState({
			mode: 'idle'
		});
	}

	/**
	 * Toggle a mask's enabled state - persists to shared state
	 */
	async function toggleMask(maskId: string) {
		// Update local state for immediate UI feedback
		const newSet = new Set(enabledMasks);
		if (newSet.has(maskId)) {
			newSet.delete(maskId);
		} else {
			newSet.add(maskId);
		}
		enabledMasks = newSet;
		renderSimulation();

		// Persist to shared state so /projection sees the change
		const masks = appState.current.projection.masks.map(m =>
			m.id === maskId ? { ...m, enabled: newSet.has(maskId) } : m
		);
		await updateState({
			projection: { ...appState.current.projection, masks }
		});
	}

	/**
	 * Regenerate a specific mask
	 */
	async function regenerateMask(maskId: string) {
		regeneratingMask = maskId;

		try {
			if (maskId === 'wall-texture') {
				await generateWallMask();
			} else {
				// Find the prompt for this mask
				const promptConfig = SAM_PROMPTS.find(p => p.id === maskId);
				if (!promptConfig) {
					throw new Error(`Unknown mask ID: ${maskId}`);
				}

				// Generate single mask via SAM
				const imageDataUrl = await loadImageAsDataUrl(SIMULATION_IMAGE_PATH);
				const results = await generateMasks(SIMULATION_IMAGE_PATH, [promptConfig]);

				if (results.length === 0) {
					throw new Error(`No mask generated for "${promptConfig.prompt}"`);
				}

				// Load and transform the mask
				const img = await loadMaskImage(results[0].maskUrl);
				const { quad, imageSize } = getCurrentQuadAndSize();
				const transformed = transformMasksToProjector([img], quad, imageSize)[0];

				// Update this specific mask in state
				const maskData = {
					id: maskId,
					imageData: transformed.toDataURL('image/png'),
					bounds: { x: 0, y: 0, width: transformed.width, height: transformed.height }
				};

				const existingMasks = appState.current.projection.masks.filter(m => m.id !== maskId);
				await updateState({
					projection: {
						...appState.current.projection,
						masks: [...existingMasks, maskData]
					}
				});

				// Reload to update UI
				await loadMasksFromState();
			}
		} catch (err) {
			console.error(`Failed to regenerate mask ${maskId}:`, err);
			generationError = err instanceof Error ? err.message : 'Regeneration failed';
		} finally {
			regeneratingMask = null;
		}
	}

	/**
	 * Delete a specific mask
	 */
	async function deleteMask(maskId: string) {
		const existingMasks = appState.current.projection.masks.filter(m => m.id !== maskId);
		await updateState({
			projection: {
				...appState.current.projection,
				masks: existingMasks
			}
		});
		await loadMasksFromState();
	}

	/**
	 * Load an image URL as base64 data URL
	 */
	async function loadImageAsDataUrl(url: string): Promise<string> {
		const response = await fetch(url);
		const blob = await response.blob();
		return new Promise((resolve) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.readAsDataURL(blob);
		});
	}

	/**
	 * Generate wall texture mask using Gemini nano-banana-pro
	 */
	async function generateWallMask() {
		isGeneratingWall = true;
		wallMaskError = null;

		try {
			console.log('Generating wall texture mask...');

			let imageDataUrl: string;
			let sourceWidth: number;
			let sourceHeight: number;

			if (imageMode === 'live') {
				// Capture a fresh frame from webcam for best results
				const freshFrame = captureWebcamFrame();
				if (!freshFrame) {
					throw new Error('Failed to capture webcam frame. Is the camera ready?');
				}
				liveFrame = freshFrame; // Update stored frame too
				imageDataUrl = imageDataToBase64(freshFrame);
				sourceWidth = freshFrame.width;
				sourceHeight = freshFrame.height;
				console.log(`Using fresh webcam frame for wall mask generation (${sourceWidth}x${sourceHeight})`);
			} else {
				// Load the simulation/fixture image as base64
				const response = await fetch(SIMULATION_IMAGE_PATH);
				const blob = await response.blob();
				imageDataUrl = await new Promise<string>((resolve) => {
					const reader = new FileReader();
					reader.onload = () => resolve(reader.result as string);
					reader.readAsDataURL(blob);
				});
				// For fixture image, use the known dimensions from config
				sourceWidth = CAMERA_IMAGE_SIZE.width;
				sourceHeight = CAMERA_IMAGE_SIZE.height;
				console.log(`Using fixture image for wall mask generation (${sourceWidth}x${sourceHeight})`);
			}

			// Generate wall mask (calls API, extracts red as mask)
			// Pass dimensions so API can use correct aspect ratio
			const { mask, editedImageUrl } = await generateWallTextureMask(imageDataUrl, sourceWidth, sourceHeight);
			wallMaskUrl = editedImageUrl;

			console.log('Wall mask generated, transforming to projector space...');

			// Transform to projector space (same as other masks)
			const { quad, imageSize } = getCurrentQuadAndSize();
			const transformedWallMask = transformMasksToProjector([mask as unknown as HTMLImageElement], quad, imageSize)[0];

			// Add to existing masks
			const wallMaskData = {
				id: 'wall-texture',
				imageData: transformedWallMask.toDataURL('image/png'),
				bounds: { x: 0, y: 0, width: transformedWallMask.width, height: transformedWallMask.height },
				enabled: true
			};

			// Update shared state with new mask added
			const existingMasks = appState.current.projection.masks.filter(m => m.id !== 'wall-texture');
			await updateState({
				projection: {
					...appState.current.projection,
					masks: [...existingMasks, wallMaskData]
				}
			});

			// Reload masks from state to update UI
			await loadMasksFromState();

			console.log('Wall texture mask added successfully');

			// Refresh history after generating new mask
			await fetchWallMaskHistory();
		} catch (err) {
			wallMaskError = err instanceof Error ? err.message : 'Wall mask generation failed';
			console.error('Wall mask generation error:', err);
		} finally {
			isGeneratingWall = false;
		}
	}

	/**
	 * Fetch wall mask generation history (last 10)
	 */
	async function fetchWallMaskHistory() {
		isLoadingHistory = true;
		try {
			const response = await fetch('/api/wall-mask-history');
			const data = await response.json();
			wallMaskHistory = data.entries || [];
		} catch (err) {
			console.error('Failed to fetch wall mask history:', err);
			wallMaskHistory = [];
		} finally {
			isLoadingHistory = false;
		}
	}

	/**
	 * Load a historical wall mask by ID
	 */
	async function loadHistoricalWallMask(id: string) {
		isLoadingHistoryMask = true;
		wallMaskError = null;

		try {
			console.log('Loading historical wall mask:', id);

			// Fetch the edited image from the API (this is the fal.ai output with red painted areas)
			const response = await fetch('/api/wall-mask-history', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});

			if (!response.ok) {
				throw new Error('Failed to load mask');
			}

			const data = await response.json();
			const editedImageUrl = data.imageUrl;

			console.log('Historical image loaded, extracting red mask...');

			// Extract red pixels as B&W mask (same as generateWallTextureMask does)
			const maskCanvas = await extractRedAsMask(editedImageUrl);

			console.log('Red mask extracted, transforming to projector space...');

			// Transform to projector space (same as other masks)
			const { quad, imageSize } = getCurrentQuadAndSize();
			const transformedWallMask = transformMasksToProjector([maskCanvas as unknown as HTMLImageElement], quad, imageSize)[0];

			// Add to existing masks
			const wallMaskData = {
				id: 'wall-texture',
				imageData: transformedWallMask.toDataURL('image/png'),
				bounds: { x: 0, y: 0, width: transformedWallMask.width, height: transformedWallMask.height },
				enabled: true
			};

			// Update shared state with new mask added
			const existingMasks = appState.current.projection.masks.filter(m => m.id !== 'wall-texture');
			await updateState({
				projection: {
					...appState.current.projection,
					masks: [...existingMasks, wallMaskData]
				}
			});

			// Reload masks from state to update UI
			await loadMasksFromState();

			console.log('Historical wall texture mask loaded successfully');
		} catch (err) {
			wallMaskError = err instanceof Error ? err.message : 'Failed to load historical mask';
			console.error('Historical mask load error:', err);
		} finally {
			isLoadingHistoryMask = false;
		}
	}

	/**
	 * Detect islands in the current wall-texture mask
	 * Splits into islands/land/water sub-masks
	 */
	async function detectIslandsFromWallMask() {
		isDetectingIslands = true;
		islandDetectionError = null;
		islandDetectionResult = null;

		try {
			// Find the wall-texture mask in state
			const wallMask = appState.current.projection.masks.find(m => m.id === 'wall-texture');
			if (!wallMask) {
				throw new Error('No wall-texture mask found. Generate one first.');
			}

			console.log('Detecting islands in wall-texture mask...');

			// Convert base64 to canvas for processing
			const maskCanvas = await base64ToCanvas(
				wallMask.imageData,
				wallMask.bounds.width,
				wallMask.bounds.height
			);

			// Run island detection
			const result = detectIslands(maskCanvas);
			islandDetectionResult = result;

			console.log('Island detection complete:', {
				islandCount: result.stats.islandCount,
				islandPixels: result.stats.islandPixels,
				landPixels: result.stats.landPixels,
				waterPixels: result.stats.waterPixels
			});

			// Get island components for photo animation
			const islandComponents = result.stats.components.filter(c => c.isIsland);

			// Update the wall-texture mask with sub-masks
			// Keep the mask enabled so user can verify alignment
			const updatedMasks = appState.current.projection.masks.map(m => {
				if (m.id === 'wall-texture') {
					return {
						...m,
						// Keep enabled state as-is so user can toggle and verify alignment
						subMasks: {
							islands: result.islands.toDataURL('image/png'),
							land: result.land.toDataURL('image/png'),
							water: result.water.toDataURL('image/png'),
							islandComponents // Store for projection page
						}
					};
				}
				return m;
			});

			// Keep local enabled state as-is (don't auto-disable wall-texture)

			await updateState({
				projection: { ...appState.current.projection, masks: updatedMasks }
			});

			// Save the islands mask canvas for rendering
			islandsMaskCanvas = result.islands;

			// Pass island info to animations and start them if animations are enabled
			// (islandComponents was already computed above for subMasks)
			if (islandPhotosAnim) {
				islandPhotosAnim.setIslands(islandComponents);
				if (appState.current.projection.animationsEnabled !== false && appState.current.mode === 'projecting' && islandPhotosPlaying) {
					islandPhotosAnim.start();
				}
			}

			if (happyBirthdayAnim) {
				happyBirthdayAnim.setIslands(islandComponents);
				if (appState.current.projection.animationsEnabled !== false && appState.current.mode === 'projecting' && happyBirthdayPlaying) {
					happyBirthdayAnim.start();
				}
			}

			console.log('Sub-masks saved to state, animation started');
		} catch (err) {
			islandDetectionError = err instanceof Error ? err.message : 'Island detection failed';
			console.error('Island detection error:', err);
		} finally {
			isDetectingIslands = false;
		}
	}

	/**
	 * Refresh content photos from the /static/content/ directory
	 */
	async function refreshContent() {
		isRefreshingContent = true;
		contentRefreshMessage = null;

		try {
			const response = await fetch('/api/content-list');
			const data = await response.json();

			if (data.error) {
				throw new Error(data.error);
			}

			const images = data.images as string[];
			if (images.length === 0) {
				contentRefreshMessage = 'No images found in static/content/';
				return;
			}

			// Update the photo paths in the animation module
			setPhotoPaths(images);
			contentPhotoCount = images.length;
			contentRefreshMessage = `Loaded ${images.length} images`;

			console.log('[refresh-content] Updated photo paths:', images);

			// Clear message after 3 seconds
			setTimeout(() => {
				contentRefreshMessage = null;
			}, 3000);
		} catch (err) {
			contentRefreshMessage = err instanceof Error ? err.message : 'Failed to refresh content';
			console.error('[refresh-content] Error:', err);
		} finally {
			isRefreshingContent = false;
		}
	}

	/**
	 * Detect pom-poms in the pom-pom mask
	 * Finds circular blobs for spotlight animation
	 */
	async function detectPomPomsFromMask() {
		isDetectingPomPoms = true;
		pomPomDetectionError = null;
		pomPomDetectionResult = null;

		try {
			// Find the pom-pom mask in state
			const pomPomMask = appState.current.projection.masks.find(m => m.id === 'pom-pom');
			if (!pomPomMask) {
				throw new Error('No pom-pom mask found. Generate one first.');
			}

			console.log('Detecting pom-poms in mask...');

			// Convert base64 to canvas for processing
			const maskCanvas = await base64ToCanvas(
				pomPomMask.imageData,
				pomPomMask.bounds.width,
				pomPomMask.bounds.height
			);

			// Run pom-pom detection with relaxed parameters to catch all pom-poms
			const result = detectPomPoms(maskCanvas, {
				minRadius: 3,
				maxRadius: 200,
				minCircularity: 0.3
			});
			pomPomDetectionResult = result;

			console.log('Pom-pom detection complete:', {
				count: result.pomPoms.length,
				positions: result.sortedByX.map(p => ({ x: Math.round(p.center.x), y: Math.round(p.center.y), r: Math.round(p.radius) }))
			});

			// Helper: Convert RGB to HSL and return saturation
			function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
				r /= 255;
				g /= 255;
				b /= 255;
				const max = Math.max(r, g, b);
				const min = Math.min(r, g, b);
				const l = (max + min) / 2;
				let h = 0, s = 0;

				if (max !== min) {
					const d = max - min;
					s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
					switch (max) {
						case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
						case g: h = ((b - r) / d + 2) / 6; break;
						case b: h = ((r - g) / d + 4) / 6; break;
					}
				}
				return { h, s, l };
			}

			// Helper: Find most saturated color in a region
			function findMostSaturatedColor(
				ctx: CanvasRenderingContext2D,
				centerX: number,
				centerY: number,
				radius: number,
				sourceWidth: number,
				sourceHeight: number
			): string | undefined {
				// Sample a grid of points within the pom-pom region
				const sampleRadius = Math.max(5, Math.floor(radius * 0.7)); // Sample within 70% of radius
				const step = Math.max(2, Math.floor(sampleRadius / 4)); // 4-5 samples per axis

				let bestColor: string | undefined;
				let bestSaturation = -1;
				let bestLightness = 0;

				for (let dy = -sampleRadius; dy <= sampleRadius; dy += step) {
					for (let dx = -sampleRadius; dx <= sampleRadius; dx += step) {
						// Check if point is within circular region
						if (dx * dx + dy * dy > sampleRadius * sampleRadius) continue;

						const x = Math.round(centerX + dx);
						const y = Math.round(centerY + dy);

						// Bounds check
						if (x < 0 || x >= sourceWidth || y < 0 || y >= sourceHeight) continue;

						try {
							const imageData = ctx.getImageData(x, y, 1, 1);
							const [r, g, b] = imageData.data;
							const { s, l } = rgbToHsl(r, g, b);

							// Prefer saturated colors that aren't too dark or too bright
							// Score = saturation * (1 - |lightness - 0.5| * 2) to penalize extremes
							const lightnessScore = 1 - Math.abs(l - 0.5) * 1.5;
							const score = s * Math.max(0.2, lightnessScore);

							if (score > bestSaturation) {
								bestSaturation = score;
								bestLightness = l;
								bestColor = `rgb(${r}, ${g}, ${b})`;
							}
						} catch {
							// Ignore sampling errors
						}
					}
				}

				return bestColor;
			}

			// Sample colors for each pom-pom from the source image
			// In live mode, use liveFrame; in dev mode, use wallImage (fixture)
			const pomPomPositions = result.sortedByX.map(p => {
				let color: string | undefined;
				const { quad: q } = getCurrentQuadAndSize();

				// Create a canvas with the source image to sample from
				const tempCanvas = document.createElement('canvas');
				let sourceWidth = 0;
				let sourceHeight = 0;
				const tempCtx = tempCanvas.getContext('2d');

				if (imageMode === 'live' && liveFrame) {
					// Live mode: sample from liveFrame (ImageData)
					sourceWidth = liveFrame.width;
					sourceHeight = liveFrame.height;
					tempCanvas.width = sourceWidth;
					tempCanvas.height = sourceHeight;
					if (tempCtx) {
						tempCtx.putImageData(liveFrame, 0, 0);
					}
				} else if (wallImage) {
					// Dev mode: sample from wallImage (fixture)
					sourceWidth = wallImage.width;
					sourceHeight = wallImage.height;
					tempCanvas.width = sourceWidth;
					tempCanvas.height = sourceHeight;
					if (tempCtx) {
						tempCtx.drawImage(wallImage, 0, 0);
					}
				}

				if (tempCtx && sourceWidth > 0 && sourceHeight > 0) {
					// Map projector coordinates to source image coordinates using the quad
					const u = p.center.x / PROJ_WIDTH;
					const v = p.center.y / PROJ_HEIGHT;
					const topX = q.topLeft.x + (q.topRight.x - q.topLeft.x) * u;
					const topY = q.topLeft.y + (q.topRight.y - q.topLeft.y) * u;
					const bottomX = q.bottomLeft.x + (q.bottomRight.x - q.bottomLeft.x) * u;
					const bottomY = q.bottomLeft.y + (q.bottomRight.y - q.bottomLeft.y) * u;
					const imgX = Math.round(topX + (bottomX - topX) * v);
					const imgY = Math.round(topY + (bottomY - topY) * v);

					// Calculate radius in image space (approximate)
					// Use the quad to estimate scale from projector to image
					const quadWidth = Math.abs(q.topRight.x - q.topLeft.x);
					const quadHeight = Math.abs(q.bottomLeft.y - q.topLeft.y);
					const scaleX = quadWidth / PROJ_WIDTH;
					const scaleY = quadHeight / PROJ_HEIGHT;
					const imgRadius = Math.round(p.radius * Math.max(scaleX, scaleY));

					// Ensure center is within bounds before searching
					if (imgX >= 0 && imgX < sourceWidth && imgY >= 0 && imgY < sourceHeight) {
						// Find the most saturated color within the pom-pom region
						color = findMostSaturatedColor(tempCtx, imgX, imgY, imgRadius, sourceWidth, sourceHeight);
						console.log(`Sampled most saturated color at pom-pom ${p.index}: center(${imgX}, ${imgY}) radius=${imgRadius} -> ${color}`);
					} else {
						console.warn(`Pom-pom ${p.index} sample coords out of bounds: (${imgX}, ${imgY}) vs ${sourceWidth}x${sourceHeight}`);
					}
				}
				return {
					index: p.index,
					x: p.center.x,
					y: p.center.y,
					radius: p.radius,
					color
				};
			});
			await updateState({
				projection: {
					...appState.current.projection,
					pomPoms: pomPomPositions
				}
			});

			// Pass pom-pom positions (with colors) to spotlight animation and start it if animations are enabled
			if (spotlightAnim && pomPomPositions.length > 0) {
				// Convert back to PomPomInfo format expected by spotlight animation
				const pomPomInfos = pomPomPositions.map(p => ({
					index: p.index,
					center: { x: p.x, y: p.y },
					radius: p.radius,
					pixelCount: 0,
					boundingBox: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
					circularity: 1,
					color: p.color
				}));
				spotlightAnim.setPomPoms(pomPomInfos);
				if (appState.current.projection.animationsEnabled !== false && appState.current.mode === 'projecting') {
					spotlightAnim.start();
				}
			}

			console.log('Spotlight animation started with', pomPomPositions.length, 'pom-poms');
		} catch (err) {
			pomPomDetectionError = err instanceof Error ? err.message : 'Pom-pom detection failed';
			console.error('Pom-pom detection error:', err);
		} finally {
			isDetectingPomPoms = false;
		}
	}

	/**
	 * Convert base64 image data to canvas element
	 */
	function base64ToCanvas(imageData: string, width: number, height: number): Promise<HTMLCanvasElement> {
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext('2d')!;
				ctx.drawImage(img, 0, 0);
				resolve(canvas);
			};
			img.src = imageData;
		});
	}

	/**
	 * Load existing masks from shared state
	 */
	async function loadMasksFromState() {
		const masks = appState.current.projection.masks;
		if (masks.length > 0) {
			console.log('Loading', masks.length, 'masks from shared state');

			// Convert base64 to canvas
			transformedMasks = await Promise.all(
				masks.map(m => base64ToCanvas(m.imageData, m.bounds.width, m.bounds.height))
			);

			// Populate generatedMasks for UI display
			generatedMasks = masks.map(m => ({
				id: m.id,
				prompt: m.id, // Use id as prompt since we don't store original prompt
				maskUrl: m.imageData,
				score: 1 // Score not stored in state
			}));

			// Sync local enabledMasks with shared state
			enabledMasks = new Set(
				masks.filter(m => m.enabled !== false).map(m => m.id)
			);

			renderSimulation();
		} else {
			transformedMasks = [];
			generatedMasks = [];
		}
	}

	/**
	 * Generate masks from SAM API using configured prompts
	 */
	async function generateMasksFromSam() {
		isGenerating = true;
		generationError = null;

		try {
			console.log('Generating masks for prompts:', SAM_PROMPTS);

			let imageSource: string;

			if (imageMode === 'live') {
				// Capture a fresh frame from webcam for best results
				const freshFrame = captureWebcamFrame();
				if (!freshFrame) {
					throw new Error('Failed to capture webcam frame. Is the camera ready?');
				}
				if (!freshFrame.width || !freshFrame.height) {
					throw new Error(`Invalid webcam frame dimensions: ${freshFrame.width}x${freshFrame.height}`);
				}
				liveFrame = freshFrame; // Update stored frame too
				imageSource = imageDataToBase64(freshFrame);
				console.log(`Using fresh webcam frame for SAM mask generation (${freshFrame.width}x${freshFrame.height})`);
			} else {
				// Use fixture image path (will be loaded by generateMasks)
				imageSource = SIMULATION_IMAGE_PATH;
				console.log('Using fixture image for SAM mask generation');
			}

			// Call SAM for each prompt
			const results = await generateMasks(imageSource, SAM_PROMPTS);

			if (results.length === 0) {
				generationError = 'No masks generated. Check prompts and image.';
				return;
			}

			console.log('Generated masks:', results);

			// Load mask images and transform to projector space
			const maskImages: HTMLImageElement[] = [];
			for (const mask of results) {
				if (!mask.maskUrl) {
					console.warn(`Mask ${mask.id} has no URL, skipping`);
					continue;
				}
				try {
					const img = await loadMaskImage(mask.maskUrl);
					if (!img || !img.width || !img.height) {
						console.warn(`Mask ${mask.id} failed to load properly, skipping`);
						continue;
					}
					maskImages.push(img);
				} catch (err) {
					console.error(`Failed to load mask ${mask.id}:`, err);
				}
			}

			if (maskImages.length === 0) {
				throw new Error('No valid mask images could be loaded from SAM results');
			}

			// Transform masks to projector space
			const { quad, imageSize } = getCurrentQuadAndSize();
			transformedMasks = transformMasksToProjector(maskImages, quad, imageSize);
			console.log('Transformed', transformedMasks.length, 'masks using', imageMode, 'mode quad');

			// Convert transformed masks to base64 and save to shared state
			const masksForState = transformedMasks.map((canvas, i) => ({
				id: results[i].id,
				imageData: canvas.toDataURL('image/png'),
				bounds: { x: 0, y: 0, width: canvas.width, height: canvas.height },
				enabled: true
			}));
			await updateState({
				projection: {
					...appState.current.projection,
					masks: masksForState
				}
			});
			console.log('Saved', masksForState.length, 'masks to shared state');

			// Update generatedMasks to show transformed B&W masks in debug UI
			generatedMasks = results.map((r, i) => ({
				id: r.id,
				prompt: r.prompt,
				maskUrl: masksForState[i].imageData, // Use B&W transformed mask
				score: r.score
			}));

			// Re-render simulation with new masks
			renderSimulation();

			// Auto-start projection mode to run animations
			await startProjecting();
		} catch (err) {
			generationError = err instanceof Error ? err.message : 'Mask generation failed';
			console.error('Mask generation error:', err);
		} finally {
			isGenerating = false;
		}
	}
</script>

<svelte:head>
	<title>Control Panel</title>
</svelte:head>

<div class="min-h-screen bg-gray-900 text-white p-4">
	<h1 class="text-xl font-bold mb-4">Control Panel</h1>

	<!-- Status -->
	<p class="mb-4 text-sm">
		Mode: <code>{appState.current.mode}</code> |
		Calibration: <code>{appState.current.calibration.status}</code>
	</p>

	<!-- Dev/Live Mode Toggle -->
	<div class="mb-4 p-3 border border-gray-600 rounded">
		<div class="flex items-center gap-4 mb-2">
			<span class="text-sm font-medium">Image Source:</span>
			<label class="flex items-center gap-2 cursor-pointer">
				<input
					type="radio"
					name="imageMode"
					value="dev"
					checked={imageMode === 'dev'}
					onchange={switchToDevMode}
					class="accent-blue-500"
				/>
				<span class="text-sm">Dev (Fixture)</span>
			</label>
			<label class="flex items-center gap-2 cursor-pointer">
				<input
					type="radio"
					name="imageMode"
					value="live"
					checked={imageMode === 'live'}
					onchange={switchToLiveMode}
					class="accent-blue-500"
				/>
				<span class="text-sm">Live (Webcam)</span>
			</label>
		</div>

		{#if imageMode === 'live'}
			<div class="flex items-center gap-2 mt-2">
				<label class="text-sm text-gray-400">Camera:</label>
				<select
					bind:value={selectedCameraId}
					onchange={onCameraChange}
					class="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
				>
					{#each availableCameras as camera}
						<option value={camera.deviceId}>
							{camera.label || `Camera ${availableCameras.indexOf(camera) + 1}`}
						</option>
					{/each}
				</select>
				{#if webcamStream}
					<span class="text-green-400 text-sm">Connected</span>
					<button
						onclick={saveWebcamImage}
						disabled={isSaving}
						class="ml-4 px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded text-sm"
					>
						{isSaving ? 'Saving...' : 'Save Image'}
					</button>
					{#if saveMessage}
						<span class="ml-2 text-sm" class:text-green-400={saveMessage.startsWith('Saved')} class:text-red-400={saveMessage.startsWith('Error')}>
							{saveMessage}
						</span>
					{/if}
				{:else if webcamError}
					<span class="text-red-400 text-sm">{webcamError}</span>
				{:else}
					<span class="text-yellow-400 text-sm">Connecting...</span>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Camera Server Status -->
	<div class="mb-4 p-2 border rounded text-sm" class:border-green-500={serverStatus === 'ready'} class:border-red-500={serverStatus === 'error'} class:border-yellow-500={serverStatus === 'checking'}>
		{#if serverStatus === 'checking'}
			<span class="text-yellow-400">Checking camera server...</span>
		{:else if serverStatus === 'ready'}
			<span class="text-green-400">Camera server ready</span>
			{#if serverVersion}
				<span class="text-gray-400 ml-2">(OpenCV {serverVersion})</span>
			{/if}
		{:else}
			<span class="text-red-400">Camera server offline</span>
			{#if serverError}
				<span class="text-red-300 ml-2">— {serverError}</span>
			{/if}
			<button onclick={checkServer} class="ml-2 text-blue-400 underline">Retry</button>
		{/if}
	</div>

	<!-- Controls -->
	<div class="mb-4">
		<button onclick={startCalibration} disabled={appState.current.mode === 'calibrating'}>
			Start Calibration
		</button>
		{#if appState.current.mode === 'calibrating' && appState.current.calibration.status === 'showing-markers'}
			<button onclick={captureAndDetect} disabled={isCapturing}>
				{isCapturing ? 'Detecting...' : 'Capture'}
			</button>
		{/if}
		<button onclick={stopCalibration} disabled={appState.current.mode !== 'calibrating'}>
			Stop
		</button>
		<span class="mx-2">|</span>
		<button
			onclick={startProjecting}
			disabled={appState.current.mode === 'projecting'}
			class="bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600"
		>
			Project Masks
		</button>
		<button
			onclick={stopProjecting}
			disabled={appState.current.mode !== 'projecting'}
		>
			Stop Projection
		</button>
		<button
			onclick={toggleAnimations}
			class={animationsEnabled ? 'bg-orange-600 hover:bg-orange-700' : 'bg-gray-600 hover:bg-gray-700'}
		>
			{animationsEnabled ? 'Animations: ON' : 'Animations: OFF'}
		</button>
		<span class="mx-2">|</span>
		<button
			onclick={generateMasksFromSam}
			disabled={isGenerating}
			class="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600"
		>
			{isGenerating ? 'Generating...' : 'Generate Masks'}
		</button>
		<button
			onclick={generateWallMask}
			disabled={isGeneratingWall || isLoadingHistoryMask}
			class="bg-green-600 hover:bg-green-700 disabled:bg-gray-600"
		>
			{isGeneratingWall ? 'Generating Wall...' : 'Generate Wall Mask'}
		</button>
		<select
			onchange={(e) => {
				const select = e.target as HTMLSelectElement;
				if (select.value) {
					loadHistoricalWallMask(select.value);
					select.value = '';
				}
			}}
			disabled={isLoadingHistoryMask || isGeneratingWall || wallMaskHistory.length === 0}
			class="bg-green-800 hover:bg-green-900 disabled:bg-gray-600 text-white px-3 py-2 rounded text-sm"
		>
			<option value="">{isLoadingHistoryMask ? 'Loading...' : isLoadingHistory ? 'Loading history...' : `History (${wallMaskHistory.length})`}</option>
			{#each wallMaskHistory as entry}
				<option value={entry.id}>
					{new Date(entry.timestamp).toLocaleString()}
				</option>
			{/each}
		</select>
		<button
			onclick={detectIslandsFromWallMask}
			disabled={isDetectingIslands}
			class="bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600"
		>
			{isDetectingIslands ? 'Detecting...' : 'Detect Islands'}
		</button>
		<button
			onclick={detectPomPomsFromMask}
			disabled={isDetectingPomPoms}
			class="bg-pink-600 hover:bg-pink-700 disabled:bg-gray-600"
		>
			{isDetectingPomPoms ? 'Detecting...' : 'Detect Pom Poms'}
		</button>
		<button
			onclick={refreshContent}
			disabled={isRefreshingContent}
			class="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600"
		>
			{isRefreshingContent ? 'Refreshing...' : 'Refresh Content'}
		</button>
		{#if contentRefreshMessage}
			<span class="text-sm ml-2" class:text-green-400={contentRefreshMessage.startsWith('Loaded')} class:text-yellow-400={!contentRefreshMessage.startsWith('Loaded')}>
				{contentRefreshMessage}
			</span>
		{:else if contentPhotoCount > 0}
			<span class="text-sm text-gray-400 ml-2">({contentPhotoCount} photos)</span>
		{/if}
	</div>

	<!-- Detection Results -->
	{#if detectionError}
		<p class="mb-4 text-red-400 text-sm">Error: {detectionError}</p>
	{/if}

	<!-- Mask Generation Results -->
	{#if generationError}
		<p class="mb-4 text-red-400 text-sm">Generation Error: {generationError}</p>
	{/if}

	{#if wallMaskError}
		<p class="mb-4 text-red-400 text-sm">Wall Mask Error: {wallMaskError}</p>
	{/if}

	{#if islandDetectionError}
		<p class="mb-4 text-red-400 text-sm">Island Detection Error: {islandDetectionError}</p>
	{/if}

	{#if pomPomDetectionError}
		<p class="mb-4 text-red-400 text-sm">Pom-Pom Detection Error: {pomPomDetectionError}</p>
	{/if}

	{#if islandDetectionResult}
		<div class="mb-4 p-3 bg-gray-800 rounded text-sm">
			<p class="text-cyan-400 mb-2">Island Detection Results:</p>
			<p class="text-gray-300">
				Found {islandDetectionResult.stats.islandCount} islands |
				Islands: {islandDetectionResult.stats.islandPixels.toLocaleString()} px |
				Land: {islandDetectionResult.stats.landPixels.toLocaleString()} px |
				Water: {islandDetectionResult.stats.waterPixels.toLocaleString()} px
			</p>
			<div class="flex gap-4 mt-2">
				<div>
					<p class="text-xs text-gray-400 mb-1">Islands</p>
					<canvas
						width={192}
						height={108}
						class="border border-cyan-500"
						style="background: #333;"
						use:drawScaledCanvas={islandDetectionResult.islands}
					></canvas>
				</div>
				<div>
					<p class="text-xs text-gray-400 mb-1">Land</p>
					<canvas
						width={192}
						height={108}
						class="border border-green-500"
						style="background: #333;"
						use:drawScaledCanvas={islandDetectionResult.land}
					></canvas>
				</div>
				<div>
					<p class="text-xs text-gray-400 mb-1">Water</p>
					<canvas
						width={192}
						height={108}
						class="border border-blue-500"
						style="background: #333;"
						use:drawScaledCanvas={islandDetectionResult.water}
					></canvas>
				</div>
			</div>

			<!-- Island Animation Controls -->
			<div class="mt-4 pt-3 border-t border-gray-700">
				<p class="text-xs text-gray-400 mb-2">Island Animations:</p>
				<div class="flex gap-3">
					<button
						class="px-3 py-1 rounded text-sm {islandPhotosPlaying ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'}"
						onclick={() => updateState({ projection: { ...appState.current.projection, islandPhotosPlaying: !islandPhotosPlaying } })}
					>
						{islandPhotosPlaying ? 'Pause' : 'Play'} Photos
					</button>
					<button
						class="px-3 py-1 rounded text-sm {happyBirthdayPlaying ? 'bg-pink-600 hover:bg-pink-700' : 'bg-gray-600 hover:bg-gray-700'}"
						onclick={() => updateState({ projection: { ...appState.current.projection, happyBirthdayPlaying: !happyBirthdayPlaying } })}
					>
						{happyBirthdayPlaying ? 'Pause' : 'Play'} Birthday
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if pomPomDetectionResult}
		<div class="mb-4 p-3 bg-gray-800 rounded text-sm">
			<p class="text-pink-400 mb-2">Pom-Pom Detection Results:</p>
			<p class="text-gray-300">
				Found {pomPomDetectionResult.pomPoms.length} pom-poms
			</p>
			<div class="mt-2 flex flex-wrap gap-2">
				{#each pomPomDetectionResult.sortedByX as pompom, i}
					<div class="bg-gray-700 px-2 py-1 rounded text-xs">
						#{i + 1}: ({Math.round(pompom.center.x)}, {Math.round(pompom.center.y)}) r={Math.round(pompom.radius)}
					</div>
				{/each}
			</div>
			{#if spotlights.length > 0}
				<p class="text-yellow-400 mt-2">
					Active spotlights: {spotlights.length}
				</p>
			{/if}
		</div>
	{/if}

	{#if generatedMasks.length > 0 || isGeneratingWall}
		<div class="mb-4 text-sm">
			<p class="text-purple-400 mb-2">Masks ({generatedMasks.length}{isGeneratingWall && !generatedMasks.find(m => m.id === 'wall-texture') ? '+1' : ''}):</p>
			<div class="flex gap-4 flex-wrap">
				{#if isGeneratingWall && !generatedMasks.find(m => m.id === 'wall-texture')}
					<div class="bg-gray-800 p-3 rounded border border-yellow-500">
						<div class="flex items-center justify-between mb-2">
							<span class="text-gray-300 text-xs font-medium">wall-texture</span>
							<span class="text-xs text-yellow-400">Generating...</span>
						</div>
						<div class="h-20 w-32 border border-gray-600 mb-2 flex items-center justify-center bg-gray-700">
							<div class="text-center">
								<div class="animate-spin w-6 h-6 border-2 border-yellow-500 border-t-transparent rounded-full mx-auto mb-1"></div>
								<span class="text-xs text-gray-400">~30s</span>
							</div>
						</div>
						<div class="flex gap-1">
							<button disabled class="text-xs px-2 py-1 bg-gray-600 rounded">Regen</button>
							<button disabled class="text-xs px-2 py-1 bg-gray-600 rounded">Delete</button>
						</div>
					</div>
				{/if}
				{#each generatedMasks as mask, i}
					<div class="bg-gray-800 p-3 rounded border {enabledMasks.has(mask.id) ? 'border-green-500' : 'border-gray-600'}">
						<div class="flex items-center justify-between mb-2">
							<span class="text-gray-300 text-xs font-medium">{mask.id}</span>
							<label class="flex items-center gap-1 cursor-pointer">
								<input
									type="checkbox"
									checked={enabledMasks.has(mask.id)}
									onchange={() => toggleMask(mask.id)}
									class="accent-green-500"
								/>
								<span class="text-xs text-gray-400">On</span>
							</label>
						</div>
						{#if (mask.id === 'wall-texture' && isGeneratingWall) || regeneratingMask === mask.id}
							<div class="h-20 w-32 border border-gray-600 mb-2 flex items-center justify-center bg-gray-700">
								<div class="text-center">
									<div class="animate-spin w-6 h-6 border-2 border-yellow-500 border-t-transparent rounded-full mx-auto mb-1"></div>
									<span class="text-xs text-gray-400">Processing...</span>
								</div>
							</div>
						{:else}
							<img
								src={mask.maskUrl}
								alt="Mask {i}"
								class="h-20 w-auto border border-gray-600 mb-2"
								style="background: repeating-conic-gradient(#333 0% 25%, #444 0% 50%) 50% / 10px 10px;"
							/>
						{/if}
						<div class="flex gap-1">
							<button
								onclick={() => regenerateMask(mask.id)}
								disabled={regeneratingMask === mask.id}
								class="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded"
							>
								{regeneratingMask === mask.id ? '...' : 'Regen'}
							</button>
							<button
								onclick={() => deleteMask(mask.id)}
								class="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 rounded"
							>
								Delete
							</button>
						</div>
						{#if mask.score < 1}
							<p class="text-gray-500 text-xs mt-1">{(mask.score * 100).toFixed(0)}%</p>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if detectedMarkers.length > 0}
		<div class="mb-4 text-sm">
			<p class="text-green-400">Detected {detectedMarkers.length} marker(s):</p>
			<ul class="ml-4 text-gray-300">
				{#each sortedMarkers(detectedMarkers) as marker}
					<li>Marker {marker.id} at ({marker.corners[0].x.toFixed(0)}, {marker.corners[0].y.toFixed(0)})</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if calibrationComplete}
		<p class="mb-4 text-green-400 text-sm">Calibration complete! Homography matrix stored.</p>
	{/if}

	<!-- Video/Canvas Display -->
	{#if imageMode === 'live'}
		<!-- Live webcam feed -->
		<div class="relative">
			<video
				bind:this={videoElement}
				class="max-w-full h-auto border border-gray-700"
				style="max-height: 70vh;"
				autoplay
				playsinline
				muted
			></video>
			{#if detectedMarkers.length > 0}
				<div class="absolute top-2 left-2 bg-black/70 px-2 py-1 rounded text-sm">
					<span class="text-green-400">{detectedMarkers.length} markers detected</span>
				</div>
			{/if}
		</div>
	{:else}
		<!-- Dev mode simulation canvas -->
		<canvas
			bind:this={canvas}
			class="max-w-full h-auto border border-gray-700"
			style="max-height: 70vh;"
		></canvas>
	{/if}
</div>
