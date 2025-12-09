/**
 * Animation Clock Provider
 *
 * Provides synchronized timing and deterministic randomness for animations.
 * Both /control and /projection pages use this to compute identical animation state.
 */

import type { AnimationClock } from '../types';
import { createPRNG, hashString, combineSeeds } from './prng';

/**
 * Interface for the clock provider that animations use
 */
export interface ClockProvider {
	/**
	 * Get elapsed time since animation started (in milliseconds)
	 */
	getElapsedTime(): number;

	/**
	 * Get a namespaced seeded PRNG
	 * The same namespace always returns the same sequence of random numbers
	 * @param namespace - Unique identifier for this random sequence (e.g., 'spotlight-0', 'particle-emit')
	 */
	getPRNG(namespace: string): () => number;

	/**
	 * Get the current sequence number (useful for detecting clock resets)
	 */
	getSequenceNumber(): number;

	/**
	 * Get the base seed (useful for debugging)
	 */
	getSeed(): number;
}

/**
 * Create a clock provider from shared animation clock state
 */
export function createClockProvider(clock: AnimationClock): ClockProvider {
	const { startedAt, seed, sequenceNumber } = clock;

	// Cache PRNGs per namespace to maintain sequence consistency
	const prngCache = new Map<string, () => number>();

	return {
		getElapsedTime(): number {
			return Date.now() - startedAt;
		},

		getPRNG(namespace: string): () => number {
			if (!prngCache.has(namespace)) {
				// Combine base seed with namespace hash for unique but deterministic stream
				const namespaceSeed = combineSeeds(seed, hashString(namespace));
				prngCache.set(namespace, createPRNG(namespaceSeed));
			}
			return prngCache.get(namespace)!;
		},

		getSequenceNumber(): number {
			return sequenceNumber;
		},

		getSeed(): number {
			return seed;
		}
	};
}

/**
 * Create a new animation clock (called when starting projecting mode)
 */
export function createAnimationClock(previousSequence: number = 0): AnimationClock {
	return {
		startedAt: Date.now(),
		seed: Math.floor(Math.random() * 2147483647), // Random 31-bit seed
		sequenceNumber: previousSequence + 1
	};
}

/**
 * Default/fallback clock provider for when no shared clock is available
 * Uses local time and a fixed seed - animations will work but won't sync
 */
let fallbackStartTime: number | null = null;
let fallbackSeed = 12345;

export function getFallbackClockProvider(): ClockProvider {
	if (fallbackStartTime === null) {
		fallbackStartTime = Date.now();
	}

	const prngCache = new Map<string, () => number>();

	return {
		getElapsedTime(): number {
			return Date.now() - fallbackStartTime!;
		},

		getPRNG(namespace: string): () => number {
			if (!prngCache.has(namespace)) {
				const namespaceSeed = combineSeeds(fallbackSeed, hashString(namespace));
				prngCache.set(namespace, createPRNG(namespaceSeed));
			}
			return prngCache.get(namespace)!;
		},

		getSequenceNumber(): number {
			return 0;
		},

		getSeed(): number {
			return fallbackSeed;
		}
	};
}

/**
 * Reset the fallback clock (useful for testing)
 */
export function resetFallbackClock(): void {
	fallbackStartTime = null;
}
