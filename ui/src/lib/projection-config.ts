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

// SAM prompts for mask generation
// Past prompts that have been tried:
//   pom-pom: 'garland' - didn't detect pom-poms well
//   pom-pom: 'colorful pom poms' - (alternative)
//   pom-pom: 'pom pom' - (alternative)
//   pom-pom: 'fuzzy balls' - (alternative)
//   pom-pom: 'round decorations' - (alternative)
//   pom-pom: 'Strand of garland' - works well!
//   pom-pom: 'Strand of colorful balls' - current
// Disabled prompts:
//   { id: 'feliz-navidad', prompt: 'Feliz Navidad!' } - direction not liked
export const SAM_PROMPTS = [
	{ id: 'pom-pom', prompt: 'Strand of colorful balls' }
];

// Simulation image path (relative to static/)
export const SIMULATION_IMAGE_PATH = '/fixtures/webcam_capture.png';

// Camera/wall image dimensions (webcam capture)
export const CAMERA_IMAGE_SIZE = {
	width: 640,
	height: 480
};

/**
 * SIMULATION_QUAD defines where the projection appears in the camera/wall image.
 * This is a trapezoid due to the camera viewing angle.
 *
 * These coordinates were measured from the fixture image (webcam_capture.png).
 * The quad maps to the full projector output (0,0)-(1920,1080).
 *
 * NOTE: These are estimated values for the new webcam capture.
 * Run real calibration to get accurate values for your setup.
 */
export const SIMULATION_QUAD: Quad = {
	topLeft: { x: 30, y: 80 },
	topRight: { x: 610, y: 80 },
	bottomLeft: { x: 30, y: 450 },
	bottomRight: { x: 610, y: 450 }
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
