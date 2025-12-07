<script lang="ts">
	import { urlToDataUrl } from '$lib/sam';
	import { cleanWallImage, generateWallMaskImage, extractRedAsMask } from '$lib/wall-mask';

	// Available fixture images
	const FIXTURES = [
		{ name: 'Webcam Capture (Simulation)', path: '/fixtures/webcam_capture.png' },
		{ name: 'Wall (IMG_0819)', path: '/fixtures/IMG_0819.jpeg' },
		{ name: 'Projector', path: '/fixtures/projector.png' },
		{ name: 'Webcam', path: '/fixtures/webcam.jpg' }
	];

	// State
	let selectedFixture = $state(FIXTURES[0].path);
	let customUrl = $state('');
	let isLoading = $state(false);
	let loadingStep = $state<string | null>(null);
	let error = $state<string | null>(null);

	// Results
	let sourceImageUrl = $state<string | null>(null);
	let cleanedImageUrl = $state<string | null>(null);
	let redPaintedImageUrl = $state<string | null>(null);
	let maskCanvas = $state<HTMLCanvasElement | null>(null);
	let maskDataUrl = $state<string | null>(null);

	// Load selected image
	async function loadImage() {
		const url = customUrl || selectedFixture;
		try {
			sourceImageUrl = await urlToDataUrl(url);
		} catch (e) {
			error = `Failed to load image: ${e}`;
		}
	}

	// Step 1: Clean wall (remove decorations)
	async function runStep1() {
		if (!sourceImageUrl) {
			await loadImage();
		}
		if (!sourceImageUrl) return;

		isLoading = true;
		loadingStep = 'Removing decorations...';
		error = null;
		cleanedImageUrl = null;

		try {
			const result = await cleanWallImage(sourceImageUrl);
			if (result.images && result.images.length > 0) {
				cleanedImageUrl = result.images[0].url;
			} else {
				throw new Error('No images returned');
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Clean wall failed';
		} finally {
			isLoading = false;
			loadingStep = null;
		}
	}

	// Step 2: Paint wall texture red
	async function runStep2() {
		const inputUrl = cleanedImageUrl || sourceImageUrl;
		if (!inputUrl) {
			error = 'No image available. Run Step 1 first or load an image.';
			return;
		}

		isLoading = true;
		loadingStep = 'Painting wall texture red...';
		error = null;
		redPaintedImageUrl = null;

		try {
			// Convert URL to data URL if needed
			const imageDataUrl = inputUrl.startsWith('data:')
				? inputUrl
				: await urlToDataUrl(inputUrl);

			const result = await generateWallMaskImage(imageDataUrl);
			if (result.images && result.images.length > 0) {
				redPaintedImageUrl = result.images[0].url;
			} else {
				throw new Error('No images returned');
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Wall mask failed';
		} finally {
			isLoading = false;
			loadingStep = null;
		}
	}

	// Step 3: Extract mask from red-painted image
	async function runStep3() {
		if (!redPaintedImageUrl) {
			error = 'No red-painted image. Run Step 2 first.';
			return;
		}

		isLoading = true;
		loadingStep = 'Extracting mask...';
		error = null;
		maskCanvas = null;
		maskDataUrl = null;

		try {
			const canvas = await extractRedAsMask(redPaintedImageUrl);
			maskCanvas = canvas;
			maskDataUrl = canvas.toDataURL('image/png');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Mask extraction failed';
		} finally {
			isLoading = false;
			loadingStep = null;
		}
	}

	// Run all steps
	async function runAllSteps() {
		await runStep1();
		if (!error && cleanedImageUrl) {
			await runStep2();
		}
		if (!error && redPaintedImageUrl) {
			await runStep3();
		}
	}

	// Auto-load image when fixture changes
	$effect(() => {
		const _ = selectedFixture;
		if (!customUrl) {
			loadImage();
		}
	});
</script>

<svelte:head>
	<title>Wall Debug</title>
</svelte:head>

<div class="min-h-screen bg-gray-900 text-white p-4">
	<h1 class="text-xl font-bold mb-4">Wall Texture Debug Page</h1>
	<p class="text-gray-400 mb-4">
		Two-step pipeline: (1) Remove decorations, (2) Paint wall texture red, (3) Extract mask
	</p>

	<!-- Image Selection -->
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

	<!-- Action Buttons -->
	<div class="mb-4 flex gap-2">
		<button
			onclick={runStep1}
			disabled={isLoading}
			class="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-4 py-2 rounded font-medium"
		>
			Step 1: Remove Decorations
		</button>
		<button
			onclick={runStep2}
			disabled={isLoading}
			class="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-4 py-2 rounded font-medium"
		>
			Step 2: Paint Red
		</button>
		<button
			onclick={runStep3}
			disabled={isLoading || !redPaintedImageUrl}
			class="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 px-4 py-2 rounded font-medium"
		>
			Step 3: Extract Mask
		</button>
		<button
			onclick={runAllSteps}
			disabled={isLoading}
			class="bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 px-4 py-2 rounded font-medium"
		>
			Run All Steps
		</button>
	</div>

	<!-- Loading/Error Display -->
	{#if loadingStep}
		<div class="mb-4 p-3 bg-blue-900 border border-blue-700 rounded text-blue-200">
			{loadingStep}
		</div>
	{/if}

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
				{#if sourceImageUrl}
					<img src={sourceImageUrl} alt="Source" class="max-w-full h-auto" />
				{:else}
					<div class="text-gray-500 p-8 text-center">Loading...</div>
				{/if}
			</div>
		</div>

		<!-- Step 1: Cleaned Image -->
		<div>
			<h2 class="text-lg font-semibold mb-2">Step 1: Decorations Removed</h2>
			<div class="bg-gray-800 rounded p-2 min-h-[200px]">
				{#if cleanedImageUrl}
					<img src={cleanedImageUrl} alt="Cleaned" class="max-w-full h-auto" />
				{:else}
					<div class="text-gray-500 p-8 text-center">
						Click "Step 1" to remove decorations
					</div>
				{/if}
			</div>
		</div>

		<!-- Step 2: Red-Painted Image -->
		<div>
			<h2 class="text-lg font-semibold mb-2">Step 2: Wall Texture Painted Red</h2>
			<div class="bg-gray-800 rounded p-2 min-h-[200px]">
				{#if redPaintedImageUrl}
					<img src={redPaintedImageUrl} alt="Red Painted" class="max-w-full h-auto" />
				{:else}
					<div class="text-gray-500 p-8 text-center">
						Click "Step 2" to paint wall texture
					</div>
				{/if}
			</div>
		</div>

		<!-- Step 3: Extracted Mask -->
		<div>
			<h2 class="text-lg font-semibold mb-2">Step 3: Extracted B&W Mask</h2>
			<div class="bg-gray-800 rounded p-2 min-h-[200px]">
				{#if maskDataUrl}
					<img src={maskDataUrl} alt="Mask" class="max-w-full h-auto bg-black" />
				{:else}
					<div class="text-gray-500 p-8 text-center">
						Click "Step 3" to extract mask
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
