<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { startPolling, stopPolling, appState } from '$lib/state.svelte';
	import {
		PROJECTOR_WIDTH,
		PROJECTOR_HEIGHT,
		renderProjection,
		loadMarkerImages
	} from '$lib/projection-renderer';
	import {
		createFelizNavidadAnimation,
		createPomPomAnimation,
		type Animation,
		type AnimationRenderState
	} from '$lib/animations';

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let markerImages: HTMLImageElement[] = [];
	let transformedMasks: HTMLCanvasElement[] = [];

	// Animation instances
	let felizNavidadAnim: Animation | null = null;
	let pomPomAnim: Animation | null = null;

	// Current animation render states
	let animationStates: AnimationRenderState[] = [
		{ opacity: 1, color: '#FFD700' }, // Feliz Navidad
		{ opacity: 1, color: '#FFD700' } // Pom Pom
	];

	onMount(async () => {
		startPolling(500);
		ctx = canvas.getContext('2d');
		markerImages = await loadMarkerImages();

		// Start with no masks - will load from shared state
		transformedMasks = [];

		// Create animations with update callbacks
		felizNavidadAnim = createFelizNavidadAnimation((state) => {
			animationStates[0] = state;
			render();
		});

		pomPomAnim = createPomPomAnimation((state) => {
			animationStates[1] = state;
			render();
		});

		render();
	});

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

	// Load masks from shared state when they change
	let lastMaskIds = '';
	$effect(() => {
		const masks = appState.current.projection.masks;
		const currentIds = masks.map(m => m.id).join(',');

		// Only reload if masks changed
		if (currentIds !== lastMaskIds && masks.length > 0) {
			lastMaskIds = currentIds;
			Promise.all(
				masks.map(m => base64ToCanvas(m.imageData, m.bounds.width, m.bounds.height))
			).then(canvases => {
				transformedMasks = canvases;
				render();
			});
		} else if (masks.length === 0 && transformedMasks.length > 0) {
			// Clear masks if state was cleared
			transformedMasks = [];
			render();
		}
	});

	onDestroy(() => {
		stopPolling();
		// Stop animations
		felizNavidadAnim?.stop();
		pomPomAnim?.stop();
	});

	function render() {
		if (!ctx) return;
		renderProjection(ctx, appState.current, markerImages, transformedMasks, animationStates);
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

	// Re-render when state changes (for non-animated states)
	$effect(() => {
		const _ = appState.current.calibration.status;
		const __ = appState.current.projection;
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
