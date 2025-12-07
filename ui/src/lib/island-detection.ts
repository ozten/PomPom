/**
 * Island Detection Algorithm
 *
 * Splits a binary mask into three sub-masks:
 * - Islands: detected squircle shapes (roughly 6:4 aspect ratio)
 * - Land: original mask pixels NOT in islands
 * - Water: inverse of original mask (negative space)
 *
 * Uses connected components labeling via Union-Find for O(n) performance.
 */

export interface IslandDetectionResult {
	islands: HTMLCanvasElement;
	land: HTMLCanvasElement;
	water: HTMLCanvasElement;
	stats: {
		islandCount: number;
		islandPixels: number;
		landPixels: number;
		waterPixels: number;
		components: ComponentInfo[];
	};
}

export interface ComponentInfo {
	label: number;
	pixelCount: number;
	boundingBox: { minX: number; maxX: number; minY: number; maxY: number };
	width: number;
	height: number;
	aspectRatio: number;
	rectangularity: number;
	isIsland: boolean;
}

export interface IslandDetectionConfig {
	targetAspectRatio?: number; // Default 1.5 (6:4)
	aspectTolerance?: number; // Default 0.4
	minRectangularity?: number; // Default 0.6
	minArea?: number; // Default 2000 pixels
	maxAreaRatio?: number; // Default 0.15 (15% of image)
}

const DEFAULT_CONFIG: Required<IslandDetectionConfig> = {
	targetAspectRatio: 1.5,
	aspectTolerance: 0.4,
	minRectangularity: 0.6,
	minArea: 2000,
	maxAreaRatio: 0.15
};

/**
 * Union-Find data structure for connected components
 */
class UnionFind {
	private parent: Uint32Array;
	private rank: Uint32Array;

	constructor(size: number) {
		this.parent = new Uint32Array(size);
		this.rank = new Uint32Array(size);
		for (let i = 0; i < size; i++) {
			this.parent[i] = i;
		}
	}

	find(x: number): number {
		if (this.parent[x] !== x) {
			this.parent[x] = this.find(this.parent[x]); // Path compression
		}
		return this.parent[x];
	}

	union(x: number, y: number): void {
		const rootX = this.find(x);
		const rootY = this.find(y);
		if (rootX === rootY) return;

		// Union by rank
		if (this.rank[rootX] < this.rank[rootY]) {
			this.parent[rootX] = rootY;
		} else if (this.rank[rootX] > this.rank[rootY]) {
			this.parent[rootY] = rootX;
		} else {
			this.parent[rootY] = rootX;
			this.rank[rootX]++;
		}
	}
}

/**
 * Detect islands in a binary mask and split into islands/land/water sub-masks
 */
