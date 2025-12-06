/**
 * Pom Pom Animation
 *
 * Changes the garland/pom pom color to a random color every 5 seconds.
 * Includes smooth color transition.
 */

import type { Animation, AnimationRenderState } from './types';

export const MASK_PATH = '/masks/garland.png';
export const COLOR_CHANGE_INTERVAL_MS = 5000; // 5 seconds between color changes
export const TRANSITION_DURATION_MS = 500; // 0.5 second transition

// Vibrant color palette for pom poms
const COLOR_PALETTE = [
	'#FF6B6B', // Red
	'#4ECDC4', // Teal
	'#FFE66D', // Yellow
	'#95E1D3', // Mint
	'#F38181', // Coral
	'#AA96DA', // Lavender
	'#FF9F43', // Orange
	'#6BCB77', // Green
	'#4D96FF', // Blue
	'#FF6FB5' // Pink
];

export interface PomPomState {
	currentColor: string;
	targetColor: string;
	transitionProgress: number;
	lastColorChangeTime: number;
	opacity: number;
	running: boolean;
	animationFrameId: number | null;
	startTime: number;
}

function createInitialState(): PomPomState {
	return {
		currentColor: COLOR_PALETTE[0],
		targetColor: COLOR_PALETTE[0],
		transitionProgress: 1,
		lastColorChangeTime: 0,
		opacity: 1,
		running: false,
		animationFrameId: null,
		startTime: 0
	};
}

/**
 * Get a random color from the palette, different from current
 */
function getRandomColor(currentColor: string): string {
	const availableColors = COLOR_PALETTE.filter((c) => c !== currentColor);
	return availableColors[Math.floor(Math.random() * availableColors.length)];
}

/**
 * Interpolate between two hex colors
 */
function lerpColor(color1: string, color2: string, t: number): string {
	// Parse hex colors
	const r1 = parseInt(color1.slice(1, 3), 16);
	const g1 = parseInt(color1.slice(3, 5), 16);
	const b1 = parseInt(color1.slice(5, 7), 16);

	const r2 = parseInt(color2.slice(1, 3), 16);
	const g2 = parseInt(color2.slice(3, 5), 16);
	const b2 = parseInt(color2.slice(5, 7), 16);

	// Interpolate
	const r = Math.round(r1 + (r2 - r1) * t);
	const g = Math.round(g1 + (g2 - g1) * t);
	const b = Math.round(b1 + (b2 - b1) * t);

	// Return hex
	return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Create a Pom Pom color animation
 */
export function createPomPomAnimation(onUpdate: (state: AnimationRenderState) => void): Animation {
	const state = createInitialState();

	function update(timestamp: number) {
		if (!state.running) return;

		// Initialize on first frame
		if (state.startTime === 0) {
			state.startTime = timestamp;
			state.lastColorChangeTime = timestamp;
		}

		// Check if it's time for a new color
		const timeSinceLastChange = timestamp - state.lastColorChangeTime;
		if (timeSinceLastChange >= COLOR_CHANGE_INTERVAL_MS) {
			// Start transition to new color
			state.currentColor = state.targetColor;
			state.targetColor = getRandomColor(state.currentColor);
			state.transitionProgress = 0;
			state.lastColorChangeTime = timestamp;
		}

		// Update transition progress
		if (state.transitionProgress < 1) {
			state.transitionProgress = Math.min(
				1,
				(timestamp - state.lastColorChangeTime) / TRANSITION_DURATION_MS
			);
		}

		// Calculate interpolated color
		const displayColor = lerpColor(state.currentColor, state.targetColor, state.transitionProgress);

		// Notify listener
		onUpdate({
			opacity: state.opacity,
			color: displayColor
		});

		// Schedule next frame
		state.animationFrameId = requestAnimationFrame(update);
	}

	return {
		id: 'pom-pom',

		start() {
			if (state.running) return;
			state.running = true;
			state.startTime = 0;
			state.lastColorChangeTime = 0;
			state.animationFrameId = requestAnimationFrame(update);
		},

		stop() {
			state.running = false;
			if (state.animationFrameId !== null) {
				cancelAnimationFrame(state.animationFrameId);
				state.animationFrameId = null;
			}
		},

		getRenderState(): AnimationRenderState {
			const displayColor = lerpColor(
				state.currentColor,
				state.targetColor,
				state.transitionProgress
			);
			return {
				opacity: state.opacity,
				color: displayColor
			};
		}
	};
}
