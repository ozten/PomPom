/**
 * Feliz Navidad Animation
 *
 * Fades the "Feliz Navidad" text opacity in and out over a 2-second period.
 * Uses a sine wave for smooth easing.
 */

import type { Animation, AnimationRenderState } from './types';

export const MASK_PATH = '/masks/feliz-navidad.png';
export const CYCLE_DURATION_MS = 2000; // 2 seconds for full fade in/out cycle

export interface FelizNavidadState {
	opacity: number;
	color: string;
	startTime: number;
	running: boolean;
	animationFrameId: number | null;
}

function createInitialState(): FelizNavidadState {
	return {
		opacity: 1,
		color: '#FFD700', // Gold
		startTime: 0,
		running: false,
		animationFrameId: null
	};
}

/**
 * Create a Feliz Navidad fade animation
 */
export function createFelizNavidadAnimation(
	onUpdate: (state: AnimationRenderState) => void
): Animation {
	const state = createInitialState();

	function update(timestamp: number) {
		if (!state.running) return;

		// Initialize start time on first frame
		if (state.startTime === 0) {
			state.startTime = timestamp;
		}

		// Calculate elapsed time
		const elapsed = timestamp - state.startTime;

		// Use sine wave for smooth fade: sin goes from -1 to 1
		// We map it to 0.2 to 1 (never fully transparent)
		const phase = (elapsed / CYCLE_DURATION_MS) * Math.PI * 2;
		state.opacity = 0.6 + 0.4 * Math.sin(phase); // Range: 0.2 to 1.0

		// Notify listener
		onUpdate({
			opacity: state.opacity,
			color: state.color
		});

		// Schedule next frame
		state.animationFrameId = requestAnimationFrame(update);
	}

	return {
		id: 'feliz-navidad',

		start() {
			if (state.running) return;
			state.running = true;
			state.startTime = 0;
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
			return {
				opacity: state.opacity,
				color: state.color
			};
		}
	};
}
