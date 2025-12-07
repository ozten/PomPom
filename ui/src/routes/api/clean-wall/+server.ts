import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fal } from '@fal-ai/client';
import { FAL_KEY } from '$env/static/private';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

// Configure fal.ai client
fal.config({ credentials: FAL_KEY });

// Debug output directory
const DEBUG_DIR = 'debug/clean-wall';

async function saveDebugFiles(
	timestamp: string,
	prompt: string,
	result: unknown
) {
	try {
		const dir = path.join(process.cwd(), '..', DEBUG_DIR, timestamp);
		console.log(`[clean-wall] Creating debug directory: ${dir}`);
		if (!existsSync(dir)) {
			await mkdir(dir, { recursive: true });
		}

		// Save prompt
		const promptPath = path.join(dir, 'prompt.txt');
		await writeFile(promptPath, prompt);
		console.log(`[clean-wall] Saved prompt to: ${promptPath}`);

		// Save full response as JSON
		const responsePath = path.join(dir, 'response.json');
		await writeFile(responsePath, JSON.stringify(result, null, 2));
		console.log(`[clean-wall] Saved response JSON to: ${responsePath}`);

		// Download and save output images
		const data = result as { images?: { url: string }[] };
		if (data.images) {
			for (let i = 0; i < data.images.length; i++) {
				const imgUrl = data.images[i].url;
				console.log(`[clean-wall] Downloading output image ${i} from: ${imgUrl}`);
				const imgRes = await fetch(imgUrl);
				const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
				const imgPath = path.join(dir, `output-${i}.png`);
				await writeFile(imgPath, imgBuffer);
				console.log(`[clean-wall] Saved output image to: ${imgPath} (${imgBuffer.length} bytes)`);
			}
		}

		console.log(`[clean-wall] Debug files saved to ${dir}`);
	} catch (e) {
		console.error('[clean-wall] Failed to save debug files:', e);
	}
}

export const POST: RequestHandler = async ({ request }) => {
	console.log('[clean-wall] POST request received');

	const { image } = await request.json();

	if (!image) {
		console.log('[clean-wall] Error: image is required');
		return json({ error: 'image is required' }, { status: 400 });
	}

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	console.log(`[clean-wall] Processing request ${timestamp}`);
	console.log(`[clean-wall] Input image size: ${image.length} chars`);

	try {
		// Build prompt for decoration removal
		const prompt = `Take this image and remove any decorations. Output the same image without the decorations.`;
		console.log(`[clean-wall] Prompt: "${prompt}"`);

		console.log('[clean-wall] Calling fal.ai nano-banana-pro/edit...');
		const startTime = Date.now();

		// Call nano-banana-pro/edit to remove decorations
		// Source image is 640x480 = 4:3 aspect ratio
		const result = await fal.subscribe('fal-ai/nano-banana-pro/edit', {
			input: {
				prompt: prompt,
				image_urls: [image],
				num_images: 1,
				output_format: 'png',
				resolution: '1K',
				aspect_ratio: '4:3' // Match source image aspect ratio (640x480)
			}
		});

		const elapsed = Date.now() - startTime;
		console.log(`[clean-wall] fal.ai response received in ${elapsed}ms`);

		const data = result.data as { images?: { url: string }[] };
		console.log(`[clean-wall] Response contains ${data.images?.length ?? 0} image(s)`);
		if (data.images?.[0]?.url) {
			console.log(`[clean-wall] Output image URL: ${data.images[0].url}`);
		}

		// Save debug files in background
		console.log(`[clean-wall] Saving debug files to debug/clean-wall/${timestamp}/`);
		saveDebugFiles(timestamp, prompt, result.data);

		return json(result.data);
	} catch (error) {
		console.error('[clean-wall] Error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Clean wall generation failed' },
			{ status: 500 }
		);
	}
};
