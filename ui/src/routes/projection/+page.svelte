<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { startPolling, stopPolling, appState } from '$lib/state.svelte';
	import {
		PROJECTOR_WIDTH,
		PROJECTOR_HEIGHT,
		renderProjection,
		loadMarkerImages
	} from '$lib/projection-renderer';

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let markerImages: HTMLImageElement[] = [];

	onMount(async () => {
		startPolling(500);
		ctx = canvas.getContext('2d');
		markerImages = await loadMarkerImages();
		render();
	});

	onDestroy(() => {
		stopPolling();
	});

	function render() {
		if (!ctx) return;
		renderProjection(ctx, appState.current, markerImages);
	}

	// Re-render when state changes
	$effect(() => {
		const _ = appState.current.mode;
		const __ = appState.current.calibration.status;
		const ___ = appState.current.projection;
		render();
	});
</script>

<svelte:head>
	<title>Projection</title>
	<style>
		html, body {
			margin: 0;
			padding: 0;
			overflow: hidden;
			background: black;
		}
	</style>
</svelte:head>

<!--
	Canvas is fixed at 1920x1080 (projector resolution).
	CSS scales it to fill the viewport while maintaining aspect ratio.
-->
<div class="w-screen h-screen flex items-center justify-center bg-black">
	<canvas
		bind:this={canvas}
		width={PROJECTOR_WIDTH}
		height={PROJECTOR_HEIGHT}
		class="max-w-full max-h-full"
		style="aspect-ratio: 16/9;"
	></canvas>
</div>
