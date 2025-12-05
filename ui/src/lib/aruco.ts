// ArUco marker detection via server-side OpenCV

export interface Point {
	x: number;
	y: number;
}

export interface DetectedMarker {
	id: number;
	corners: [Point, Point, Point, Point]; // TL, TR, BR, BL
}

export interface DetectionResult {
	markers: DetectedMarker[];
	imageWidth: number;
	imageHeight: number;
	error?: string;
}

// Server URL - camera server runs on port 8000
const CAMERA_SERVER = 'http://localhost:8000';

/**
 * Check if the camera server is available
 */
export async function checkServerHealth(): Promise<{ ok: boolean; version?: string; error?: string }> {
	try {
		const res = await fetch(`${CAMERA_SERVER}/health`);
		if (res.ok) {
			const data = await res.json();
			return { ok: true, version: data.opencv_version };
		}
		return { ok: false, error: `Server returned ${res.status}` };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' };
	}
}

/**
 * Detect ArUco markers in an image via server API
 * Sends image as base64 to avoid multipart complexity
 */
export async function detectMarkers(imageData: ImageData): Promise<DetectionResult> {
	// Convert ImageData to base64 PNG
	const canvas = document.createElement('canvas');
	canvas.width = imageData.width;
	canvas.height = imageData.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		return { markers: [], imageWidth: 0, imageHeight: 0, error: 'Failed to create canvas context' };
	}
	ctx.putImageData(imageData, 0, 0);
	const base64 = canvas.toDataURL('image/png');

	// Send to server
	const res = await fetch(`${CAMERA_SERVER}/detect-base64`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ image: base64 })
	});

	if (!res.ok) {
		return { markers: [], imageWidth: 0, imageHeight: 0, error: `Server error: ${res.status}` };
	}

	const data = await res.json();

	// Convert server response to our format
	const markers: DetectedMarker[] = data.markers.map((m: any) => ({
		id: m.id,
		corners: m.corners.map((c: any) => ({ x: c.x, y: c.y })) as [Point, Point, Point, Point]
	}));

	return {
		markers,
		imageWidth: data.image_width,
		imageHeight: data.image_height,
		error: data.error
	};
}

/**
 * Detect markers from an image URL (loads image first)
 */
export async function detectMarkersFromUrl(url: string): Promise<DetectionResult> {
	const imageData = await loadImageAsImageData(url);
	return detectMarkers(imageData);
}

/**
 * Load an image from a URL and convert to ImageData
 */
export async function loadImageAsImageData(url: string): Promise<ImageData> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';

		img.onload = () => {
			const canvas = document.createElement('canvas');
			canvas.width = img.width;
			canvas.height = img.height;

			const ctx = canvas.getContext('2d');
			if (!ctx) {
				reject(new Error('Failed to get canvas context'));
				return;
			}

			ctx.drawImage(img, 0, 0);
			const imageData = ctx.getImageData(0, 0, img.width, img.height);
			resolve(imageData);
		};

		img.onerror = () => {
			reject(new Error(`Failed to load image: ${url}`));
		};

		img.src = url;
	});
}

/**
 * Get the center point of a marker
 */
export function getMarkerCenter(marker: DetectedMarker): Point {
	const { corners } = marker;
	return {
		x: (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4,
		y: (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4
	};
}
