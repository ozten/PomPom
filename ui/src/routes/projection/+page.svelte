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
		createSpotlightAnimation,
		createIslandPhotosAnimation,
		type Animation,
		type AnimationRenderState,
		type SpotlightInfo,
		type SparkParticle,
		type SpotlightAnimation,
		type IslandPhoto,
		type IslandPhotosAnimation
	} from '$lib/animations';
	import { PROJECTOR_WIDTH as PROJ_WIDTH, PROJECTOR_HEIGHT as PROJ_HEIGHT } from '$lib/projection-config';

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
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

	// Spotlight animation (not using $state to avoid effect cycles)
	let spotlightAnim: SpotlightAnimation | null = null;
	let spotlights: SpotlightInfo[] = [];
	let particles: SparkParticle[] = [];

	// Island photos animation (not using $state to avoid effect cycles)
	let islandPhotosAnim: IslandPhotosAnimation | null = null;
	let islandPhotos: IslandPhoto[] = [];
	let islandsMaskCanvas: HTMLCanvasElement | null = null;

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

		// Create spotlight animation
		spotlightAnim = createSpotlightAnimation((spots) => {
			spotlights = spots;
			// Get particles from the animation
			if (spotlightAnim) {
				particles = spotlightAnim.getParticles();
			}
			render();
		}, PROJ_WIDTH, PROJ_HEIGHT);

		// Create island photos animation
		islandPhotosAnim = createIslandPhotosAnimation((photos) => {
			islandPhotos = photos;
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
		spotlightAnim?.stop();
		islandPhotosAnim?.stop();
	});

	// Watch for sub-masks (islands) in shared state to set up island photos animation
	let lastSubMasksState = '';
	$effect(() => {
		const masks = appState.current.projection.masks;
		const wallMask = masks.find(m => m.id === 'wall-texture');

		if (wallMask?.subMasks && islandPhotosAnim) {
			const islandComponents = wallMask.subMasks.islandComponents || [];
			const currentState = `${islandComponents.length}:${wallMask.subMasks.islands.slice(0, 50)}`;

			if (currentState !== lastSubMasksState) {
				lastSubMasksState = currentState;

				// Capture values for the async callback
				const componentsToUse = islandComponents;
				const imageSrc = wallMask.subMasks.islands;

				// Load islands mask canvas from base64
				const img = new Image();
				img.onload = () => {
					const canvas = document.createElement('canvas');
					canvas.width = img.width;
					canvas.height = img.height;
					const ctx = canvas.getContext('2d')!;
					ctx.drawImage(img, 0, 0);
					islandsMaskCanvas = canvas;

					// Set island components for the photos animation and start it
					if (componentsToUse.length > 0) {
						islandPhotosAnim!.setIslands(componentsToUse);
						islandPhotosAnim!.start();
					}
				};
				img.src = imageSrc;
			}
		}
	});

	// Watch for pom-pom positions in shared state and mode changes
	let lastPomPomState = '';
	$effect(() => {
		const pomPoms = appState.current.projection.pomPoms;
		const mode = appState.current.mode;
		const animationsEnabled = appState.current.projection.animationsEnabled !== false;
		const currentState = `${mode}:${animationsEnabled}:${pomPoms?.length || 0}`;

		if (pomPoms && pomPoms.length > 0 && spotlightAnim) {
			// Convert to PomPomInfo format expected by spotlight animation
			const pomPomInfos = pomPoms.map(p => ({
				index: p.index,
				center: { x: p.x, y: p.y },
				radius: p.radius,
				pixelCount: 0,
				boundingBox: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
				circularity: 1,
				color: p.color // Pass through pre-sampled color
			}));

			// Update pom-poms if they changed
			if (currentState !== lastPomPomState) {
				lastPomPomState = currentState;
				spotlightAnim.setPomPoms(pomPomInfos);
			}

			// Start/stop based on mode AND animations enabled
			if (mode === 'projecting' && animationsEnabled) {
				spotlightAnim.start();
			} else {
				spotlightAnim.stop();
			}
		} else if (spotlightAnim) {
			spotlightAnim.stop();
		}
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
		renderProjection(ctx, appState.current, markerImages, activeMasks, activeAnimStates, islandPhotos, islandsMaskCanvas || undefined, spotlights, particles);
	}

	// Start/stop animations based on mode, mask enabled state, AND master toggle
	$effect(() => {
		const mode = appState.current.mode;
		const masks = appState.current.projection.masks;
		const animationsEnabled = appState.current.projection.animationsEnabled !== false; // Default true
		const isProjecting = mode === 'projecting';

		// Build set of enabled mask IDs
		const enabledMaskIds = new Set(
			masks.filter(m => m.enabled !== false).map(m => m.id)
		);

		// Each animation runs only if projecting AND its mask is enabled AND animations are enabled
		animations.forEach((anim, maskId) => {
			const shouldRun = isProjecting && animationsEnabled && enabledMaskIds.has(maskId);
			if (shouldRun) {
				anim.start();
			} else {
				anim.stop();
			}
		});

		// Also control spotlight and island photos animations
		if (spotlightAnim) {
			if (isProjecting && animationsEnabled) {
				// Let the pom-pom effect handle starting (it checks for pom-poms)
			} else {
				spotlightAnim.stop();
			}
		}
		if (islandPhotosAnim) {
			if (isProjecting && animationsEnabled) {
				// Start the animation if we have islands loaded
				// The setIslands call happens in the subMasks effect
				if (islandsMaskCanvas) {
					islandPhotosAnim.start();
				}
			} else {
				islandPhotosAnim.stop();
			}
		}
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
