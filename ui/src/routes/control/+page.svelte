<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { startPolling, stopPolling, appState, updateState } from '$lib/state.svelte';
	import {
		detectMarkers,
		loadImageAsImageData,
		checkServerHealth,
		type DetectedMarker
	} from '$lib/aruco';
	import {
		calculateHomography,
		getProjectorMarkerPositions,
		buildPointCorrespondences
	} from '$lib/homography';

	// Detection state (local to this component)
	let isCapturing = $state(false);
	let detectedMarkers = $state<DetectedMarker[]>([]);
	let detectionError = $state<string | null>(null);
	let calibrationComplete = $state(false);

	// Camera server diagnostic state
	let serverStatus = $state<'checking' | 'ready' | 'error'>('checking');
	let serverVersion = $state<string | null>(null);
	let serverError = $state<string | null>(null);

	// Fixture image for dev mode
	const FIXTURE_IMAGE = '/fixtures/calibration_isolated.png';
	// Projector dimensions (assumed 1920x1080)
	const PROJECTOR_WIDTH = 1920;
	const PROJECTOR_HEIGHT = 1080;

	onMount(() => {
		startPolling(500);
		// Check camera server
		checkServer();
	});

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

	onDestroy(() => {
		stopPolling();
	});

	async function startCalibration() {
		// Reset detection state
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
			// Load fixture image as ImageData
			const imageData = await loadImageAsImageData(FIXTURE_IMAGE);

			// Run ArUco detection
			const result = await detectMarkers(imageData);
			detectedMarkers = result.markers;

			if (detectedMarkers.length === 0) {
				detectionError = 'No markers detected';
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

	// Sort markers by ID for display
	function sortedMarkers(markers: DetectedMarker[]): DetectedMarker[] {
		return [...markers].sort((a, b) => a.id - b.id);
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

	<!-- Camera Server Status -->
	<div class="mb-4 p-2 border rounded text-sm" class:border-green-500={serverStatus === 'ready'} class:border-red-500={serverStatus === 'error'} class:border-yellow-500={serverStatus === 'checking'}>
		{#if serverStatus === 'checking'}
			<span class="text-yellow-400">⏳ Checking camera server...</span>
		{:else if serverStatus === 'ready'}
			<span class="text-green-400">✓ Camera server ready</span>
			{#if serverVersion}
				<span class="text-gray-400 ml-2">(OpenCV {serverVersion})</span>
			{/if}
		{:else}
			<span class="text-red-400">✗ Camera server offline</span>
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

	<!-- Simulation View: Wall scene with projection overlay -->
	<div class="relative inline-block" style="perspective: 800px;">
		<!-- Base: Wall scene -->
		<img
			src="/fixtures/IMG_0819.jpeg"
			alt="Wall scene"
			class="max-w-full h-auto"
			style="max-height: 70vh;"
		/>

		<!-- Simulated projection area with perspective distortion -->
		<div
			class="absolute"
			style="
				top: 5%;
				left: 12%;
				width: 65%;
				height: 50%;
				transform: rotateY(30deg) rotateX(0deg) rotateZ(0deg);
				transform-origin: center center;
			"
		>
			{#if appState.current.mode === 'calibrating' && appState.current.calibration.status === 'showing-markers'}
				<!-- Calibration: white background with markers -->
				<div class="w-full h-full bg-white relative" style="opacity: 0.92;">
					<img src="/markers/marker-0.svg" alt="Marker 0" class="absolute top-2 left-2 w-10 h-10" />
					<img src="/markers/marker-1.svg" alt="Marker 1" class="absolute top-2 right-2 w-10 h-10" />
					<img src="/markers/marker-2.svg" alt="Marker 2" class="absolute bottom-2 left-2 w-10 h-10" />
					<img src="/markers/marker-3.svg" alt="Marker 3" class="absolute bottom-2 right-2 w-10 h-10" />
				</div>
			{:else}
				<!-- Idle: dark projection color -->
				<div
					class="w-full h-full"
					style="background-color: {appState.current.projection.color}; opacity: 0.85;"
				></div>
			{/if}
		</div>
	</div>
</div>
