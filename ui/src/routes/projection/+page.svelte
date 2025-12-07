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
		createWallTextureAnimation,
		type Animation,
		type AnimationRenderState
	} from '$lib/animations';

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
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

	onMount(async () => {
		startPolling(500);
		ctx = canvas.getContext('2d');
		markerImages = await loadMarkerImages();

		// Start with no masks - will load from shared state
		transformedMasks = [];

		// Create animations with update callbacks
		animations.set('feliz-navidad', createFelizNavidadAnimation((state) => {
			animationStates.set('feliz-navidad', state);
			render();
		}));

		animations.set('pom-pom', createPomPomAnimation((state) => {
			animationStates.set('pom-pom', state);
			render();
		}));

		animations.set('wall-texture', createWallTextureAnimation((state) => {
			animationStates.set('wall-texture', state);
			render();
		}));

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
	let lastMaskState = '';
	$effect(() => {
		const masks = appState.current.projection.masks;
		// Track both IDs and enabled state
		const currentState = masks.map(m => `${m.id}:${m.enabled !== false}`).join(',');

		// Only reload if masks or enabled state changed
		if (currentState !== lastMaskState && masks.length > 0) {
			lastMaskState = currentState;
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
		// Stop all animations
		animations.forEach(anim => anim.stop());
	});

	function render() {
		if (!ctx) return;
		// Filter masks by enabled state and get corresponding animation states
		const masks = appState.current.projection.masks;
		const activeMasks: HTMLCanvasElement[] = [];
		const activeAnimStates: AnimationRenderState[] = [];
		for (let i = 0; i < masks.length; i++) {
			const mask = masks[i];
			if (mask?.enabled !== false && transformedMasks[i]) {
				activeMasks.push(transformedMasks[i]);
				activeAnimStates.push(animationStates.get(mask.id) || { opacity: 1, color: '#FFD700' });
			}
		}
		renderProjection(ctx, appState.current, markerImages, activeMasks, activeAnimStates);
	}

	// Start/stop animations based on mode AND mask enabled state
	$effect(() => {
		const mode = appState.current.mode;
		const masks = appState.current.projection.masks;
		const isProjecting = mode === 'projecting';

		// Build set of enabled mask IDs
		const enabledMaskIds = new Set(
			masks.filter(m => m.enabled !== false).map(m => m.id)
		);

		// Each animation runs only if projecting AND its mask is enabled
		animations.forEach((anim, maskId) => {
			const shouldRun = isProjecting && enabledMaskIds.has(maskId);
			if (shouldRun) {
				anim.start();
			} else {
				anim.stop();
			}
		});
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
