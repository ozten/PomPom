export interface AppState {
	mode: 'idle' | 'calibrating' | 'projecting';
	calibration: {
		status: 'none' | 'showing-markers' | 'captured' | 'complete';
		homography?: number[][];
	};
	projection: {
		color: string;
		masks: TransformedMask[];
	};
}

export interface SubMasks {
	islands: string; // base64 image data
	land: string;
	water: string;
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
