<script lang="ts">
	import { segmentImage, urlToDataUrl, type SegmentationResult } from '$lib/sam';

	// Available fixture images
	const FIXTURES = [
		{ name: 'Wall (IMG_0819)', path: '/fixtures/IMG_0819.jpeg' },
		{ name: 'Projector', path: '/fixtures/projector.png' },
		{ name: 'Webcam', path: '/fixtures/webcam.jpg' },
		{ name: 'Calibration', path: '/fixtures/calibration.png' }
	];

	// State
	let selectedFixture = $state(FIXTURES[0].path);
	let customUrl = $state('');
	let prompt = $state('Feliz Navidad');
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let result = $state<SegmentationResult | null>(null);
	let imageDataUrl = $state<string | null>(null);

	// Load selected image
	async function loadImage() {
		const url = customUrl || selectedFixture;
		try {
			imageDataUrl = await urlToDataUrl(url);
		} catch (e) {
			error = `Failed to load image: ${e}`;
		}
	}

	// Run segmentation
	async function runSegmentation() {
		if (!imageDataUrl) {
			await loadImage();
		}
		if (!imageDataUrl) return;

		isLoading = true;
		error = null;
		result = null;

		try {
			result = await segmentImage(imageDataUrl, prompt);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Segmentation failed';
		} finally {
			isLoading = false;
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
	<title>SAM Debug</title>
</svelte:head>

<div class="min-h-screen bg-gray-900 text-white p-4">
	<h1 class="text-xl font-bold mb-4">SAM Debug Page</h1>

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
				{#if imageDataUrl}
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
