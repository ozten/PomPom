/**
 * Wall texture mask generation using fal.ai nano-banana-pro
 *
 * Uses Gemini-based image editing to identify and paint wall texture red,
 * then extracts the red areas as a B&W mask.
 */

export interface WallMaskResult {
	images: { url: string; content_type?: string }[];
	description?: string;
}

export interface CleanWallResult {
	images: { url: string; content_type?: string }[];
}

export interface WallMaskError {
	error: string;
}

/**
 * Generate a wall texture image with red painted areas
 *
 * @param imageDataUrl - Base64 data URL of the target image
 * @returns Result with URL to the edited image
 */
export async function generateWallMaskImage(imageDataUrl: string): Promise<WallMaskResult> {
	console.log('[wall-mask] Calling /api/wall-mask...');
	console.log(`[wall-mask] Input image size: ${imageDataUrl.length} chars`);

	const res = await fetch('/api/wall-mask', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ image: imageDataUrl })
	});

	const data = await res.json();

	if (!res.ok) {
		console.error('[wall-mask] API error:', data.error);
		throw new Error(data.error || 'Wall mask generation failed');
	}

	console.log(`[wall-mask] Got ${data.images?.length ?? 0} image(s) from API`);
	return data as WallMaskResult;
}

/**
 * Step 1 of two-step pipeline: Remove decorations from image
 *
 * @param imageDataUrl - Base64 data URL of the target image
 * @returns Result with URL to the cleaned image (no decorations)
 */
export async function cleanWallImage(imageDataUrl: string): Promise<CleanWallResult> {
	console.log('[clean-wall] Step 1: Removing decorations from image...');
	console.log(`[clean-wall] Input image size: ${imageDataUrl.length} chars`);

	const res = await fetch('/api/clean-wall', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ image: imageDataUrl })
	});

	const data = await res.json();

	if (!res.ok) {
		console.error('[clean-wall] API error:', data.error);
		throw new Error(data.error || 'Clean wall generation failed');
	}

	console.log(`[clean-wall] Got ${data.images?.length ?? 0} image(s) from API`);
	if (data.images?.[0]?.url) {
		console.log(`[clean-wall] Output image URL: ${data.images[0].url}`);
	}

	return data as CleanWallResult;
}

/**
 * Extract red pixels from an image and convert to B&W mask
 * Red pixels become white (opaque), non-red become transparent
 *
 * @param imageUrl - URL of the image with red-painted areas
 * @returns Canvas with B&W mask
 */
export async function extractRedAsMask(imageUrl: string): Promise<HTMLCanvasElement> {
	console.log('[extract-mask] Loading image from URL...');

	// Load the image
	const img = await loadImage(imageUrl);
	console.log(`[extract-mask] Loaded image: ${img.width}x${img.height}`);

	// Create canvas
	const canvas = document.createElement('canvas');
	canvas.width = img.width;
	canvas.height = img.height;
	const ctx = canvas.getContext('2d')!;

	// Draw image to canvas
	ctx.drawImage(img, 0, 0);

	// Get pixel data
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const data = imageData.data;

	// Process pixels: red becomes white, everything else becomes transparent
	let redPixelCount = 0;
	const totalPixels = data.length / 4;

	for (let i = 0; i < data.length; i += 4) {
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];

		// Check if pixel is "red enough"
		// Red should be dominant and above threshold
		const isRed = r > 150 && r > g * 1.5 && r > b * 1.5;

		if (isRed) {
			redPixelCount++;
			// White, fully opaque
			data[i] = 255;     // R
			data[i + 1] = 255; // G
			data[i + 2] = 255; // B
			data[i + 3] = 255; // A
		} else {
			// Transparent
			data[i] = 0;
			data[i + 1] = 0;
			data[i + 2] = 0;
			data[i + 3] = 0;
		}
	}

	// Put processed data back
	ctx.putImageData(imageData, 0, 0);

	const percentage = ((redPixelCount / totalPixels) * 100).toFixed(1);
	console.log(`[extract-mask] Found ${redPixelCount} red pixels (${percentage}% of image)`);

	return canvas;
}

/**
 * Load an image from URL
 */
function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => resolve(img);
		img.onerror = reject;
		img.src = url;
	});
}

/**
 * Generate wall texture mask end-to-end using two-step pipeline
 *
 * Step 1: Remove decorations from image (clean wall)
 * Step 2: Paint wall texture red and extract as mask
 *
 * @param imageDataUrl - Base64 data URL of the target image
 * @returns Canvas with B&W mask of wall texture, plus intermediate URLs
 */
export async function generateWallTextureMask(imageDataUrl: string): Promise<{
	mask: HTMLCanvasElement;
	editedImageUrl: string;
	cleanImageUrl?: string;
}> {
	console.log('[wall-texture] Starting pipeline (Step 1 disabled)...');
	console.log(`[wall-texture] Input image size: ${imageDataUrl.length} chars`);
	const startTime = Date.now();

	// Step 1: DISABLED - Skip decoration removal, use original image directly
	// const cleanResult = await cleanWallImage(imageDataUrl);
	// const cleanImageUrl = cleanResult.images[0].url;
	// const cleanImageDataUrl = await urlToDataUrl(cleanImageUrl);

	// Step 2: Call API to get image with red-painted wall texture
	// Using original image directly instead of cleaned image
	console.log('[wall-texture] Step 2: Calling wall-mask API (using original image)...');
	const step2Start = Date.now();
	const result = await generateWallMaskImage(imageDataUrl);
	console.log(`[wall-texture] Step 2 took ${Date.now() - step2Start}ms`);

	if (!result.images || result.images.length === 0) {
		throw new Error('No images returned from wall mask API');
	}

	const editedImageUrl = result.images[0].url;
	console.log(`[wall-texture] Step 2 complete - red-painted image: ${editedImageUrl}`);

	// Step 3: Extract red pixels as B&W mask
	console.log('[wall-texture] Step 3: Extracting red pixels as mask...');
	const step3Start = Date.now();
	const mask = await extractRedAsMask(editedImageUrl);
	console.log(`[wall-texture] Step 3 took ${Date.now() - step3Start}ms`);
	console.log(`[wall-texture] Final mask: ${mask.width}x${mask.height}`);

	const totalTime = Date.now() - startTime;
	console.log(`[wall-texture] Total pipeline time: ${totalTime}ms`);

	return { mask, editedImageUrl };
}

/**
 * Convert a URL to a base64 data URL
 */
async function urlToDataUrl(url: string): Promise<string> {
	const response = await fetch(url);
	const blob = await response.blob();
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}
