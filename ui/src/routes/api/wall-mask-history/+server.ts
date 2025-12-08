/**
 * API endpoint to list and load previous wall-mask generations
 * Returns the last 10 wall-mask results in reverse chronological order
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';

const DEBUG_DIR = join(process.cwd(), '..', 'debug', 'wall-mask');

export interface WallMaskHistoryEntry {
	id: string; // The timestamp folder name
	timestamp: Date;
	hasOutput: boolean;
}

export const GET: RequestHandler = async () => {
	try {
		// Read all directories in the debug folder
		const entries = await readdir(DEBUG_DIR, { withFileTypes: true });

		// Filter for directories and check if they have output-0.png
		const historyEntries: WallMaskHistoryEntry[] = [];

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const outputPath = join(DEBUG_DIR, entry.name, 'output-0.png');
			let hasOutput = false;

			try {
				await stat(outputPath);
				hasOutput = true;
			} catch {
				// No output file
			}

			if (hasOutput) {
				// Parse timestamp from folder name (e.g., "2025-12-07T22-24-40-808Z")
				const timestamp = new Date(entry.name.replace(/-(\d{2})Z$/, '.$1Z').replace(/-/g, (m, offset) => {
					// Replace hyphens with colons for time portion, but keep date hyphens
					if (offset > 10) return ':';
					return m;
				}));

				historyEntries.push({
					id: entry.name,
					timestamp,
					hasOutput
				});
			}
		}

		// Sort by timestamp descending (newest first) and take last 10
		historyEntries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
		const last10 = historyEntries.slice(0, 10);

		return json({ entries: last10 });
	} catch (error) {
		console.error('Error reading wall-mask history:', error);
		return json({ entries: [], error: 'Failed to read history' }, { status: 500 });
	}
};

/**
 * POST to load a specific wall-mask by ID
 * Returns the mask image as base64
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const { id } = await request.json();

		if (!id || typeof id !== 'string') {
			return json({ error: 'Missing or invalid id' }, { status: 400 });
		}

		// Validate id format to prevent path traversal
		if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(id)) {
			return json({ error: 'Invalid id format' }, { status: 400 });
		}

		const outputPath = join(DEBUG_DIR, id, 'output-0.png');

		try {
			const imageBuffer = await readFile(outputPath);
			const base64 = imageBuffer.toString('base64');
			const dataUrl = `data:image/png;base64,${base64}`;

			return json({ imageUrl: dataUrl });
		} catch {
			return json({ error: 'Mask not found' }, { status: 404 });
		}
	} catch (error) {
		console.error('Error loading wall-mask:', error);
		return json({ error: 'Failed to load mask' }, { status: 500 });
	}
};
