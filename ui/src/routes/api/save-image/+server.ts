import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { imageData } = await request.json();

		if (!imageData) {
			return json({ success: false, error: 'No image data provided' }, { status: 400 });
		}

		// Remove data URL prefix if present (e.g., "data:image/png;base64,")
		const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
		const buffer = Buffer.from(base64Data, 'base64');

		// Create filename with unix timestamp
		const timestamp = Date.now();
		const filename = `${timestamp}.png`;

		// Save to images/captured directory (relative to project root)
		const capturedDir = join(process.cwd(), '..', 'images', 'captured');
		await mkdir(capturedDir, { recursive: true });

		const filepath = join(capturedDir, filename);
		await writeFile(filepath, buffer);

		return json({ success: true, filename, filepath });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to save image';
		return json({ success: false, error: message }, { status: 500 });
	}
};
