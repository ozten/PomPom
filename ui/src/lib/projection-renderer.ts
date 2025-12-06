/**
 * Shared projection renderer
 * Used by both /projection (actual output) and /control (simulation)
 */

import type { AppState } from './types';
import type { AnimationRenderState } from './animations/types';

/** Default render state when no animation is active */
const DEFAULT_RENDER_STATE: AnimationRenderState = {
	opacity: 1,
	color: '#FFD700' // Gold
};

// Projector resolution
export const PROJECTOR_WIDTH = 1920;
export const PROJECTOR_HEIGHT = 1080;

// Hardcoded mask paths for prototyping
const HARDCODED_MASKS = ['/masks/feliz-navidad.png', '/masks/garland.png'];

// Projection area bounds in camera/mask image coordinates
// This is the bounding box of where the projection appears in the camera view
// Derived from PROJECTION_QUAD in /control
const MASK_CROP_BOUNDS = {
	x: 240,
	y: 165,
	width: 670, // ~910 - 240
	height: 535 // ~700 - 165
};

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
 * @param samMaskImages - SAM mask images [feliz-navidad, garland]
 * @param animationStates - Per-mask animation states [feliz-navidad, garland]
 */
export function renderProjection(
	ctx: CanvasRenderingContext2D,
	state: AppState,
	markerImages: HTMLImageElement[],
	samMaskImages: HTMLImageElement[] = [],
	animationStates: AnimationRenderState[] = []
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

		// Render each mask with its animation state
		for (let i = 0; i < samMaskImages.length; i++) {
			const maskImg = samMaskImages[i];
			const animState = animationStates[i] || DEFAULT_RENDER_STATE;

			// Skip if fully transparent
			if (animState.opacity <= 0) continue;

			// Save context state
			ctx.save();

			// Set global alpha for opacity
			ctx.globalAlpha = animState.opacity;

			// Create temporary canvas for this mask
			const tempCanvas = document.createElement('canvas');
			tempCanvas.width = PROJECTOR_WIDTH;
			tempCanvas.height = PROJECTOR_HEIGHT;
			const tempCtx = tempCanvas.getContext('2d')!;

			// Draw mask to temp canvas
			tempCtx.drawImage(
				maskImg,
				MASK_CROP_BOUNDS.x,
				MASK_CROP_BOUNDS.y,
				MASK_CROP_BOUNDS.width,
				MASK_CROP_BOUNDS.height,
				0,
				0,
				PROJECTOR_WIDTH,
				PROJECTOR_HEIGHT
			);

			// Apply color tint using source-in
			tempCtx.globalCompositeOperation = 'source-in';
			tempCtx.fillStyle = animState.color;
			tempCtx.fillRect(0, 0, PROJECTOR_WIDTH, PROJECTOR_HEIGHT);

			// Draw the tinted mask to main canvas
			ctx.drawImage(tempCanvas, 0, 0);

			// Restore context state
			ctx.restore();
		}
	} else {
		// Idle mode: solid color
		ctx.fillStyle = projection.color;
		ctx.fillRect(0, 0, PROJECTOR_WIDTH, PROJECTOR_HEIGHT);
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
