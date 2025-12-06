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
		loadMarkerImages,
		loadSamMaskImages
	} from '$lib/projection-renderer';
	import { drawPerspective } from '$lib/perspective-canvas';
	import {
		createFelizNavidadAnimation,
		createPomPomAnimation,
		type Animation,
		type AnimationRenderState
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
	let samMaskImages: HTMLImageElement[] = [];

	// Animation instances
	let felizNavidadAnim: Animation | null = null;
	let pomPomAnim: Animation | null = null;

	// Current animation render states
	let animationStates: AnimationRenderState[] = [
		{ opacity: 1, color: '#FFD700' }, // Feliz Navidad
		{ opacity: 1, color: '#FFD700' } // Pom Pom
	];

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

	// Simulation configuration
	const WALL_IMAGE_SRC = '/fixtures/IMG_0819.jpeg';

	// Projection quad: where the projection appears on the wall (in wall image pixels)
	// These 4 corners define the perspective-distorted projection area
	const PROJECTION_QUAD = {
		topLeft: { x: 240, y: 165 },
		topRight: { x: 900, y: 290 },
		bottomLeft: { x: 240, y: 700 },
		bottomRight: { x: 910, y: 690 }
	};

	onMount(async () => {
		startPolling(500);
		checkServer();

		// Get canvas context
		ctx = canvas.getContext('2d');

		// Load images
		await loadImages();

		// Create animations with update callbacks
		felizNavidadAnim = createFelizNavidadAnimation((state) => {
			animationStates[0] = state;
			renderSimulation();
		});

		pomPomAnim = createPomPomAnimation((state) => {
			animationStates[1] = state;
			renderSimulation();
		});

		// Initial render
		renderSimulation();
	});

	onDestroy(() => {
		stopPolling();
		// Stop animations
		felizNavidadAnim?.stop();
		pomPomAnim?.stop();
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

		// Load SAM mask images for projection
		samMaskImages = await loadSamMaskImages();
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

		const q = PROJECTION_QUAD;

		// 1. Draw wall background with darkening (simulates dark room)
		ctx.save();
		ctx.drawImage(wallImage, 0, 0);
		// Darken the image to simulate projecting in a dark room
		ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; // 60% darkening
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.restore();

		// 2. Render projection content to offscreen canvas (using shared renderer)
		renderProjection(projectionCtx, appState.current, markerImages, samMaskImages, animationStates);

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

	// Start/stop animations based on mode
	$effect(() => {
		const mode = appState.current.mode;

		if (mode === 'projecting') {
			// Start animations when projecting
			felizNavidadAnim?.start();
			pomPomAnim?.start();
		} else {
			// Stop animations when not projecting
			felizNavidadAnim?.stop();
			pomPomAnim?.stop();
		}
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
	</div>

	<!-- Detection Results -->
	{#if detectionError}
		<p class="mb-4 text-red-400 text-sm">Error: {detectionError}</p>
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
