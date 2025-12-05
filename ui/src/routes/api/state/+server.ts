import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getState, setState } from '$lib/server/state';

export const GET: RequestHandler = async () => {
	return json(getState());
};

export const POST: RequestHandler = async ({ request }) => {
	const partial = await request.json();
	const updated = setState(partial);
	return json(updated);
};
