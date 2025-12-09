/**
 * Seeded Pseudo-Random Number Generator
 *
 * Provides deterministic random numbers for synchronized animations across pages.
 * Uses Mulberry32 algorithm - simple, fast, and produces high-quality randomness.
 */

/**
 * Create a seeded PRNG using the Mulberry32 algorithm
 * @param seed - Initial seed value (32-bit integer)
 * @returns A function that returns random numbers in [0, 1)
 */
export function createPRNG(seed: number): () => number {
	let state = seed >>> 0; // Ensure unsigned 32-bit

	return function random(): number {
		state = (state + 0x6d2b79f5) | 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Create a seed from a string (for namespacing)
 * Uses djb2 hash algorithm
 */
export function hashString(str: string): number {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
	}
	return hash >>> 0;
}

/**
 * Create a seeded PRNG from a string seed
 * Useful for creating reproducible random sequences from identifiers
 */
export function createPRNGFromString(str: string): () => number {
	return createPRNG(hashString(str));
}

/**
 * Combine multiple seeds into one
 * Useful for creating unique but deterministic seeds from multiple inputs
 */
export function combineSeeds(...seeds: number[]): number {
	let combined = 0;
	for (const seed of seeds) {
		combined = ((combined << 5) - combined + seed) | 0;
	}
	return combined >>> 0;
}
