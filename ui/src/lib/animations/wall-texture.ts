/**
 * Wall Texture Animation
 *
 * Cycles through HSL hue values for a smooth rainbow color effect.
 * Full cycle takes 10 seconds.
 */

import type { Animation, AnimationRenderState } from './types';

export const CYCLE_DURATION_MS = 10000; // 10 seconds for full rainbow cycle

export interface WallTextureState {
	hue: number; // 0-360
	opacity: number;
	running: boolean;
	animationFrameId: number | null;
	startTime: number;
}

function createInitialState(): WallTextureState {
	return {
		hue: 0,
		opacity: 1,
		running: false,
		animationFrameId: null,
		startTime: 0
	};
}

/**
 * Convert HSL to hex color
 */
function hslToHex(h: number, s: number, l: number): string {
	s /= 100;
	l /= 100;

	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;

	let r = 0, g = 0, b = 0;

	if (0 <= h && h < 60) {
		r = c; g = x; b = 0;
	} else if (60 <= h && h < 120) {
		r = x; g = c; b = 0;
	} else if (120 <= h && h < 180) {
		r = 0; g = c; b = x;
	} else if (180 <= h && h < 240) {
		r = 0; g = x; b = c;
	} else if (240 <= h && h < 300) {
		r = x; g = 0; b = c;
	} else if (300 <= h && h < 360) {
		r = c; g = 0; b = x;
	}

	const toHex = (n: number) => {
		const hex = Math.round((n + m) * 255).toString(16);
		return hex.length === 1 ? '0' + hex : hex;
	};

	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export interface WallTextureConfig {
	id: string;
	hueOffset?: number; // Offset to add to hue (0-360)
	saturation?: number; // 0-100, default 80
	lightness?: number; // 0-100, default 60
}

/**
 * Create a Wall Texture color cycling animation with optional configuration
 */
export function createWallTextureAnimation(
	onUpdate: (state: AnimationRenderState) => void,
	config?: WallTextureConfig
): Animation {
	const state = createInitialState();
	const id = config?.id ?? 'wall-texture';
	const hueOffset = config?.hueOffset ?? 0;
	const saturation = config?.saturation ?? 80;
	const lightness = config?.lightness ?? 60;

	function update(timestamp: number) {
		if (!state.running) return;

		// Initialize on first frame
		if (state.startTime === 0) {
			state.startTime = timestamp;
		}

		// Calculate elapsed time and current hue
		const elapsed = timestamp - state.startTime;
		const progress = (elapsed % CYCLE_DURATION_MS) / CYCLE_DURATION_MS;
		state.hue = (progress * 360 + hueOffset) % 360;

		// Convert HSL to hex
		const color = hslToHex(state.hue, saturation, lightness);

		// Notify listener
		onUpdate({
			opacity: state.opacity,
			color: color
		});

		// Schedule next frame
		state.animationFrameId = requestAnimationFrame(update);
	}

	return {
		id,

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
			const color = hslToHex(state.hue, saturation, lightness);
			return {
				opacity: state.opacity,
				color: color
			};
		}
	};
}

/**
 * Create animations for all three sub-mask types with offset hues
 * Islands: starts at 0° (red/orange)
 * Land: starts at 120° (green)
 * Water: starts at 240° (blue)
 */
export function createSubMaskAnimations(
	onUpdate: (subMaskId: string, state: AnimationRenderState) => void
): { islands: Animation; land: Animation; water: Animation } {
	return {
		islands: createWallTextureAnimation(
			(state) => onUpdate('wall-texture:islands', state),
			{ id: 'wall-texture:islands', hueOffset: 0, saturation: 85, lightness: 55 }
		),
		land: createWallTextureAnimation(
			(state) => onUpdate('wall-texture:land', state),
			{ id: 'wall-texture:land', hueOffset: 120, saturation: 70, lightness: 45 }
		),
		water: createWallTextureAnimation(
			(state) => onUpdate('wall-texture:water', state),
			{ id: 'wall-texture:water', hueOffset: 240, saturation: 75, lightness: 50 }
		)
	};
}
