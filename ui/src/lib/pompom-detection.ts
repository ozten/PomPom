/**
 * Pom-Pom Detection Algorithm
 *
 * Detects circular blobs in a mask and returns their centers and radii.
 * Uses connected components labeling similar to island detection,
 * but filters for circular shapes.
 */

export interface PomPomInfo {
	index: number;
	center: { x: number; y: number };
	radius: number;
	pixelCount: number;
	boundingBox: { minX: number; maxX: number; minY: number; maxY: number };
	circularity: number; // 0-1, where 1 is a perfect circle
	color?: string; // Pre-sampled color from webcam
}

export interface PomPomDetectionResult {
	pomPoms: PomPomInfo[];
	sortedByX: PomPomInfo[]; // Sorted left to right for chain traversal
}

export interface PomPomDetectionConfig {
	minRadius?: number; // Default 10
	maxRadius?: number; // Default 100
	minCircularity?: number; // Default 0.6
}

const DEFAULT_CONFIG: Required<PomPomDetectionConfig> = {
	minRadius: 10,
	maxRadius: 100,
	minCircularity: 0.6
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
 * Detect circular pom-pom blobs in a mask
 */
export function detectPomPoms(
	maskCanvas: HTMLCanvasElement,
	config?: PomPomDetectionConfig
): PomPomDetectionResult {
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
		binary[i] = pixels[i * 4 + 3] > 128 ? 1 : 0;
	}

	// Step 2: Connected components labeling with Union-Find
	const labels = new Uint32Array(totalPixels);
	const uf = new UnionFind(totalPixels + 1);
	let nextLabel = 1;

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = y * width + x;
			if (binary[idx] === 0) continue;

			const leftIdx = x > 0 ? idx - 1 : -1;
			const topIdx = y > 0 ? idx - width : -1;

			const leftLabel = leftIdx >= 0 && binary[leftIdx] ? labels[leftIdx] : 0;
			const topLabel = topIdx >= 0 && binary[topIdx] ? labels[topIdx] : 0;

			if (leftLabel === 0 && topLabel === 0) {
				labels[idx] = nextLabel++;
			} else if (leftLabel > 0 && topLabel > 0) {
				labels[idx] = Math.min(leftLabel, topLabel);
				uf.union(leftLabel, topLabel);
			} else {
				labels[idx] = leftLabel || topLabel;
			}
		}
	}

	// Flatten labels
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
			sumX: number;
			sumY: number;
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
					sumX: 0,
					sumY: 0,
					minX: Infinity,
					maxX: -Infinity,
					minY: Infinity,
					maxY: -Infinity
				});
			}

			const comp = componentMap.get(label)!;
			comp.pixelCount++;
			comp.sumX += x;
			comp.sumY += y;
			comp.minX = Math.min(comp.minX, x);
			comp.maxX = Math.max(comp.maxX, x);
			comp.minY = Math.min(comp.minY, y);
			comp.maxY = Math.max(comp.maxY, y);
		}
	}

	// Step 4: Classify as pom-pom (circular blob)
	const pomPoms: PomPomInfo[] = [];
	let index = 0;

	for (const [, comp] of componentMap) {
		const centerX = comp.sumX / comp.pixelCount;
		const centerY = comp.sumY / comp.pixelCount;

		const bboxWidth = comp.maxX - comp.minX + 1;
		const bboxHeight = comp.maxY - comp.minY + 1;

		// Estimate radius from bounding box (average of width and height / 2)
		const estimatedRadius = (bboxWidth + bboxHeight) / 4;

		// Calculate circularity: 4 * pi * area / perimeter^2
		// For a perfect circle, this equals 1
		// We approximate using: area / (pi * r^2) where r is estimated radius
		const expectedArea = Math.PI * estimatedRadius * estimatedRadius;
		const circularity = Math.min(1, comp.pixelCount / expectedArea);

		// Also check aspect ratio (relaxed to catch more elongated pom-poms)
		const aspectRatio = bboxWidth / bboxHeight;
		const aspectOk = aspectRatio > 0.4 && aspectRatio < 2.5;

		// Filter by radius and circularity
		const radiusOk = estimatedRadius >= cfg.minRadius && estimatedRadius <= cfg.maxRadius;
		const circularityOk = circularity >= cfg.minCircularity;

		if (radiusOk && circularityOk && aspectOk) {
			pomPoms.push({
				index: index++,
				center: { x: centerX, y: centerY },
				radius: estimatedRadius,
				pixelCount: comp.pixelCount,
				boundingBox: {
					minX: comp.minX,
					maxX: comp.maxX,
					minY: comp.minY,
					maxY: comp.maxY
				},
				circularity
			});
		}
	}

	// Sort by X coordinate (left to right) for chain traversal
	const sortedByX = [...pomPoms].sort((a, b) => a.center.x - b.center.x);

	// Update indices to match sorted order
	sortedByX.forEach((p, i) => (p.index = i));

	return {
		pomPoms,
		sortedByX
	};
}
