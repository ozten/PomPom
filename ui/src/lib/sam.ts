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

/**
 * Result of generating masks for multiple prompts
 */
export interface GeneratedMask {
	id: string;
	prompt: string;
	maskUrl: string;
	score: number;
}

/**
 * Generate masks for multiple prompts using SAM
 *
 * @param imageUrlOrDataUrl - URL of the image to segment (e.g., '/fixtures/webcam_capture.png') or a base64 data URL
 * @param prompts - Array of {id, prompt} objects
 * @returns Array of generated masks with their URLs and scores
 */
export async function generateMasks(
	imageUrlOrDataUrl: string,
	prompts: { id: string; prompt: string }[]
): Promise<GeneratedMask[]> {
	// Check if already a data URL, otherwise load from URL
	const imageDataUrl = imageUrlOrDataUrl.startsWith('data:')
		? imageUrlOrDataUrl
		: await urlToDataUrl(imageUrlOrDataUrl);

	const results: GeneratedMask[] = [];

	// Call SAM for each prompt
	for (const { id, prompt } of prompts) {
		try {
			console.log(`SAM: Segmenting "${prompt}"...`);
			const result = await segmentImage(imageDataUrl, prompt);
			console.log(`SAM: Result for "${prompt}":`, result);

			// Use the highest-scoring mask
			if (result.masks && result.masks.length > 0) {
				const bestIndex = result.scores
					? result.scores.indexOf(Math.max(...result.scores))
					: 0;

				results.push({
					id,
					prompt,
					maskUrl: result.masks[bestIndex].url,
					score: result.scores?.[bestIndex] ?? 1
				});
			} else {
				console.warn(`SAM: No masks returned for "${prompt}"`);
			}
		} catch (error) {
			console.error(`SAM: Failed to segment "${prompt}":`, error);
		}
	}

	return results;
}

/**
 * Load a mask image from URL into an HTMLImageElement
 */
export async function loadMaskImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => resolve(img);
		img.onerror = reject;
		img.src = url;
	});
}
