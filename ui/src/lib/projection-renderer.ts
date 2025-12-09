/**
 * Shared projection renderer
 * Used by both /projection (actual output) and /control (simulation)
 */

import type { AppState } from './types';
import type { AnimationRenderState } from './animations/types';
import type { IslandPhoto } from './animations/island-photos';
import type { SpotlightInfo, SparkParticle } from './animations/spotlight';
import { PROJECTOR_WIDTH, PROJECTOR_HEIGHT } from './projection-config';

// Re-export for backwards compatibility
export { PROJECTOR_WIDTH, PROJECTOR_HEIGHT };

/** Default render state when no animation is active */
const DEFAULT_RENDER_STATE: AnimationRenderState = {
	opacity: 1,
	color: '#FFD700' // Gold
};

// Hardcoded mask paths for prototyping
const HARDCODED_MASKS = ['/masks/feliz-navidad.png', '/masks/garland.png'];

// Marker configuration
export const MARKER_SIZE = 200;
export const MARKER_MARGIN = 40;

// Which marker IDs to use (can be changed for debugging)
// Using IDs 0-3 from DICT_4X4_50
export let MARKER_IDS = [0, 1, 2, 3];

// Marker positions in projector coordinates
export function getMarkerPositions(ids: number[] = MARKER_IDS) {
	return [
		{ id: ids[0], x: MARKER_MARGIN, y: MARKER_MARGIN }, // top-left
		{ id: ids[1], x: PROJECTOR_WIDTH - MARKER_MARGIN - MARKER_SIZE, y: MARKER_MARGIN }, // top-right
		{ id: ids[2], x: MARKER_MARGIN, y: PROJECTOR_HEIGHT - MARKER_MARGIN - MARKER_SIZE }, // bottom-left
		{
			id: ids[3],
			x: PROJECTOR_WIDTH - MARKER_MARGIN - MARKER_SIZE,
			y: PROJECTOR_HEIGHT - MARKER_MARGIN - MARKER_SIZE
		} // bottom-right
	];
}

// For backwards compatibility
export const MARKER_POSITIONS = getMarkerPositions();

/**
 * Render the projection content to a canvas context
 * This is the source of truth for what the projector outputs
 *
 * @param ctx - Canvas 2D context to render to
 * @param state - Application state
 * @param markerImages - ArUco marker images for calibration
 * @param transformedMasks - Pre-transformed mask canvases at projector resolution
 * @param animationStates - Per-mask animation states [feliz-navidad, garland]
 * @param islandPhotos - Photos to render in island positions
 * @param islandsMask - The islands-only mask for clipping photos
 * @param spotlights - Spotlight positions and sizes to render
 * @param particles - Spark particles to render
 */
