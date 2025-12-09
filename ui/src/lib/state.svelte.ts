import { DEFAULT_STATE, type AppState } from '$lib/types';

let _state = $state<AppState>(structuredClone(DEFAULT_STATE));
let polling = $state(false);
let intervalId: ReturnType<typeof setInterval> | null = null;

export async function fetchState(): Promise<void> {
	try {
		const res = await fetch('/api/state');
		if (res.ok) {
			const newState = await res.json();
			_state.mode = newState.mode;
			_state.calibration = newState.calibration;
			_state.projection = newState.projection;
			_state.animationClock = newState.animationClock;
		}
	} catch (e) {
		console.error('Failed to fetch state:', e);
	}
}

export async function updateState(partial: Partial<AppState>): Promise<AppState> {
	const res = await fetch('/api/state', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(partial)
	});
	if (res.ok) {
		const newState = await res.json();
		_state.mode = newState.mode;
		_state.calibration = newState.calibration;
		_state.projection = newState.projection;
		_state.animationClock = newState.animationClock;
	}
	return _state;
}

export function startPolling(intervalMs = 500): void {
	if (polling) return;
	polling = true;
	fetchState();
	intervalId = setInterval(fetchState, intervalMs);
}

export function stopPolling(): void {
	if (intervalId) {
		clearInterval(intervalId);
		intervalId = null;
	}
	polling = false;
}

export const appState = {
	get current() {
		return _state;
	}
};
