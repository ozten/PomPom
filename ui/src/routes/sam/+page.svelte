<script lang="ts">
	import { onDestroy } from 'svelte';
	import { segmentImage, urlToDataUrl, type SegmentationResult } from '$lib/sam';

	// Available fixture images (only shown in simulation mode)
	const FIXTURES = [
		{ name: 'Webcam Capture (Simulation)', path: '/fixtures/webcam_capture.png' },
		{ name: 'Wall (IMG_0819)', path: '/fixtures/IMG_0819.jpeg' },
		{ name: 'Projector', path: '/fixtures/projector.png' },
		{ name: 'Webcam', path: '/fixtures/webcam.jpg' },
		{ name: 'Calibration', path: '/fixtures/calibration.png' }
	];

	// Image source mode
	let imageMode = $state<'simulation' | 'live'>('simulation');

	// Webcam state
	let webcamStream = $state<MediaStream | null>(null);
	let videoElement: HTMLVideoElement;
	let availableCameras = $state<MediaDeviceInfo[]>([]);
	let selectedCameraId = $state<string>('');
	let webcamError = $state<string | null>(null);

	// State
	let selectedFixture = $state(FIXTURES[0].path);
	let customUrl = $state('');
	let prompt = $state('Feliz Navidad');
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let result = $state<SegmentationResult | null>(null);
	let imageDataUrl = $state<string | null>(null);

	// Cleanup on destroy
	onDestroy(() => {
		stopWebcam();
	});

	// Webcam functions
	async function enumerateCameras() {
		try {
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
	}

	function captureWebcamFrame(): string | null {
		if (!videoElement || !webcamStream || videoElement.readyState < 2) {
			return null;
		}

		const canvas = document.createElement('canvas');
		canvas.width = videoElement.videoWidth;
		canvas.height = videoElement.videoHeight;
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;

		ctx.drawImage(videoElement, 0, 0);
		return canvas.toDataURL('image/png');
	}

	// Mode switching
	async function switchToLiveMode() {
		imageMode = 'live';
		await enumerateCameras();
		if (availableCameras.length > 0) {
			await startWebcam();
		}
	}

	function switchToSimulationMode() {
		imageMode = 'simulation';
		stopWebcam();
		loadImage();
	}

	async function onCameraChange() {
		if (imageMode === 'live' && selectedCameraId) {
			await startWebcam();
		}
	}

	// Load selected image (simulation mode)
	async function loadImage() {
		if (imageMode === 'live') return;
		const url = customUrl || selectedFixture;
		try {
			imageDataUrl = await urlToDataUrl(url);
		} catch (e) {
			error = `Failed to load image: ${e}`;
		}
	}

	// Run segmentation
	async function runSegmentation() {
		isLoading = true;
		error = null;
		result = null;

		try {
			let dataUrl: string | null = null;

			if (imageMode === 'live') {
				dataUrl = captureWebcamFrame();
				if (!dataUrl) {
					throw new Error('Failed to capture webcam frame. Is the camera ready?');
				}
				imageDataUrl = dataUrl; // Store for display
			} else {
				if (!imageDataUrl) {
					await loadImage();
				}
				dataUrl = imageDataUrl;
			}

			if (!dataUrl) {
				throw new Error('No image available');
			}

			result = await segmentImage(dataUrl, prompt);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Segmentation failed';
		} finally {
			isLoading = false;
		}
	}

	// Auto-load image when fixture changes (simulation mode only)
	$effect(() => {
		const _ = selectedFixture;
		if (imageMode === 'simulation' && !customUrl) {
			loadImage();
		}
	});
</script>

<svelte:head>
	<title>SAM Debug</title>
</svelte:head>

<div class="min-h-screen bg-gray-900 text-white p-4">
	<h1 class="text-xl font-bold mb-4">SAM Debug Page</h1>

	<!-- Mode Toggle -->
	<div class="mb-4 p-3 border border-gray-600 rounded">
		<div class="flex items-center gap-4 mb-2">
			<span class="text-sm font-medium">Image Source:</span>
			<label class="flex items-center gap-2 cursor-pointer">
				<input
					type="radio"
					name="imageMode"
					value="simulation"
					checked={imageMode === 'simulation'}
					onchange={switchToSimulationMode}
					class="accent-blue-500"
				/>
				<span class="text-sm">Simulation (Fixture)</span>
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
				{:else if webcamError}
					<span class="text-red-400 text-sm">{webcamError}</span>
				{:else}
					<span class="text-yellow-400 text-sm">Connecting...</span>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Image Selection (Simulation mode only) -->
	{#if imageMode === 'simulation'}
		<div class="mb-4 flex gap-4 items-end">
			<div>
				<label class="block text-sm text-gray-400 mb-1">Fixture Image</label>
				<select
					bind:value={selectedFixture}
					class="bg-gray-800 border border-gray-600 rounded px-3 py-2"
				>
					{#each FIXTURES as fixture}
						<option value={fixture.path}>{fixture.name}</option>
					{/each}
				</select>
			</div>
			<div class="flex-1">
				<label class="block text-sm text-gray-400 mb-1">Or Custom URL</label>
				<input
					type="text"
					bind:value={customUrl}
					placeholder="https://example.com/image.jpg"
					class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2"
				/>
			</div>
		</div>
	{/if}

	<!-- Prompt Input -->
	<div class="mb-4 flex gap-4 items-end">
		<div class="flex-1">
			<label class="block text-sm text-gray-400 mb-1">Prompt</label>
			<input
				type="text"
				bind:value={prompt}
				placeholder="e.g., Feliz Navidad, pom pom"
				class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2"
			/>
		</div>
		<button
			onclick={runSegmentation}
			disabled={isLoading}
			class="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-6 py-2 rounded font-medium"
		>
			{isLoading ? 'Segmenting...' : 'Segment'}
		</button>
	</div>

	<!-- Error Display -->
	{#if error}
		<div class="mb-4 p-3 bg-red-900 border border-red-700 rounded text-red-200">
			Error: {error}
		</div>
	{/if}

	<!-- Results Grid -->
	<div class="grid grid-cols-2 gap-4">
		<!-- Source Image -->
		<div>
			<h2 class="text-lg font-semibold mb-2">Source Image</h2>
			<div class="bg-gray-800 rounded p-2">
				{#if imageMode === 'live'}
					<video
						bind:this={videoElement}
						class="max-w-full h-auto"
						autoplay
						playsinline
						muted
					></video>
				{:else if imageDataUrl}
					<img src={imageDataUrl} alt="Source" class="max-w-full h-auto" />
				{:else}
					<div class="text-gray-500 p-8 text-center">Loading...</div>
				{/if}
			</div>
		</div>

		<!-- Mask Results -->
		<div>
			<h2 class="text-lg font-semibold mb-2">Mask Results</h2>
			<div class="bg-gray-800 rounded p-2 min-h-[200px]">
				{#if isLoading}
					<div class="text-gray-500 p-8 text-center">Processing...</div>
				{:else if result?.masks && result.masks.length > 0}
					<div class="grid grid-cols-2 gap-2">
						{#each result.masks as mask, i}
							<div class="bg-gray-700 rounded p-2">
								<img src={mask.url} alt="Mask {i}" class="w-full h-auto" />
								{#if result.scores && result.scores[i] !== undefined}
									<div class="text-xs text-gray-400 mt-1">
										Score: {(result.scores[i] * 100).toFixed(1)}%
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{:else if result}
					<div class="text-gray-500 p-8 text-center">No masks returned</div>
				{:else}
					<div class="text-gray-500 p-8 text-center">
						Click "Segment" to run SAM
					</div>
				{/if}
			</div>
		</div>
	</div>

	<!-- Raw Response -->
	{#if result}
		<div class="mt-4">
			<h2 class="text-lg font-semibold mb-2">Raw Response</h2>
			<pre class="bg-gray-800 rounded p-3 overflow-auto text-xs text-gray-300 max-h-64">
{JSON.stringify(result, null, 2)}
			</pre>
		</div>
	{/if}
</div>