export function renderProjection(
	ctx: CanvasRenderingContext2D,
	state: AppState,
	markerImages: HTMLImageElement[],
	transformedMasks: HTMLCanvasElement[] = [],
	animationStates: AnimationRenderState[] = [],
	islandPhotos: IslandPhoto[] = [],
	islandsMask?: HTMLCanvasElement,
	spotlights: SpotlightInfo[] = [],
	particles: SparkParticle[] = []
): void {
	const { mode, calibration, projection } = state;

	// Clear canvas
	ctx.clearRect(0, 0, PROJECTOR_WIDTH, PROJECTOR_HEIGHT);

	if (mode === 'calibrating' && calibration.status === 'showing-markers') {
		// Calibration mode: white background with ArUco markers
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, PROJECTOR_WIDTH, PROJECTOR_HEIGHT);

		// Draw markers in corners
		// Use pos.id to select which marker image (allows testing with same marker in all corners)
		if (markerImages.length >= 4) {
			for (let i = 0; i < 4; i++) {
				const pos = MARKER_POSITIONS[i];
				ctx.drawImage(markerImages[pos.id], pos.x, pos.y, MARKER_SIZE, MARKER_SIZE);
			}
		}
	} else if (mode === 'projecting') {
		// Projecting mode: dark background + animated masks
		// Each mask has its own animation state (opacity, color)

		// Draw background first
		ctx.fillStyle = projection.color;
		ctx.fillRect(0, 0, PROJECTOR_WIDTH, PROJECTOR_HEIGHT);

		// Render each pre-transformed mask with its animation state
		for (let i = 0; i < transformedMasks.length; i++) {
			const maskCanvas = transformedMasks[i];
			const animState = animationStates[i] || DEFAULT_RENDER_STATE;

			// Skip if fully transparent
			if (animState.opacity <= 0) continue;

			// Save context state
			ctx.save();

			// Set global alpha for opacity
			ctx.globalAlpha = animState.opacity;

			// Use screen blend mode for additive light simulation
			ctx.globalCompositeOperation = 'screen';

			// Create temporary canvas for color tinting
			const tempCanvas = document.createElement('canvas');
			tempCanvas.width = PROJECTOR_WIDTH;
			tempCanvas.height = PROJECTOR_HEIGHT;
			const tempCtx = tempCanvas.getContext('2d')!;

			// Draw pre-transformed mask to temp canvas
			tempCtx.drawImage(maskCanvas, 0, 0);

			// Apply color tint using source-in
			tempCtx.globalCompositeOperation = 'source-in';
			tempCtx.fillStyle = animState.color;
			tempCtx.fillRect(0, 0, PROJECTOR_WIDTH, PROJECTOR_HEIGHT);

			// Draw the tinted mask to main canvas (using screen blend)
			ctx.drawImage(tempCanvas, 0, 0);

			// Restore context state
			ctx.restore();
		}

		// Render island photos if available (using screen blend for additive light)
		if (islandPhotos.length > 0 && islandsMask) {
			ctx.save();
			ctx.globalCompositeOperation = 'screen';
			renderIslandPhotos(ctx, islandPhotos, islandsMask);
			ctx.restore();
		}

		// Render spotlights if available (using screen blend for additive light)
		if (spotlights.length > 0) {
			ctx.save();
			ctx.globalCompositeOperation = 'screen';
			renderSpotlights(ctx, spotlights);
			ctx.restore();
		}

		// Render spark particles if available (using screen blend for additive light)
		if (particles.length > 0) {
			ctx.save();
			ctx.globalCompositeOperation = 'screen';
			renderParticles(ctx, particles);
			ctx.restore();
		}
	} else {
		// Idle mode: solid color
		ctx.fillStyle = projection.color;
		ctx.fillRect(0, 0, PROJECTOR_WIDTH, PROJECTOR_HEIGHT);

		// Still render island photos in idle mode for preview
		if (islandPhotos.length > 0 && islandsMask) {
			ctx.save();
			ctx.globalCompositeOperation = 'screen';
			renderIslandPhotos(ctx, islandPhotos, islandsMask);
			ctx.restore();
		}
	}
}

/**
 * Render photos into island positions, clipped to the islands mask
 * Each photo has its own opacity for fade in/out effects
 */
function renderIslandPhotos(
	ctx: CanvasRenderingContext2D,
	photos: IslandPhoto[],
	islandsMask: HTMLCanvasElement
): void {
	// Render each photo separately to support per-photo opacity
	for (const photo of photos) {
		if (!photo.image) continue;
		const opacity = photo.opacity ?? 1;
		if (opacity <= 0) continue;

		const { minX, minY, maxX, maxY } = photo.boundingBox;
		const width = maxX - minX + 1;
		const height = maxY - minY + 1;

		// Create a temporary canvas for this photo
		const tempCanvas = document.createElement('canvas');
		tempCanvas.width = PROJECTOR_WIDTH;
		tempCanvas.height = PROJECTOR_HEIGHT;
		const tempCtx = tempCanvas.getContext('2d')!;

		// Draw photo scaled to fill the bounding box
		// Use object-fit: cover behavior - scale to fill, crop excess
		const imgAspect = photo.image.width / photo.image.height;
		const boxAspect = width / height;

		let srcX = 0,
			srcY = 0,
			srcW = photo.image.width,
			srcH = photo.image.height;

		if (imgAspect > boxAspect) {
			// Image is wider - crop sides
			srcW = photo.image.height * boxAspect;
			srcX = (photo.image.width - srcW) / 2;
		} else {
			// Image is taller - crop top/bottom
			srcH = photo.image.width / boxAspect;
			srcY = (photo.image.height - srcH) / 2;
		}

		tempCtx.drawImage(photo.image, srcX, srcY, srcW, srcH, minX, minY, width, height);

		// Apply the islands mask using destination-in
		// This keeps only the parts of the photo that overlap with islands
		tempCtx.globalCompositeOperation = 'destination-in';
		tempCtx.drawImage(islandsMask, 0, 0);

		// Draw the masked photo to the main canvas with opacity
		ctx.save();
		ctx.globalAlpha = opacity;
		ctx.drawImage(tempCanvas, 0, 0);
		ctx.restore();
	}
}

