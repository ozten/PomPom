import { DEFAULT_STATE, type AppState } from '$lib/types';

let state: AppState = structuredClone(DEFAULT_STATE);

export function getState(): AppState {
	return state;
}

export function setState(partial: Partial<AppState>): AppState {
	state = {
		...state,
		...partial,
		calibration: {
			...state.calibration,
			...(partial.calibration ?? {})
		},
		projection: {
			...state.projection,
			...(partial.projection ?? {})
		}
	};
	return state;
}

export function resetState(): AppState {
	state = structuredClone(DEFAULT_STATE);
	return state;
}
