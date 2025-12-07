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

export interface TransformedMask {
	id: string;
	imageData: string;
	bounds: { x: number; y: number; width: number; height: number };
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
