<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { startPolling, stopPolling, appState } from '$lib/state.svelte';

	onMount(() => {
		startPolling(500);
	});

	onDestroy(() => {
		stopPolling();
	});
</script>

<svelte:head>
	<title>Projection</title>
	<style>
		body {
			margin: 0;
			padding: 0;
			overflow: hidden;
		}
	</style>
</svelte:head>

<div
	class="w-screen h-screen relative"
	style="background-color: {appState.current.mode === 'calibrating' ? '#ffffff' : appState.current.projection.color}"
>
	{#if appState.current.mode === 'calibrating' && appState.current.calibration.status === 'showing-markers'}
		<!-- ArUco markers in corners -->
		<img src="/markers/marker-0.svg" alt="Marker 0" class="absolute top-4 left-4 w-24 h-24" />
		<img src="/markers/marker-1.svg" alt="Marker 1" class="absolute top-4 right-4 w-24 h-24" />
		<img src="/markers/marker-2.svg" alt="Marker 2" class="absolute bottom-4 left-4 w-24 h-24" />
		<img src="/markers/marker-3.svg" alt="Marker 3" class="absolute bottom-4 right-4 w-24 h-24" />
	{/if}

	{#if appState.current.mode === 'projecting'}
		<!-- Render masks -->
		{#each appState.current.projection.masks as mask}
			<img
				src={mask.imageData}
				alt="Mask {mask.id}"
				class="absolute"
				style="left: {mask.bounds.x}px; top: {mask.bounds.y}px; width: {mask.bounds.width}px; height: {mask.bounds.height}px;"
			/>
		{/each}
	{/if}
</div>
