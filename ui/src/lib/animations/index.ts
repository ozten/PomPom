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
export {
	createSpotlightAnimation,
	MAX_SPOTLIGHT_DIAMETER,
	PULSE_DURATION_MS,
	PAN_DURATION_MS,
	NEW_SPOTLIGHT_INTERVAL_MS,
	SPARK_EMIT_RATE,
	SPARK_LIFETIME_DISTANCE,
	type SpotlightInfo,
	type SparkParticle,
	type SpotlightAnimation
} from './spotlight';
