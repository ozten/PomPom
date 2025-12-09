export interface PomPomPosition {
	index: number;
	x: number;
	y: number;
	radius: number;
	color?: string; // Sampled color from webcam (hex)
}

// Camera quad - defines where the projection appears in camera image space
export interface CameraQuad {
	topLeft: { x: number; y: number };
	topRight: { x: number; y: number };
	bottomLeft: { x: number; y: number };
	bottomRight: { x: number; y: number };
	imageWidth: number;  // Actual camera image width
	imageHeight: number; // Actual camera image height
}

export interface AppState {
	mode: 'idle' | 'calibrating' | 'projecting';
	calibration: {
		status: 'none' | 'showing-markers' | 'captured' | 'complete';
		homography?: number[][];
		cameraQuad?: CameraQuad; // The projection boundary in camera image space
	};
	projection: {
		color: string;
		masks: TransformedMask[];
		pomPoms?: PomPomPosition[]; // Detected pom-pom positions for spotlight animation
		animationsEnabled?: boolean; // Master toggle for all animations (default: true)
	};
}

export interface IslandComponent {
	label: number;
	pixelCount: number;
	boundingBox: { minX: number; maxX: number; minY: number; maxY: number };
	width: number;
	height: number;
	aspectRatio: number;
	rectangularity: number;
	isIsland: boolean;
}

export interface SubMasks {
	islands: string; // base64 image data
	land: string;
	water: string;
	islandComponents?: IslandComponent[]; // Island bounding boxes for photo animation
}

export interface TransformedMask {
	id: string;
	imageData: string;
	bounds: { x: number; y: number; width: number; height: number };
	enabled?: boolean; // Default true if undefined
	subMasks?: SubMasks; // Optional sub-mask breakdown for wall-texture
}

export const DEFAULT_STATE: AppState = {
	mode: 'idle',
	calibration: {
		status: 'none'
	},
	projection: {
		color: '#000000', // Pure black - projector emits no light
		masks: []
	}
};
