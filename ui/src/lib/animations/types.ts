/**
 * Animation system types
 */

export interface AnimationState {
	/** Current time in milliseconds */
	time: number;
	/** Time since last frame in milliseconds */
	deltaTime: number;
	/** Whether animation is running */
	running: boolean;
}

export interface Animation {
	/** Unique identifier for this animation */
	id: string;
	/** Start the animation loop */
	start(): void;
	/** Stop the animation loop */
	stop(): void;
	/** Get current render state */
	getRenderState(): AnimationRenderState;
}

export interface AnimationRenderState {
	/** Opacity for the mask (0-1) */
	opacity: number;
	/** Color to apply to the mask */
	color: string;
}

export interface MaskInfo {
	/** Path to mask image */
	path: string;
	/** Human-readable name */
	name: string;
}
