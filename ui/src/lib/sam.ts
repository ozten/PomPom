/**
 * SAM (Segment Anything Model) client library
 * Calls the /api/segment endpoint which proxies to fal.ai SAM3
 */

export interface MaskResult {
	url: string;
	content_type?: string;
}

export interface SegmentationResult {
	masks: MaskResult[];
	image?: MaskResult;
	scores?: number[];
	boxes?: number[][];
	metadata?: Record<string, unknown>;
}

export interface SegmentationError {
	error: string;
}

/**
 * Segment an image using SAM with a text prompt
 *
 * @param imageDataUrl - Base64 data URL of the image (data:image/png;base64,...)
 * @param prompt - Text prompt describing what to segment (e.g., "Feliz Navidad")
 * @returns Segmentation result with mask images and scores
 */
export async function segmentImage(
	imageDataUrl: string,
	prompt: string
): Promise<SegmentationResult> {
	const res = await fetch('/api/segment', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ image: imageDataUrl, prompt })
	});

	const data = await res.json();

	if (!res.ok) {
		throw new Error(data.error || 'Segmentation failed');
	}

	return data as SegmentationResult;
}

/**
 * Convert an image file to a base64 data URL
 */
export function imageToDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

/**
 * Load an image from a URL and convert to base64 data URL
 */
export async function urlToDataUrl(url: string): Promise<string> {
	const response = await fetch(url);
	const blob = await response.blob();
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}
