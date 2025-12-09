// Homography calculation via server-side OpenCV
import type { Point, DetectedMarker } from './aruco';

export interface HomographyResult {
	matrix: number[][]; // 3x3 homography matrix
	success: boolean;
	error?: string;
}

// Server URL - camera server runs on port 8000
const CAMERA_SERVER = 'http://localhost:8000';

/**
 * Calculate homography matrix from camera space to projector space via server API
 */
export async function calculateHomography(
	cameraCorners: Point[],
	projectorCorners: Point[]
): Promise<HomographyResult> {
	if (cameraCorners.length !== projectorCorners.length) {
		return {
			matrix: [],
			success: false,
			error: 'Camera and projector corner counts must match'
		};
	}

	if (cameraCorners.length < 4) {
		return {
			matrix: [],
			success: false,
			error: 'Need at least 4 point correspondences'
		};
	}

	try {
		const res = await fetch(`${CAMERA_SERVER}/homography`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				camera_points: cameraCorners,
				projector_points: projectorCorners
			})
		});

		if (!res.ok) {
			return {
				matrix: [],
				success: false,
				error: `Server error: ${res.status}`
			};
		}

		const data = await res.json();
		return {
			matrix: data.matrix,
			success: data.success,
			error: data.error
		};
	} catch (err) {
		return {
			matrix: [],
			success: false,
			error: err instanceof Error ? err.message : 'Request failed'
		};
	}
}

/**
 * Transform a single point using homography matrix (client-side)
 */
export function transformPoint(point: Point, H: number[][]): Point {
	const x = point.x;
	const y = point.y;

	// Apply homography: [x', y', w'] = H * [x, y, 1]
	const w = H[2][0] * x + H[2][1] * y + H[2][2];
	const xPrime = (H[0][0] * x + H[0][1] * y + H[0][2]) / w;
	const yPrime = (H[1][0] * x + H[1][1] * y + H[1][2]) / w;

	return { x: xPrime, y: yPrime };
}

/**
 * Transform multiple points using homography matrix (client-side)
 */
export function transformPoints(points: Point[], H: number[][]): Point[] {
	return points.map((p) => transformPoint(p, H));
}

/**
 * Get the known projector corner positions for markers
 * Markers are positioned at fixed offsets from the projection corners
 *
 * @param projectorWidth - Width of projector output in pixels
 * @param projectorHeight - Height of projector output in pixels
 * @param markerSize - Size of markers in pixels (default 96px = w-24 h-24)
 * @param margin - Margin from edge in pixels (default 16px = 4 tailwind units)
 */
export function getProjectorMarkerPositions(
	projectorWidth: number,
	projectorHeight: number,
	markerSize: number = 96,
	margin: number = 16
): Map<number, Point[]> {
	// Each marker's 4 corners (TL, TR, BR, BL) in projector space
	// Marker layout matches /projection page:
	// - Marker 0: top-left corner
	// - Marker 1: top-right corner
	// - Marker 2: bottom-left corner
	// - Marker 3: bottom-right corner

	const positions = new Map<number, Point[]>();

	// Marker 0 - top-left
	const m0x = margin;
	const m0y = margin;
	positions.set(0, [
		{ x: m0x, y: m0y }, // TL
		{ x: m0x + markerSize, y: m0y }, // TR
		{ x: m0x + markerSize, y: m0y + markerSize }, // BR
		{ x: m0x, y: m0y + markerSize } // BL
	]);

	// Marker 1 - top-right
	const m1x = projectorWidth - margin - markerSize;
	const m1y = margin;
	positions.set(1, [
		{ x: m1x, y: m1y }, // TL
		{ x: m1x + markerSize, y: m1y }, // TR
		{ x: m1x + markerSize, y: m1y + markerSize }, // BR
		{ x: m1x, y: m1y + markerSize } // BL
	]);

	// Marker 2 - bottom-left
	const m2x = margin;
	const m2y = projectorHeight - margin - markerSize;
	positions.set(2, [
		{ x: m2x, y: m2y }, // TL
		{ x: m2x + markerSize, y: m2y }, // TR
		{ x: m2x + markerSize, y: m2y + markerSize }, // BR
		{ x: m2x, y: m2y + markerSize } // BL
	]);

	// Marker 3 - bottom-right
	const m3x = projectorWidth - margin - markerSize;
	const m3y = projectorHeight - margin - markerSize;
	positions.set(3, [
		{ x: m3x, y: m3y }, // TL
		{ x: m3x + markerSize, y: m3y }, // TR
		{ x: m3x + markerSize, y: m3y + markerSize }, // BR
		{ x: m3x, y: m3y + markerSize } // BL
	]);

	return positions;
}

/**
 * Build point correspondences from detected markers and known projector positions
 * Returns parallel arrays of camera and projector points
 */
export function buildPointCorrespondences(
	detectedMarkers: DetectedMarker[],
	projectorPositions: Map<number, Point[]>
): { cameraPoints: Point[]; projectorPoints: Point[] } {
	const cameraPoints: Point[] = [];
	const projectorPoints: Point[] = [];

	for (const marker of detectedMarkers) {
		const projectorCorners = projectorPositions.get(marker.id);
		if (!projectorCorners) continue;

		// Add all 4 corners of this marker
		for (let i = 0; i < 4; i++) {
			cameraPoints.push(marker.corners[i]);
			projectorPoints.push(projectorCorners[i]);
		}
	}

	return { cameraPoints, projectorPoints };
}

/**
 * Extract the camera quad (projection boundary) from detected markers.
 * Uses the outer corners of the 4 calibration markers to define where
 * the projection appears in camera image space.
 *
 * Marker layout:
 * - Marker 0: top-left (use its top-left corner)
 * - Marker 1: top-right (use its top-right corner)
 * - Marker 2: bottom-left (use its bottom-left corner)
 * - Marker 3: bottom-right (use its bottom-right corner)
 */
export function extractCameraQuad(
	detectedMarkers: DetectedMarker[]
): { topLeft: Point; topRight: Point; bottomLeft: Point; bottomRight: Point } | null {
	// Need all 4 markers
	const markerMap = new Map<number, DetectedMarker>();
	for (const marker of detectedMarkers) {
		markerMap.set(marker.id, marker);
	}

	if (!markerMap.has(0) || !markerMap.has(1) || !markerMap.has(2) || !markerMap.has(3)) {
		return null;
	}

	// Marker corners are in order: TL, TR, BR, BL (indices 0, 1, 2, 3)
	// Extract the outer corners of each marker
	const marker0 = markerMap.get(0)!; // top-left marker
	const marker1 = markerMap.get(1)!; // top-right marker
	const marker2 = markerMap.get(2)!; // bottom-left marker
	const marker3 = markerMap.get(3)!; // bottom-right marker

	return {
		topLeft: marker0.corners[0],     // TL corner of top-left marker
		topRight: marker1.corners[1],    // TR corner of top-right marker
		bottomLeft: marker2.corners[3],  // BL corner of bottom-left marker
		bottomRight: marker3.corners[2]  // BR corner of bottom-right marker
	};
}
