import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fal } from '@fal-ai/client';
import { FAL_KEY } from '$env/static/private';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

// Configure fal.ai client
fal.config({ credentials: FAL_KEY });

// Reference images for wall texture detection
const REFERENCE_IMAGES_DIR = path.join(process.cwd(), '..', 'images', 'prompt');

// Debug output directory
const DEBUG_DIR = 'debug/wall-mask';

async function loadReferenceImage(filename: string): Promise<string> {
	const filePath = path.join(REFERENCE_IMAGES_DIR, filename);
	const buffer = await readFile(filePath);
	const base64 = buffer.toString('base64');
	const ext = filename.split('.').pop()?.toLowerCase() || 'png';
	const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
	return `data:${mimeType};base64,${base64}`;
}

async function saveDebugFiles(
	timestamp: string,
	prompt: string,
	imageUrls: string[],
	result: unknown
) {
	try {
		const dir = path.join(process.cwd(), '..', DEBUG_DIR, timestamp);
		console.log(`[wall-mask] Creating debug directory: ${dir}`);
		if (!existsSync(dir)) {
			await mkdir(dir, { recursive: true });
		}

		// Save prompt
		const promptPath = path.join(dir, 'prompt.txt');
		await writeFile(promptPath, prompt);
		console.log(`[wall-mask] Saved prompt to: ${promptPath}`);

		// Save image URLs info
		const inputUrlsPath = path.join(dir, 'input_urls.json');
		await writeFile(
			inputUrlsPath,
			JSON.stringify(imageUrls.map((url, i) => ({ index: i, length: url.length })), null, 2)
		);
		console.log(`[wall-mask] Saved input URLs info to: ${inputUrlsPath}`);

		// Save full response as JSON
		const responsePath = path.join(dir, 'response.json');
		await writeFile(responsePath, JSON.stringify(result, null, 2));
		console.log(`[wall-mask] Saved response JSON to: ${responsePath}`);

		// Download and save output images
		const data = result as { images?: { url: string }[] };
		if (data.images) {
			for (let i = 0; i < data.images.length; i++) {
				const imgUrl = data.images[i].url;
				console.log(`[wall-mask] Downloading output image ${i} from: ${imgUrl}`);
				const imgRes = await fetch(imgUrl);
				const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
				const imgPath = path.join(dir, `output-${i}.png`);
				await writeFile(imgPath, imgBuffer);
				console.log(`[wall-mask] Saved output image to: ${imgPath} (${imgBuffer.length} bytes)`);
			}
		}

		console.log(`[wall-mask] Debug files saved to ${dir}`);
	} catch (e) {
		console.error('[wall-mask] Failed to save debug files:', e);
	}
}

export const POST: RequestHandler = async ({ request }) => {
	console.log('[wall-mask] POST request received');

	const { image } = await request.json();

	if (!image) {
		console.log('[wall-mask] Error: image is required');
		return json({ error: 'image is required' }, { status: 400 });
	}

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	console.log(`[wall-mask] Processing request ${timestamp}`);
	console.log(`[wall-mask] Input image size: ${image.length} chars`);

	try {
		// Load reference images
		console.log('[wall-mask] Loading reference images from', REFERENCE_IMAGES_DIR);
		const wallOriginal = await loadReferenceImage('wall.png');
		console.log(`[wall-mask] Loaded wall.png (${wallOriginal.length} chars)`);
		const wallRed = await loadReferenceImage('wall_red.png');
		console.log(`[wall-mask] Loaded wall_red.png (${wallRed.length} chars)`);

		// Build prompt - be very explicit about image roles and preserving geometry
		const prompt = `I'm providing three images:

IMAGE 1: A close-up reference of a 3D decorative wall panel texture.

IMAGE 2: The same wall with the raised surfaces painted red - showing WHAT to paint.

IMAGE 3: A photo that needs editing.

YOUR TASK: Edit IMAGE 3 by painting the raised wall texture surfaces red, exactly like shown in IMAGE 2.

CRITICAL: You must preserve the EXACT scale, position, perspective, and geometry of IMAGE 3. Do not zoom, crop, resize, or recompose. The output must be pixel-aligned with IMAGE 3 - only the color of the wall texture surfaces should change to red.`;
		console.log(`[wall-mask] Prompt: "${prompt}"`);

		console.log('[wall-mask] Calling fal.ai nano-banana-pro/edit...');
		const startTime = Date.now();

		// Call nano-banana-pro/edit with all three images
		// Source image is 640x480 = 4:3 aspect ratio
		const result = await fal.subscribe('fal-ai/nano-banana-pro/edit', {
			input: {
				prompt: prompt,
				image_urls: [wallOriginal, wallRed, image],
				num_images: 1,
				output_format: 'png',
				resolution: '1K',
				aspect_ratio: '4:3' // Match source image aspect ratio (640x480)
			}
		});

		const elapsed = Date.now() - startTime;
		console.log(`[wall-mask] fal.ai response received in ${elapsed}ms`);

		const data = result.data as { images?: { url: string }[] };
		console.log(`[wall-mask] Response contains ${data.images?.length ?? 0} image(s)`);
		if (data.images?.[0]?.url) {
			console.log(`[wall-mask] Output image URL: ${data.images[0].url}`);
		}

		// Save debug files in background
		console.log(`[wall-mask] Saving debug files to debug/wall-mask/${timestamp}/`);
		saveDebugFiles(timestamp, prompt, ['wall.png', 'wall_red.png', 'target'], result.data);

		return json(result.data);
	} catch (error) {
		console.error('[wall-mask] Error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Wall mask generation failed' },
			{ status: 500 }
		);
	}
};
