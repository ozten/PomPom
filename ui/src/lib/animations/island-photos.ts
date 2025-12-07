/**
 * Island Photos Animation
 *
 * Displays random photos in random islands, swapping one every 5 seconds.
 * Photos are scaled to fill each island's bounding box.
 */

import type { ComponentInfo } from '../island-detection';

export const SWAP_INTERVAL_MS = 5000; // 5 seconds between photo swaps

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
}

export interface IslandPhotosState {
	islands: ComponentInfo[]; // Island info from detection
	photos: Map<number, IslandPhoto>; // Map of islandIndex -> photo info
	running: boolean;
	intervalId: number | null;
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
		intervalId: null,
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
	 * Pick a random island that is classified as an island (not land)
	 */
	function pickRandomIsland(): ComponentInfo | null {
		const islands = state.islands.filter((c) => c.isIsland);
		if (islands.length === 0) return null;
		return islands[Math.floor(Math.random() * islands.length)];
	}

	/**
	 * Pick a random photo path
	 */
	function pickRandomPhoto(): string {
		return PHOTO_PATHS[Math.floor(Math.random() * PHOTO_PATHS.length)];
	}

	/**
	 * Assign a random photo to a random island
	 */
	async function swapRandomIslandPhoto() {
		if (!state.running || state.islands.length === 0) return;

		const island = pickRandomIsland();
		if (!island) return;

		const photoPath = pickRandomPhoto();
		const islandIndex = state.islands.indexOf(island);

		// Start loading the image
		const image = await loadImage(photoPath);

		// Update the photo assignment
		state.photos.set(islandIndex, {
			islandIndex,
			photoPath,
			image,
			boundingBox: island.boundingBox
		});

		// Notify listener
		onUpdate(Array.from(state.photos.values()));
	}

	return {
		id: 'island-photos',

		start() {
			if (state.running) return;
			state.running = true;

			// Do an initial swap immediately
			swapRandomIslandPhoto();

			// Then swap every SWAP_INTERVAL_MS
			state.intervalId = window.setInterval(() => {
				swapRandomIslandPhoto();
			}, SWAP_INTERVAL_MS);
		},

		stop() {
			state.running = false;
			if (state.intervalId !== null) {
				clearInterval(state.intervalId);
				state.intervalId = null;
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
