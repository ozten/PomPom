/**
 * Happy Birthday Animation
 *
 * Displays letters "HAPPY BIRTHDAY PKO" cycling through island slots.
 * Each letter fills an island, and after a delay, letters shift to make room
 * for the next one. Once "O" is displayed, the animation restarts.
 *
 * Uses deterministic randomness via ClockProvider for synchronized animations
 * across multiple pages.
 */

import type { ComponentInfo } from '../island-detection';
import type { ClockProvider } from './clock';
import { getFallbackClockProvider } from './clock';

// Configuration
export const LETTER_DURATION_MS = 7000; // Time before letters shift
export const FADE_DURATION_MS = 500; // Fade in/out duration for each letter
export const END_PAUSE_MS = 10000; // Pause after showing final letter before clearing
export const RESTART_DELAY_MS = 5000; // Delay after clearing before restarting

// Speed multiplier for testing (set to 5 for faster testing, 1 for normal)
export let SPEED_MULTIPLIER = 5;

// The message to display
const MESSAGE = 'HAPPY BIRTHDAY PKO';

// Styling
export const LETTER_BACKGROUND_COLOR = '#E91E63'; // Bold pink/magenta
export const LETTER_TEXT_COLOR = '#FFFFFF'; // White text
export const LETTER_FONT = 'bold 72px Arial Black, sans-serif'; // Bold blocky font

export interface IslandLetter {
	islandIndex: number;
	letter: string;
	boundingBox: { minX: number; maxX: number; minY: number; maxY: number };
	opacity: number; // 0-1 for fade in/out
	startTime: number; // When this letter started displaying in this slot
}

export interface HappyBirthdayState {
	islands: ComponentInfo[]; // Island info from detection
	letters: Map<number, IslandLetter>; // Map of islandIndex -> letter info
	running: boolean;
	animationFrameId: number | null;
	clockProvider: ClockProvider;
	currentLetterIndex: number; // Which letter in MESSAGE we're adding next
	lastLetterTime: number; // When we last added a letter
	cycleStartTime: number; // When the current cycle started
	phase: 'playing' | 'end-pause' | 'cleared-pause'; // Current animation phase
	phaseStartTime: number; // When the current phase started
}

export interface HappyBirthdayAnimation {
	id: string;
	start(): void;
	stop(): void;
	setIslands(islands: ComponentInfo[]): void;
	setClockProvider(provider: ClockProvider): void;
	getLetters(): IslandLetter[];
}

/**
 * Calculate opacity based on elapsed time with fade in
 */
function calculateOpacity(elapsed: number): number {
	if (elapsed < FADE_DURATION_MS) {
		// Fade in: ease-out curve
		const t = elapsed / FADE_DURATION_MS;
		return 1 - (1 - t) * (1 - t);
	}
	return 1; // Full opacity after fade in
}

/**
 * Create a Happy Birthday animation
 * @param onUpdate - Called when letters change, with the current letter assignments
 */
