import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fal } from '@fal-ai/client';
import { FAL_KEY } from '$env/static/private';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

// Configure fal.ai client
fal.config({ credentials: FAL_KEY });

// Debug output directory (relative to project root)
const DEBUG_DIR = 'debug/sam';

async function saveDebugFiles(
	timestamp: string,
	prompt: string,
	inputImage: string,
	result: unknown
) {
	try {
		const dir = path.join(process.cwd(), '..', DEBUG_DIR, timestamp);
		if (!existsSync(dir)) {
			await mkdir(dir, { recursive: true });
		}

		// Save input image (strip data URL prefix)
		const base64Match = inputImage.match(/^data:image\/\w+;base64,(.+)$/);
		if (base64Match) {
			const imageBuffer = Buffer.from(base64Match[1], 'base64');
			await writeFile(path.join(dir, 'input.png'), imageBuffer);
		}

		// Save prompt
		await writeFile(path.join(dir, 'prompt.txt'), prompt);

		// Save full response as JSON
		await writeFile(path.join(dir, 'response.json'), JSON.stringify(result, null, 2));

		// Download and save mask images
		const data = result as { masks?: { url: string }[]; image?: { url: string } };
		if (data.masks) {
			for (let i = 0; i < data.masks.length; i++) {
				const maskUrl = data.masks[i].url;
				const maskRes = await fetch(maskUrl);
				const maskBuffer = Buffer.from(await maskRes.arrayBuffer());
				await writeFile(path.join(dir, `mask-${i}.png`), maskBuffer);
			}
		}

		// Save combined image if present
		if (data.image?.url) {
			const imgRes = await fetch(data.image.url);
			const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
			await writeFile(path.join(dir, 'combined.png'), imgBuffer);
		}

		console.log(`Debug files saved to ${dir}`);
	} catch (e) {
		console.error('Failed to save debug files:', e);
	}
}

export const POST: RequestHandler = async ({ request }) => {
	const { image, prompt } = await request.json();

	if (!image) {
		return json({ error: 'image is required' }, { status: 400 });
	}

	if (!prompt) {
		return json({ error: 'prompt is required' }, { status: 400 });
	}

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

	try {
		const result = await fal.subscribe('fal-ai/sam-3/image', {
			input: {
				image_url: image,
				prompt: prompt,
				sync_mode: true,
				return_multiple_masks: true,
				max_masks: 10,
				include_scores: true,
				include_boxes: true,
				apply_mask: true // Enable to get combined preview
			}
		});

		// Save debug files in background (don't block response)
		saveDebugFiles(timestamp, prompt, image, result.data);

		return json(result.data);
	} catch (error) {
		console.error('SAM segmentation error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Segmentation failed' },
			{ status: 500 }
		);
	}
};
