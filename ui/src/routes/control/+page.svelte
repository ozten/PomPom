<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { startPolling, stopPolling, appState, updateState } from '$lib/state.svelte';
	import { detectMarkers, checkServerHealth, type DetectedMarker } from '$lib/aruco';
	import {
		calculateHomography,
		getProjectorMarkerPositions,
		buildPointCorrespondences
	} from '$lib/homography';
	import {
		PROJECTOR_WIDTH,
		PROJECTOR_HEIGHT,
		renderProjection,
		loadMarkerImages
	} from '$lib/projection-renderer';
	import { SIMULATION_QUAD, SAM_PROMPTS, SIMULATION_IMAGE_PATH } from '$lib/projection-config';
	import { transformMasksToProjector } from '$lib/mask-transform';
	import { generateMasks, loadMaskImage, type GeneratedMask } from '$lib/sam';
	import { generateWallTextureMask } from '$lib/wall-mask';
	import { detectIslands, type IslandDetectionResult } from '$lib/island-detection';
	import { drawPerspective } from '$lib/perspective-canvas';
	import {
		createFelizNavidadAnimation,
		createPomPomAnimation,
		createWallTextureAnimation,
		createIslandPhotosAnimation,
		type Animation,
		type AnimationRenderState,
		type IslandPhoto,
		type IslandPhotosAnimation
	} from '$lib/animations';

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
		['pom-pom', { opacity: 1, color: '#FFD700' }],
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

	// Mask generation state
	let isGenerating = $state(false);
	let generationError = $state<string | null>(null);
	let generatedMasks = $state<GeneratedMask[]>([]);

	// Wall texture mask state
	let isGeneratingWall = $state(false);
	let wallMaskError = $state<string | null>(null);
	let wallMaskUrl = $state<string | null>(null);

	// Island detection state
	let isDetectingIslands = $state(false);
	let islandDetectionError = $state<string | null>(null);
	let islandDetectionResult = $state<IslandDetectionResult | null>(null);

	// Island photos animation state
	let islandPhotosAnim: IslandPhotosAnimation | null = null;
	let islandPhotos = $state<IslandPhoto[]>([]);
	let islandsMaskCanvas = $state<HTMLCanvasElement | null>(null);

	// Per-mask enabled state and regeneration tracking
	let enabledMasks = $state<Set<string>>(new Set(['feliz-navidad', 'pom-pom', 'wall-texture']));
	let regeneratingMask = $state<string | null>(null);

	// Simulation configuration
	const WALL_IMAGE_SRC = '/fixtures/webcam_capture.png';

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

		// Get canvas context
		ctx = canvas.getContext('2d');

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

		// Initial render
		renderSimulation();
	});

	onDestroy(() => {
		stopPolling();
		// Stop all animations
		animations.forEach(anim => anim.stop());
		islandPhotosAnim?.stop();
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

		// Set canvas size to match wall image
		canvas.width = wallImage.width;
		canvas.height = wallImage.height;

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
			islandsMaskCanvas || undefined
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

	// Start/stop animations based on mode AND mask enabled state
	$effect(() => {
		const mode = appState.current.mode;
		const isProjecting = mode === 'projecting';

		// Each animation runs only if projecting AND its mask is enabled
		animations.forEach((anim, maskId) => {
			const shouldRun = isProjecting && enabledMasks.has(maskId);
			if (shouldRun) {
				anim.start();
			} else {
				anim.stop();
			}
		});
	});

	// Re-render when state changes
	$effect(() => {
		// Track relevant state
		const _ = appState.current.calibration.status;
		const __ = detectedMarkers;

		// Re-render
		renderSimulation();
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
			await calculateAndStoreHomography();
		} catch (err) {
			detectionError = err instanceof Error ? err.message : 'Detection failed';
		} finally {
			isCapturing = false;
		}
	}

	async function calculateAndStoreHomography() {
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

		// Store in app state
		await updateState({
			calibration: {
				status: 'complete',
				homography: result.matrix
			}
		});

		calibrationComplete = true;
	}

	function sortedMarkers(markers: DetectedMarker[]): DetectedMarker[] {
		return [...markers].sort((a, b) => a.id - b.id);
	}

	async function startProjecting() {
		await updateState({
			mode: 'projecting'
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
				const transformed = transformMasksToProjector([img], SIMULATION_QUAD)[0];

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

			// Load the simulation image as base64
			const response = await fetch(SIMULATION_IMAGE_PATH);
			const blob = await response.blob();
			const imageDataUrl = await new Promise<string>((resolve) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result as string);
				reader.readAsDataURL(blob);
			});

			// Generate wall mask (calls API, extracts red as mask)
			const { mask, editedImageUrl } = await generateWallTextureMask(imageDataUrl);
			wallMaskUrl = editedImageUrl;

			console.log('Wall mask generated, transforming to projector space...');

			// Transform to projector space (same as other masks)
			const transformedWallMask = transformMasksToProjector([mask as unknown as HTMLImageElement], SIMULATION_QUAD)[0];

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
		} catch (err) {
			wallMaskError = err instanceof Error ? err.message : 'Wall mask generation failed';
			console.error('Wall mask generation error:', err);
		} finally {
			isGeneratingWall = false;
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

			// Update the wall-texture mask with sub-masks
			const updatedMasks = appState.current.projection.masks.map(m => {
				if (m.id === 'wall-texture') {
					return {
						...m,
						subMasks: {
							islands: result.islands.toDataURL('image/png'),
							land: result.land.toDataURL('image/png'),
							water: result.water.toDataURL('image/png')
						}
					};
				}
				return m;
			});

			await updateState({
				projection: { ...appState.current.projection, masks: updatedMasks }
			});

			// Save the islands mask canvas for rendering
			islandsMaskCanvas = result.islands;

			// Pass island info to the photos animation and start it
			if (islandPhotosAnim) {
				const islandComponents = result.stats.components.filter(c => c.isIsland);
				islandPhotosAnim.setIslands(islandComponents);
				islandPhotosAnim.start();
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

			// Call SAM for each prompt
			const results = await generateMasks(SIMULATION_IMAGE_PATH, SAM_PROMPTS);

			if (results.length === 0) {
				generationError = 'No masks generated. Check prompts and image.';
				return;
			}

			console.log('Generated masks:', results);

			// Load mask images and transform to projector space
			const maskImages: HTMLImageElement[] = [];
			for (const mask of results) {
				const img = await loadMaskImage(mask.maskUrl);
				maskImages.push(img);
			}

			// Transform masks to projector space
			transformedMasks = transformMasksToProjector(maskImages, SIMULATION_QUAD);
			console.log('Transformed', transformedMasks.length, 'masks');

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
			disabled={isGeneratingWall}
			class="bg-green-600 hover:bg-green-700 disabled:bg-gray-600"
		>
			{isGeneratingWall ? 'Generating Wall...' : 'Generate Wall Mask'}
		</button>
		<button
			onclick={detectIslandsFromWallMask}
			disabled={isDetectingIslands}
			class="bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600"
		>
			{isDetectingIslands ? 'Detecting...' : 'Detect Islands'}
		</button>
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