export function createHappyBirthdayAnimation(
	onUpdate: (letters: IslandLetter[]) => void
): HappyBirthdayAnimation {
	const state: HappyBirthdayState = {
		islands: [],
		letters: new Map(),
		running: false,
		animationFrameId: null,
		clockProvider: getFallbackClockProvider(),
		currentLetterIndex: 0,
		lastLetterTime: 0,
		cycleStartTime: 0,
		phase: 'playing',
		phaseStartTime: 0
	};

	/**
	 * Get valid islands sorted by reading order: top-to-bottom rows, left-to-right within rows
	 * Slot 0 = top-left, incrementing left-to-right, then next row
	 * Note: Standard screen coordinates - smaller Y = top of screen
	 */
	function getSortedIslands(): ComponentInfo[] {
		const sorted = state.islands
			.filter((c) => c.isIsland)
			.sort((a, b) => {
				// Sort by Y first (smaller Y = top = first), then X (left to right)
				const aY = (a.boundingBox.minY + a.boundingBox.maxY) / 2;
				const bY = (b.boundingBox.minY + b.boundingBox.maxY) / 2;
				// Use threshold to group into rows (50px tolerance)
				if (Math.abs(aY - bY) > 50) return aY - bY; // Smaller Y first (top of screen)
				const aX = (a.boundingBox.minX + a.boundingBox.maxX) / 2;
				const bX = (b.boundingBox.minX + b.boundingBox.maxX) / 2;
				return aX - bX; // Smaller X first (left)
			});
		// Debug: log the sort order with more detail
		if (sorted.length > 0) {
			console.log('[happy-birthday] Sorted islands (slot: x,y):', sorted.map((s, i) => {
				const cx = (s.boundingBox.minX + s.boundingBox.maxX) / 2;
				const cy = (s.boundingBox.minY + s.boundingBox.maxY) / 2;
				return `slot${i}: (${Math.round(cx)}, ${Math.round(cy)})`;
			}).join(' | '));
			console.log('[happy-birthday] Slot 0 should be top-left (smallest Y, then smallest X)');
		}
		return sorted;
	}

	/**
	 * Shift all existing letters to make room for a new one
	 * Letters shift toward lower slot indices (toward top-left)
	 * Letter at slot 0 gets removed (exits the display)
	 */
	function shiftLetters(now: number) {
		const sortedIslands = getSortedIslands();
		if (sortedIslands.length === 0) return;

		const newLetters = new Map<number, IslandLetter>();

		// Shift each letter to the previous slot (toward lower indices)
		for (const [islandIdx, letter] of state.letters) {
			// Find the current slot index
			const currentSlotIndex = sortedIslands.findIndex(
				(island) => state.islands.indexOf(island) === islandIdx
			);

			if (currentSlotIndex > 0) {
				// Move to previous slot (lower index)
				const newIsland = sortedIslands[currentSlotIndex - 1];
				const newIslandIndex = state.islands.indexOf(newIsland);
				newLetters.set(newIslandIndex, {
					...letter,
					islandIndex: newIslandIndex,
					boundingBox: newIsland.boundingBox,
					startTime: now // Reset start time for fade animation
				});
			}
			// Letters at slot 0 are dropped (exit the display)
		}

		state.letters = newLetters;
	}

	/**
	 * Add the next letter to the last slot (bottom-right)
	 * If the last slot is occupied, shift all letters first (toward slot 0)
	 */
	function addNextLetter(now: number) {
		const sortedIslands = getSortedIslands();
		console.log('[happy-birthday] addNextLetter, sortedIslands:', sortedIslands.length);
		if (sortedIslands.length === 0) return;

		const lastSlotIndex = sortedIslands.length - 1;

		// Check if the last slot is occupied
		const lastSlotIsland = sortedIslands[lastSlotIndex];
		const lastSlotIslandIndex = state.islands.indexOf(lastSlotIsland);
		const lastSlotOccupied = state.letters.has(lastSlotIslandIndex);

		// If the last slot is occupied, shift all letters to make room
		if (lastSlotOccupied) {
			shiftLetters(now);
		}

		// Target slot is always the last slot (bottom-right)
		const targetSlotIndex = lastSlotIndex;

		const targetIsland = sortedIslands[targetSlotIndex];
		const islandIndex = state.islands.indexOf(targetIsland);
		const letter = MESSAGE[state.currentLetterIndex];

		state.letters.set(islandIndex, {
			islandIndex,
			letter,
			boundingBox: targetIsland.boundingBox,
			opacity: 0,
			startTime: now
		});

		// Move to next letter
		state.currentLetterIndex = (state.currentLetterIndex + 1) % MESSAGE.length;

		// If we've completed the message, enter end-pause phase
		if (state.currentLetterIndex === 0) {
			console.log('[happy-birthday] Message complete, entering end-pause phase');
			state.phase = 'end-pause';
			state.phaseStartTime = now;
		}

		state.lastLetterTime = now;
	}

	let lastElapsedTime = 0;

	/**
	 * Animation loop
	 */
	function tick() {
		if (!state.running) return;

		// Apply speed multiplier to elapsed time
		const rawNow = state.clockProvider.getElapsedTime();
		const now = rawNow * SPEED_MULTIPLIER;
		lastElapsedTime = now;

		let needsUpdate = false;

		// Handle different phases
		if (state.phase === 'end-pause') {
			// Show the final message for END_PAUSE_MS, then clear and transition
			const timeSincePhaseStart = now - state.phaseStartTime;
			if (timeSincePhaseStart >= END_PAUSE_MS) {
				console.log('[happy-birthday] End pause complete, clearing letters');
				state.letters.clear();
				state.phase = 'cleared-pause';
				state.phaseStartTime = now;
				needsUpdate = true;
			} else {
				// Still showing final message, update opacity
				for (const [key, letter] of state.letters) {
					const elapsed = now - letter.startTime;
					const newOpacity = calculateOpacity(elapsed);
					if (Math.abs(letter.opacity - newOpacity) > 0.01) {
						letter.opacity = newOpacity;
						needsUpdate = true;
					}
				}
			}
		} else if (state.phase === 'cleared-pause') {
			// Wait with no letters for RESTART_DELAY_MS, then restart
			const timeSincePhaseStart = now - state.phaseStartTime;
			if (timeSincePhaseStart >= RESTART_DELAY_MS) {
				console.log('[happy-birthday] Cleared pause complete, restarting animation');
				state.phase = 'playing';
				state.currentLetterIndex = 0;
				state.lastLetterTime = now; // This will trigger immediate first letter
				state.cycleStartTime = now;
			}
		} else {
			// 'playing' phase - normal letter cycling
			// Update opacity for each letter
			for (const [key, letter] of state.letters) {
				const elapsed = now - letter.startTime;
				const newOpacity = calculateOpacity(elapsed);

				if (Math.abs(letter.opacity - newOpacity) > 0.01) {
					letter.opacity = newOpacity;
					needsUpdate = true;
				}
			}

			// Check if it's time to add a new letter
			const timeSinceLastLetter = now - state.lastLetterTime;
			if (timeSinceLastLetter >= LETTER_DURATION_MS || state.letters.size === 0) {
				addNextLetter(now);
				needsUpdate = true;
			}
		}

		// Notify if anything changed
		if (needsUpdate) {
			onUpdate(Array.from(state.letters.values()));
		}

		// Schedule next frame
		state.animationFrameId = requestAnimationFrame(tick);
	}

	return {
		id: 'happy-birthday',

		start() {
			if (state.running) return;
			console.log('[happy-birthday] Starting animation, islands:', state.islands.length);
			state.running = true;
			lastElapsedTime = 0;

			// Reset animation state
			state.letters.clear();
			state.currentLetterIndex = 0;
			state.lastLetterTime = 0;
			state.phase = 'playing';
			state.phaseStartTime = 0;
			state.cycleStartTime = state.clockProvider.getElapsedTime();

			// Start animation loop
			state.animationFrameId = requestAnimationFrame(tick);
		},

		stop() {
			state.running = false;
			if (state.animationFrameId !== null) {
				cancelAnimationFrame(state.animationFrameId);
				state.animationFrameId = null;
			}
			// Clear letters so they stop rendering
			state.letters.clear();
			onUpdate([]);
		},

		setIslands(islands: ComponentInfo[]) {
			console.log('[happy-birthday] setIslands called with', islands.length, 'islands');
			state.islands = islands;
			// Clear existing letters when islands change
			state.letters.clear();
			state.currentLetterIndex = 0;
			state.lastLetterTime = 0;
			onUpdate([]);
		},

		setClockProvider(provider: ClockProvider) {
			state.clockProvider = provider;
		},

		getLetters(): IslandLetter[] {
			return Array.from(state.letters.values());
		}
	};
}
