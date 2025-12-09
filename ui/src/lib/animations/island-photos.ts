/**
 * Island Photos Animation
 *
 * Displays photos in up to 2 randomly selected islands at a time.
 * Every 5 seconds, re-rolls which islands are active and assigns new random photos.
 * Photos are scaled to fill each island's bounding box.
 */

import type { ComponentInfo } from '../island-detection';

export const DISPLAY_DURATION_MS = 10000; // Total time a photo displays (including fade)
export const FADE_DURATION_MS = 1500; // Duration of fade in/out
export const MAX_ACTIVE_ISLANDS = 2; // Maximum number of islands showing photos at once
export const AVG_SPAWN_INTERVAL_MS = 6000; // Average time between photo spawns

// Available photos in /static/content/
const PHOTO_PATHS = [
	'/content/IMG_6648.jpeg',
	'/content/IMG_6968.jpeg',
	'/content/IMG_6971.jpeg',
	'/content/IMG_6976.jpeg',
	'/content/IMG_6981.jpeg',
	'/content/IMG_6983.jpeg',
	'/content/IMG_7054.jpeg',
	'/content/IMG_7057.jpeg',
	'/content/IMG_7059.jpeg',
	'/content/IMG_7078.jpeg',
	'/content/IMG_7097.jpeg',
	'/content/IMG_7121.jpeg'
];

export interface IslandPhoto {
	islandIndex: number;
	photoPath: string;
	image: HTMLImageElement | null; // null while loading
	boundingBox: { minX: number; maxX: number; minY: number; maxY: number };
	opacity: number; // 0-1 for fade in/out
	startTime: number; // When this photo started displaying
}

export interface IslandPhotosState {
	islands: ComponentInfo[]; // Island info from detection
	photos: Map<number, IslandPhoto>; // Map of islandIndex -> photo info
	running: boolean;
	animationFrameId: number | null;
	imagesLoaded: Map<string, HTMLImageElement>; // Cache of loaded images
}

export interface IslandPhotosAnimation {
	id: string;
	start(): void;
	stop(): void;
	setIslands(islands: ComponentInfo[]): void;
	getPhotos(): IslandPhoto[];
}

/**
 * Create an Island Photos animation
 * @param onUpdate - Called when photos change, with the current photo assignments
 */
export function createIslandPhotosAnimation(
	onUpdate: (photos: IslandPhoto[]) => void
): IslandPhotosAnimation {
	const state: IslandPhotosState = {
		islands: [],
		photos: new Map(),
		running: false,
		animationFrameId: null,
		imagesLoaded: new Map()
	};

	/**
	 * Load an image and cache it
	 */
	async function loadImage(path: string): Promise<HTMLImageElement> {
		if (state.imagesLoaded.has(path)) {
			return state.imagesLoaded.get(path)!;
		}

		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				state.imagesLoaded.set(path, img);
				resolve(img);
			};
			img.onerror = reject;
			img.src = path;
		});
	}

	/**
	 * Pick a random photo path
	 */
	function pickRandomPhoto(): string {
		return PHOTO_PATHS[Math.floor(Math.random() * PHOTO_PATHS.length)];
	}

	/**
	 * Calculate opacity based on elapsed time with ease in/out
	 */
	function calculateOpacity(elapsed: number): number {
		if (elapsed < FADE_DURATION_MS) {
			// Fade in: ease-out curve (starts fast, slows down)
			const t = elapsed / FADE_DURATION_MS;
			return 1 - (1 - t) * (1 - t);
		} else if (elapsed > DISPLAY_DURATION_MS - FADE_DURATION_MS) {
			// Fade out: ease-in curve (starts slow, speeds up)
			const remaining = DISPLAY_DURATION_MS - elapsed;
			const t = remaining / FADE_DURATION_MS;
			return t * t;
		}
		return 1; // Full opacity in the middle
	}

	/**
	 * Add a new photo to a random available island
	 */
	async function addNewPhoto(now: number) {
		const validIslands = state.islands.filter((c) => c.isIsland);
		if (validIslands.length === 0) return;

		// Find islands that don't currently have a photo
		const usedIndices = new Set(state.photos.keys());
		const availableIslands = validIslands.filter((island) => {
			const idx = state.islands.indexOf(island);
			return !usedIndices.has(idx);
		});

		if (availableIslands.length === 0) return;

		// Pick a random available island
		const island = availableIslands[Math.floor(Math.random() * availableIslands.length)];
		const islandIndex = state.islands.indexOf(island);
		const photoPath = pickRandomPhoto();

		// Load image
		const image = await loadImage(photoPath);

		state.photos.set(islandIndex, {
			islandIndex,
			photoPath,
			image,
			boundingBox: island.boundingBox,
			opacity: 0,
			startTime: now
		});
	}

	let lastTickTime = 0;

	/**
	 * Animation loop - updates opacity and probabilistically spawns new photos
	 */
	function tick(now: number) {
		if (!state.running) return;

		const deltaMs = lastTickTime > 0 ? now - lastTickTime : 16;
		lastTickTime = now;

		let needsUpdate = false;

		// Update opacity for each photo and remove expired ones
		const expiredKeys: number[] = [];
		for (const [key, photo] of state.photos) {
			const elapsed = now - photo.startTime;
			const newOpacity = calculateOpacity(elapsed);

			if (elapsed >= DISPLAY_DURATION_MS) {
				expiredKeys.push(key);
				needsUpdate = true;
			} else if (Math.abs(photo.opacity - newOpacity) > 0.01) {
				photo.opacity = newOpacity;
				needsUpdate = true;
			}
		}

		// Remove expired photos
		for (const key of expiredKeys) {
			state.photos.delete(key);
		}

		// Probabilistically spawn a new photo if below limit
		// Probability per frame = deltaMs / AVG_SPAWN_INTERVAL_MS
		if (state.photos.size < MAX_ACTIVE_ISLANDS) {
			const spawnProbability = deltaMs / AVG_SPAWN_INTERVAL_MS;
			if (Math.random() < spawnProbability) {
				addNewPhoto(now);
				needsUpdate = true;
			}
		}

		// Notify if anything changed
		if (needsUpdate) {
			onUpdate(Array.from(state.photos.values()));
		}

		// Schedule next frame
		state.animationFrameId = requestAnimationFrame(tick);
	}

	return {
		id: 'island-photos',

		start() {
			if (state.running) return;
			state.running = true;
			lastTickTime = 0; // Reset so first frame doesn't have huge delta

			// Start animation loop
			state.animationFrameId = requestAnimationFrame(tick);
		},

		stop() {
			state.running = false;
			if (state.animationFrameId !== null) {
				cancelAnimationFrame(state.animationFrameId);
				state.animationFrameId = null;
			}
		},

		setIslands(islands: ComponentInfo[]) {
			state.islands = islands;
			// Clear existing photos when islands change
			state.photos.clear();
			onUpdate([]);
		},

		getPhotos(): IslandPhoto[] {
			return Array.from(state.photos.values());
		}
	};
}
