/**
 * Island Photos Animation
 *
 * Displays photos in up to 2 randomly selected islands at a time.
 * Uses probabilistic spawning with seeded PRNG for deterministic behavior.
 * Photos are scaled to fill each island's bounding box.
 *
 * Uses deterministic randomness via ClockProvider for synchronized animations
 * across multiple pages.
 */

import type { ComponentInfo } from '../island-detection';
import type { ClockProvider } from './clock';
import { getFallbackClockProvider } from './clock';

export const DISPLAY_DURATION_MS = 10000; // Total time a photo displays (including fade)
export const FADE_DURATION_MS = 1500; // Duration of fade in/out
export const MAX_ACTIVE_ISLANDS = 2; // Maximum number of islands showing photos at once
export const AVG_SPAWN_INTERVAL_MS = 6000; // Average time between photo spawns

// Available photos in /static/content/ - can be updated dynamically
let photoPaths: string[] = [
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

/**
 * Set the available photo paths dynamically
 * @param paths - Array of paths to photos (e.g., ['/content/photo1.jpg', ...])
 */
export function setPhotoPaths(paths: string[]): void {
	if (paths.length > 0) {
		photoPaths = paths;
		console.log(`[island-photos] Updated photo paths: ${paths.length} images`);
	}
}

/**
 * Get the current list of photo paths
 */
export function getPhotoPaths(): string[] {
	return [...photoPaths];
}

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
	clockProvider: ClockProvider; // For synchronized timing and deterministic randomness
}

export interface IslandPhotosAnimation {
	id: string;
	start(): void;
	stop(): void;
	setIslands(islands: ComponentInfo[]): void;
	setClockProvider(provider: ClockProvider): void;
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
		imagesLoaded: new Map(),
		clockProvider: getFallbackClockProvider()
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
	 * Pick a random photo path using seeded PRNG
	 */
	function pickRandomPhoto(): string {
		const prng = state.clockProvider.getPRNG('island-photos-pick');
		return photoPaths[Math.floor(prng() * photoPaths.length)];
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

		// Pick a random available island using seeded PRNG
		const prng = state.clockProvider.getPRNG('island-photos-island');
		const island = availableIslands[Math.floor(prng() * availableIslands.length)];
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

	let lastElapsedTime = 0;

	/**
	 * Animation loop - updates opacity and probabilistically spawns new photos
	 */
	function tick() {
		if (!state.running) return;

		const now = state.clockProvider.getElapsedTime();
		const deltaMs = lastElapsedTime > 0 ? now - lastElapsedTime : 16;
		lastElapsedTime = now;

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
			const prng = state.clockProvider.getPRNG('island-photos-spawn');
			if (prng() < spawnProbability) {
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
			lastElapsedTime = 0; // Reset so first frame doesn't have huge delta

			// Start animation loop
			state.animationFrameId = requestAnimationFrame(tick);
		},

		stop() {
			state.running = false;
			if (state.animationFrameId !== null) {
				cancelAnimationFrame(state.animationFrameId);
				state.animationFrameId = null;
			}
			// Clear photos so they stop rendering
			state.photos.clear();
			onUpdate([]);
		},

		setIslands(islands: ComponentInfo[]) {
			state.islands = islands;
			// Clear existing photos when islands change
			state.photos.clear();
			onUpdate([]);
		},

		setClockProvider(provider: ClockProvider) {
			state.clockProvider = provider;
		},

		getPhotos(): IslandPhoto[] {
			return Array.from(state.photos.values());
		}
	};
}
