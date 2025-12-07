/**
 * Animation system exports
 */

export * from './types';
export {
	createFelizNavidadAnimation,
	CYCLE_DURATION_MS,
	type FelizNavidadState
} from './feliz-navidad';
export {
	createPomPomAnimation,
	COLOR_CHANGE_INTERVAL_MS,
	TRANSITION_DURATION_MS,
	type PomPomState
} from './pom-pom';
export {
	createWallTextureAnimation,
	createSubMaskAnimations,
	CYCLE_DURATION_MS as WALL_TEXTURE_CYCLE_DURATION_MS,
	type WallTextureState,
	type WallTextureConfig
} from './wall-texture';
export {
	createIslandPhotosAnimation,
	SWAP_INTERVAL_MS,
	type IslandPhoto,
	type IslandPhotosAnimation
} from './island-photos';