/**
 * Render spotlights as glowing white circles
 */
function renderSpotlights(ctx: CanvasRenderingContext2D, spotlights: SpotlightInfo[]): void {
	for (const spotlight of spotlights) {
		if (spotlight.diameter <= 0 || spotlight.opacity <= 0) continue;

		const radius = spotlight.diameter / 2;

		ctx.save();
		ctx.globalAlpha = spotlight.opacity;

		// Create radial gradient for soft glow effect
		const gradient = ctx.createRadialGradient(
			spotlight.x,
			spotlight.y,
			0,
			spotlight.x,
			spotlight.y,
			radius
		);

		// White core fading to transparent edge
		gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
		gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.9)');
		gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.5)');
		gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.2)');
		gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

		// Draw the spotlight
		ctx.fillStyle = gradient;
		ctx.beginPath();
		ctx.arc(spotlight.x, spotlight.y, radius, 0, Math.PI * 2);
		ctx.fill();

		ctx.restore();
	}
}

/**
 * Render spark particles as small glowing circles
 */
function renderParticles(ctx: CanvasRenderingContext2D, particles: SparkParticle[]): void {
	for (const particle of particles) {
		if (particle.opacity <= 0 || particle.size <= 0) continue;

		ctx.save();
		ctx.globalAlpha = particle.opacity;

		// Create radial gradient for soft glow effect
		const gradient = ctx.createRadialGradient(
			particle.x,
			particle.y,
			0,
			particle.x,
			particle.y,
			particle.size
		);

		// Use particle color with gradient fade
		gradient.addColorStop(0, particle.color);
		gradient.addColorStop(0.4, particle.color);
		gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

		// Draw the particle
		ctx.fillStyle = gradient;
		ctx.beginPath();
		ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
		ctx.fill();

		ctx.restore();
	}
}

/**
 * Create an offscreen canvas with the projection content
 * Useful for getting ImageData without an on-screen canvas
 */
export async function createProjectionImage(
	state: AppState,
	markerImages: HTMLImageElement[]
): Promise<ImageData> {
	const canvas = document.createElement('canvas');
	canvas.width = PROJECTOR_WIDTH;
	canvas.height = PROJECTOR_HEIGHT;
	const ctx = canvas.getContext('2d')!;

	renderProjection(ctx, state, markerImages);

	return ctx.getImageData(0, 0, PROJECTOR_WIDTH, PROJECTOR_HEIGHT);
}

/**
 * Load marker images
 */
export async function loadMarkerImages(): Promise<HTMLImageElement[]> {
	const loadImage = (src: string): Promise<HTMLImageElement> =>
		new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = reject;
			img.src = src;
		});

	return Promise.all([
		loadImage('/markers/marker-0.svg'),
		loadImage('/markers/marker-1.svg'),
		loadImage('/markers/marker-2.svg'),
		loadImage('/markers/marker-3.svg')
	]);
}

/**
 * Load SAM mask images for projection
 */
export async function loadSamMaskImages(): Promise<HTMLImageElement[]> {
	const loadImage = (src: string): Promise<HTMLImageElement> =>
		new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = reject;
			img.src = src;
		});

	return Promise.all(HARDCODED_MASKS.map((src) => loadImage(src)));
}