export function detectIslands(
	maskCanvas: HTMLCanvasElement,
	config?: IslandDetectionConfig
): IslandDetectionResult {
	const cfg = { ...DEFAULT_CONFIG, ...config };
	const width = maskCanvas.width;
	const height = maskCanvas.height;
	const totalPixels = width * height;

	// Step 1: Extract binary data from mask
	const ctx = maskCanvas.getContext('2d')!;
	const imageData = ctx.getImageData(0, 0, width, height);
	const pixels = imageData.data;

	const binary = new Uint8Array(totalPixels);
	for (let i = 0; i < totalPixels; i++) {
		// Check alpha channel - white on transparent means alpha > 128
		binary[i] = pixels[i * 4 + 3] > 128 ? 1 : 0;
	}

	// Step 2: Connected components labeling with Union-Find
	const labels = new Uint32Array(totalPixels);
	const uf = new UnionFind(totalPixels + 1); // +1 for 1-based labels
	let nextLabel = 1;

	// First pass: assign provisional labels
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = y * width + x;
			if (binary[idx] === 0) continue; // Skip water pixels

			const leftIdx = x > 0 ? idx - 1 : -1;
			const topIdx = y > 0 ? idx - width : -1;

			const leftLabel = leftIdx >= 0 && binary[leftIdx] ? labels[leftIdx] : 0;
			const topLabel = topIdx >= 0 && binary[topIdx] ? labels[topIdx] : 0;

			if (leftLabel === 0 && topLabel === 0) {
				// New component
				labels[idx] = nextLabel++;
			} else if (leftLabel > 0 && topLabel > 0) {
				// Both neighbors labeled - use minimum and union
				labels[idx] = Math.min(leftLabel, topLabel);
				uf.union(leftLabel, topLabel);
			} else {
				// One neighbor labeled
				labels[idx] = leftLabel || topLabel;
			}
		}
	}

	// Second pass: flatten labels to root
	for (let i = 0; i < totalPixels; i++) {
		if (labels[i] > 0) {
			labels[i] = uf.find(labels[i]);
		}
	}

	// Step 3: Compute component properties
	const componentMap = new Map<
		number,
		{
			pixelCount: number;
			minX: number;
			maxX: number;
			minY: number;
			maxY: number;
		}
	>();

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const label = labels[y * width + x];
			if (label === 0) continue;

			if (!componentMap.has(label)) {
				componentMap.set(label, {
					pixelCount: 0,
					minX: Infinity,
					maxX: -Infinity,
					minY: Infinity,
					maxY: -Infinity
				});
			}

			const comp = componentMap.get(label)!;
			comp.pixelCount++;
			comp.minX = Math.min(comp.minX, x);
			comp.maxX = Math.max(comp.maxX, x);
			comp.minY = Math.min(comp.minY, y);
			comp.maxY = Math.max(comp.maxY, y);
		}
	}

	// Step 4: Classify components as islands or not
	const islandLabels = new Set<number>();
	const components: ComponentInfo[] = [];

	for (const [label, comp] of componentMap) {
		const compWidth = comp.maxX - comp.minX + 1;
		const compHeight = comp.maxY - comp.minY + 1;
		const boundingArea = compWidth * compHeight;

		const aspectRatio = compWidth / compHeight;
		const normalizedAspect = aspectRatio > 1 ? aspectRatio : 1 / aspectRatio;
		const rectangularity = comp.pixelCount / boundingArea;
		const areaRatio = comp.pixelCount / totalPixels;

		// Classification logic
		const aspectOk = Math.abs(normalizedAspect - cfg.targetAspectRatio) < cfg.aspectTolerance;
		const rectOk = rectangularity >= cfg.minRectangularity;
		const sizeOk = comp.pixelCount >= cfg.minArea && areaRatio <= cfg.maxAreaRatio;

		const isIsland = aspectOk && rectOk && sizeOk;

		if (isIsland) {
			islandLabels.add(label);
		}

		components.push({
			label,
			pixelCount: comp.pixelCount,
			boundingBox: {
				minX: comp.minX,
				maxX: comp.maxX,
				minY: comp.minY,
				maxY: comp.maxY
			},
			width: compWidth,
			height: compHeight,
			aspectRatio: normalizedAspect,
			rectangularity,
			isIsland
		});
	}

	// Step 5: Generate three output masks
	const islandsCanvas = createCanvas(width, height);
	const landCanvas = createCanvas(width, height);
	const waterCanvas = createCanvas(width, height);

	const islandsCtx = islandsCanvas.getContext('2d')!;
	const landCtx = landCanvas.getContext('2d')!;
	const waterCtx = waterCanvas.getContext('2d')!;

	const islandsData = islandsCtx.createImageData(width, height);
	const landData = landCtx.createImageData(width, height);
	const waterData = waterCtx.createImageData(width, height);

	let islandPixels = 0;
	let landPixels = 0;
	let waterPixels = 0;

	for (let i = 0; i < totalPixels; i++) {
		const label = labels[i];
		const pixelOffset = i * 4;

		if (binary[i] === 0) {
			// Water pixel (not in original mask)
			waterData.data[pixelOffset] = 255;
			waterData.data[pixelOffset + 1] = 255;
			waterData.data[pixelOffset + 2] = 255;
			waterData.data[pixelOffset + 3] = 255;
			waterPixels++;
		} else if (islandLabels.has(label)) {
			// Island pixel
			islandsData.data[pixelOffset] = 255;
			islandsData.data[pixelOffset + 1] = 255;
			islandsData.data[pixelOffset + 2] = 255;
			islandsData.data[pixelOffset + 3] = 255;
			islandPixels++;
		} else {
			// Land pixel (in mask but not island)
			landData.data[pixelOffset] = 255;
			landData.data[pixelOffset + 1] = 255;
			landData.data[pixelOffset + 2] = 255;
			landData.data[pixelOffset + 3] = 255;
			landPixels++;
		}
	}

	islandsCtx.putImageData(islandsData, 0, 0);
	landCtx.putImageData(landData, 0, 0);
	waterCtx.putImageData(waterData, 0, 0);

	return {
		islands: islandsCanvas,
		land: landCanvas,
		water: waterCanvas,
		stats: {
			islandCount: islandLabels.size,
			islandPixels,
			landPixels,
			waterPixels,
			components
		}
	};
}

/**
 * Create an offscreen canvas
 */
function createCanvas(width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}
