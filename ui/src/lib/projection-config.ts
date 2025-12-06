/**
 * Shared projection configuration
 *
 * Single source of truth for projection geometry.
 * Used by both /control (simulation) and /projection (actual output).
 */

export interface Point {
	x: number;
	y: number;
}

export interface Quad {
	topLeft: Point;
	topRight: Point;
	bottomLeft: Point;
	bottomRight: Point;
}

// Projector output resolution
export const PROJECTOR_WIDTH = 1920;
export const PROJECTOR_HEIGHT = 1080;

// Camera/wall image dimensions (portrait iPhone photo)
export const CAMERA_IMAGE_SIZE = {
	width: 996,
	height: 1328
};

/**
 * SIMULATION_QUAD defines where the projection appears in the camera/wall image.
 * This is a trapezoid due to the camera viewing angle.
 *
 * These coordinates were measured from the fixture image (IMG_0819.jpeg).
 * The quad maps to the full projector output (0,0)-(1920,1080).
 */
export const SIMULATION_QUAD: Quad = {
	topLeft: { x: 240, y: 165 },
	topRight: { x: 900, y: 290 },
	bottomLeft: { x: 240, y: 700 },
	bottomRight: { x: 910, y: 690 }
};

/**
 * Get projector rectangle corners (destination for homography)
 */
export function getProjectorRect(): Quad {
	return {
		topLeft: { x: 0, y: 0 },
		topRight: { x: PROJECTOR_WIDTH, y: 0 },
		bottomLeft: { x: 0, y: PROJECTOR_HEIGHT },
		bottomRight: { x: PROJECTOR_WIDTH, y: PROJECTOR_HEIGHT }
	};
}
