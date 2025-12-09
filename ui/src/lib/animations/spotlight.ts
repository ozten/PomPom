/**
 * Spotlight Animation for Pom-Poms
 *
 * Creates a spotlight effect that:
 * 1. First spotlight appears, pulses, pans to leftmost pom-pom
 * 2. Every 2 seconds, a new spotlight spawns for the next pom-pom
 * 3. Each spotlight stays on its assigned pom-pom permanently
 * 4. End state: every pom-pom has its own spotlight
 *
 * Uses deterministic randomness via ClockProvider for synchronized animations
 * across multiple pages.
 */

import type { PomPomInfo } from '../pompom-detection';
import type { ClockProvider } from './clock';
import { getFallbackClockProvider } from './clock';

// Configuration
export const MAX_SPOTLIGHT_DIAMETER = 150;
export const PULSE_DURATION_MS = 800; // Time for one pulse cycle
export const PAN_DURATION_MS = 1500; // Time to pan to target pom pom
export const NEW_SPOTLIGHT_INTERVAL_MS = 2000; // Time between new spotlights
export const INTRO_PULSE_COUNT = 3; // Number of pulses before panning

// Particle configuration
export const SPARK_EMIT_RATE = 30; // particles per second
export const SPARK_LIFETIME_DISTANCE = 200; // pixels before particle dies
export const SPARK_START_OFFSET = 25; // pixels from outer edge of pom-pom
export const SPARK_SPEED = 150; // pixels per second
export const SPARK_SIZE = 4; // base particle size in pixels

export interface SpotlightInfo {
	id: number;
	x: number;
	y: number;
	diameter: number;
	opacity: number;
	targetPomPomIndex: number; // Which pom pom this spotlight is targeting
	phase: 'intro' | 'panning' | 'holding'; // Each spotlight stays on its pom-pom
	pomPomColor?: string; // Sampled color from webcam (hex)
}

export interface SparkParticle {
	id: number;
	x: number;
	y: number;
	velocityX: number;
	velocityY: number;
	color: string;
	distanceTraveled: number;
	maxDistance: number; // 200px lifetime
	size: number;
	opacity: number;
}

export interface SpotlightState {
	spotlights: SpotlightInfo[];
	pomPoms: PomPomInfo[];
	assignedPomPoms: Set<number>; // Indices of pom poms that have a spotlight assigned
	nextSpotlightId: number;
	nextParticleId: number;
	running: boolean;
	animationFrameId: number | null;
	lastNewSpotlightTime: number;
	lastFrameTime: number;
	projectorWidth: number;
	projectorHeight: number;
	particles: SparkParticle[];
	colorSampler: ((x: number, y: number) => string | null) | null;
	clockProvider: ClockProvider;
}

export interface SpotlightAnimation {
	id: string;
	start(): void;
	stop(): void;
	setPomPoms(pomPoms: PomPomInfo[]): void;
	setColorSampler(sampler: (x: number, y: number) => string | null): void;
	setClockProvider(clock: ClockProvider): void;
	getSpotlights(): SpotlightInfo[];
	getParticles(): SparkParticle[];
}

// Easing functions
function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutQuad(t: number): number {
	return 1 - (1 - t) * (1 - t);
}

// Pulse function: creates a smooth pulse between min and max
function pulse(t: number, minVal: number, maxVal: number): number {
	// Use sine wave for smooth pulsing
	const pulseT = (Math.sin(t * Math.PI * 2 - Math.PI / 2) + 1) / 2;
	return minVal + (maxVal - minVal) * pulseT;
}

// Clamp diameter so spotlight doesn't extend past projection boundaries
function clampDiameterToBounds(
	x: number,
	y: number,
	diameter: number,
	width: number,
	height: number
): number {
	const radius = diameter / 2;
	// Find the maximum radius that fits within bounds
	const maxRadiusLeft = x;
	const maxRadiusRight = width - x;
	const maxRadiusTop = y;
	const maxRadiusBottom = height - y;
	const maxRadius = Math.min(maxRadiusLeft, maxRadiusRight, maxRadiusTop, maxRadiusBottom, radius);
	return Math.max(0, maxRadius * 2);
}

interface SpotlightInternal extends SpotlightInfo {
	startTime: number;
	startX: number;
	startY: number;
	panStartTime: number;
	colorSampled: boolean;
	lastEmitTime: number;
	pomPomRadius: number; // Store the pom-pom's radius for particle emission
	perpendicularAngle: number; // Angle perpendicular to garland line (radians)
}

/**
 * Create a Spotlight animation
 * @param onUpdate - Called each frame with current spotlight positions
 * @param projectorWidth - Width of the projection area
 * @param projectorHeight - Height of the projection area
 */
export function createSpotlightAnimation(
	onUpdate: (spotlights: SpotlightInfo[]) => void,
	projectorWidth: number,
	projectorHeight: number
): SpotlightAnimation {
	const state: SpotlightState & { internalSpotlights: SpotlightInternal[] } = {
		spotlights: [],
		internalSpotlights: [],
		pomPoms: [],
		assignedPomPoms: new Set(),
		nextSpotlightId: 0,
		nextParticleId: 0,
		running: false,
		animationFrameId: null,
		lastNewSpotlightTime: 0,
		lastFrameTime: 0,
		projectorWidth,
		projectorHeight,
		particles: [],
		colorSampler: null,
		clockProvider: getFallbackClockProvider() // Default to fallback, can be set via setClockProvider
	};

	/**
	 * Calculate the perpendicular angle to the garland line at a given pom-pom
	 * Uses nearest neighbors to determine the local garland direction
	 */
	function calculatePerpendicularAngle(targetPomPom: PomPomInfo): number {
		// Sort all pom-poms by x position
		const sortedPomPoms = [...state.pomPoms].sort((a, b) => a.center.x - b.center.x);
		const targetIndex = sortedPomPoms.findIndex(p => p.index === targetPomPom.index);

		let garlandAngle: number;

		if (sortedPomPoms.length === 1) {
			// Only one pom-pom, default to horizontal garland (emit up/down)
			garlandAngle = 0;
		} else if (targetIndex === 0) {
			// Leftmost pom-pom: use direction to next neighbor
			const next = sortedPomPoms[1];
			garlandAngle = Math.atan2(
				next.center.y - targetPomPom.center.y,
				next.center.x - targetPomPom.center.x
			);
		} else if (targetIndex === sortedPomPoms.length - 1) {
			// Rightmost pom-pom: use direction from previous neighbor
			const prev = sortedPomPoms[targetIndex - 1];
			garlandAngle = Math.atan2(
				targetPomPom.center.y - prev.center.y,
				targetPomPom.center.x - prev.center.x
			);
		} else {
			// Middle pom-pom: average direction from prev to next
			const prev = sortedPomPoms[targetIndex - 1];
			const next = sortedPomPoms[targetIndex + 1];
			garlandAngle = Math.atan2(
				next.center.y - prev.center.y,
				next.center.x - prev.center.x
			);
		}

		// Perpendicular is 90 degrees (PI/2) from garland direction
		return garlandAngle + Math.PI / 2;
	}

	/**
	 * Create a new spotlight at a random position above the pom poms
	 * Each spotlight targets ONE pom-pom and stays there
	 * Uses seeded PRNG for deterministic positioning
	 */
	function createNewSpotlight(): SpotlightInternal | null {
		if (state.pomPoms.length === 0) return null;

		// Find unassigned pom poms sorted by x position (left to right)
		const unassigned = state.pomPoms
			.filter((p) => !state.assignedPomPoms.has(p.index))
			.sort((a, b) => a.center.x - b.center.x);

		if (unassigned.length === 0) return null;

		// Target the leftmost unassigned pom pom
		const targetPomPom = unassigned[0];
		state.assignedPomPoms.add(targetPomPom.index);

		// Calculate perpendicular angle to garland line for particle emission
		const perpendicularAngle = calculatePerpendicularAngle(targetPomPom);

		// Find the topmost pom pom to position spotlight above
		const topY = Math.min(...state.pomPoms.map((p) => p.center.y - p.radius));

		// Get seeded PRNG for this spotlight's initial position
		const spotlightId = state.nextSpotlightId;
		const positionPRNG = state.clockProvider.getPRNG(`spotlight-position-${spotlightId}`);

		// Start position: deterministic random x within bounds, above the pom poms
		const margin = MAX_SPOTLIGHT_DIAMETER;
		const startX = margin + positionPRNG() * (state.projectorWidth - margin * 2);
		const startY = Math.max(margin, topY - 100 - positionPRNG() * 100);

		// Use clock elapsed time instead of performance.now()
		const now = state.clockProvider.getElapsedTime();

		const spotlight: SpotlightInternal = {
			id: state.nextSpotlightId++,
			x: startX,
			y: startY,
			diameter: 0,
			opacity: 1,
			targetPomPomIndex: targetPomPom.index,
			phase: 'intro',
			startTime: now,
			startX,
			startY,
			panStartTime: 0,
			colorSampled: targetPomPom.color ? true : false, // Already have color if pre-sampled
			lastEmitTime: 0,
			pomPomRadius: targetPomPom.radius,
			pomPomColor: targetPomPom.color, // Use pre-sampled color if available
			perpendicularAngle
		};

		return spotlight;
	}

	/**
	 * Emit a spark particle from the pom-pom's edge
	 * Particles emit perpendicular to the garland line (up/down relative to the chain)
	 * with ±25° variation for a fuller field
	 * Uses seeded PRNG for deterministic particle properties
	 */
	function emitParticle(spotlight: SpotlightInternal): void {
		if (!spotlight.pomPomColor) return;

		// Get seeded PRNG for this particle
		const particleId = state.nextParticleId;
		const particlePRNG = state.clockProvider.getPRNG(`particle-${spotlight.id}-${particleId}`);

		// Emit in perpendicular direction with ±25° variation
		// Deterministically choose "up" or "down" the perpendicular (180° apart)
		const baseAngle = spotlight.perpendicularAngle + (particlePRNG() < 0.5 ? 0 : Math.PI);

		// Add ±25° (±0.436 radians) variation
		const variation = (particlePRNG() - 0.5) * 2 * (25 * Math.PI / 180);
		const angle = baseAngle + variation;

		// Start position: pom-pom center + radius + offset
		const emitRadius = spotlight.pomPomRadius + SPARK_START_OFFSET;
		const startX = spotlight.x + Math.cos(angle) * emitRadius;
		const startY = spotlight.y + Math.sin(angle) * emitRadius;

		// Velocity pointing outward from center
		const velocityX = Math.cos(angle) * SPARK_SPEED;
		const velocityY = Math.sin(angle) * SPARK_SPEED;

		const particle: SparkParticle = {
			id: state.nextParticleId++,
			x: startX,
			y: startY,
			velocityX,
			velocityY,
			color: spotlight.pomPomColor,
			distanceTraveled: 0,
			maxDistance: SPARK_LIFETIME_DISTANCE,
			size: SPARK_SIZE * (0.5 + particlePRNG() * 0.5), // Vary size slightly with seeded random
			opacity: 1
		};

		state.particles.push(particle);
	}

	/**
	 * Update all particles
	 */
	function updateParticles(deltaTime: number): void {
		const deltaSeconds = deltaTime / 1000;

		for (const particle of state.particles) {
			// Move particle
			const moveX = particle.velocityX * deltaSeconds;
			const moveY = particle.velocityY * deltaSeconds;
			particle.x += moveX;
			particle.y += moveY;
			particle.distanceTraveled += Math.sqrt(moveX * moveX + moveY * moveY);

			// Fade out as it travels
			const progress = particle.distanceTraveled / particle.maxDistance;
			particle.opacity = 1 - progress;
			particle.size = SPARK_SIZE * (1 - progress * 0.5); // Shrink slightly
		}

		// Remove dead particles
		state.particles = state.particles.filter(p => p.distanceTraveled < p.maxDistance);
	}

	/**
	 * Update a single spotlight's animation state
	 * Each spotlight goes to ONE pom-pom and stays there permanently
	 */
	function updateSpotlight(spotlight: SpotlightInternal, now: number): void {
		const elapsed = now - spotlight.startTime;

		switch (spotlight.phase) {
			case 'intro': {
				// Pulsing introduction phase
				const introDuration = PULSE_DURATION_MS * INTRO_PULSE_COUNT;
				const t = Math.min(1, elapsed / introDuration);

				// Grow from 0 to max while pulsing
				const growthProgress = easeOutQuad(t);
				const baseSize = MAX_SPOTLIGHT_DIAMETER * growthProgress;

				// Add pulse effect
				const pulseT = elapsed / PULSE_DURATION_MS;
				let diameter = pulse(pulseT, baseSize * 0.7, baseSize);
				// Clamp to projection bounds
				spotlight.diameter = clampDiameterToBounds(
					spotlight.x, spotlight.y, diameter,
					state.projectorWidth, state.projectorHeight
				);

				if (elapsed >= introDuration) {
					spotlight.phase = 'panning';
					spotlight.panStartTime = now;
				}
				break;
			}

			case 'panning': {
				// Pan to the target pom pom
				const panElapsed = now - spotlight.panStartTime;
				const t = Math.min(1, panElapsed / PAN_DURATION_MS);
				const easedT = easeInOutCubic(t);

				const targetPomPom = state.pomPoms.find((p) => p.index === spotlight.targetPomPomIndex);
				if (!targetPomPom) {
					spotlight.phase = 'holding';
					break;
				}

				spotlight.x = spotlight.startX + (targetPomPom.center.x - spotlight.startX) * easedT;
				spotlight.y = spotlight.startY + (targetPomPom.center.y - spotlight.startY) * easedT;

				// Continue pulsing gently
				const pulseT = panElapsed / PULSE_DURATION_MS;
				let diameter = pulse(pulseT, MAX_SPOTLIGHT_DIAMETER * 0.85, MAX_SPOTLIGHT_DIAMETER);
				// Clamp to projection bounds
				spotlight.diameter = clampDiameterToBounds(
					spotlight.x, spotlight.y, diameter,
					state.projectorWidth, state.projectorHeight
				);

				if (t >= 1) {
					// Arrived at target - stay here permanently
					spotlight.phase = 'holding';
				}
				break;
			}

			case 'holding': {
				// Stay on this pom-pom permanently with gentle pulsing
				const holdElapsed = now - spotlight.startTime;
				const pulseT = holdElapsed / PULSE_DURATION_MS;
				let diameter = pulse(pulseT, MAX_SPOTLIGHT_DIAMETER * 0.9, MAX_SPOTLIGHT_DIAMETER);
				// Clamp to projection bounds
				spotlight.diameter = clampDiameterToBounds(
					spotlight.x, spotlight.y, diameter,
					state.projectorWidth, state.projectorHeight
				);
				spotlight.opacity = 1; // Stay fully visible

				// Sample color once when we first enter holding phase
				if (!spotlight.colorSampled && state.colorSampler) {
					const sampledColor = state.colorSampler(spotlight.x, spotlight.y);
					if (sampledColor) {
						spotlight.pomPomColor = sampledColor;
					}
					spotlight.colorSampled = true;
					spotlight.lastEmitTime = now;
				}

				// Emit particles at the configured rate
				if (spotlight.pomPomColor) {
					// Initialize lastEmitTime if not set
					if (spotlight.lastEmitTime === 0) {
						spotlight.lastEmitTime = now;
					}

					const emitInterval = 1000 / SPARK_EMIT_RATE; // ms between particles
					const timeSinceLastEmit = now - spotlight.lastEmitTime;
					// Cap particles per frame to prevent explosion on lag/init
					const particlesToEmit = Math.min(5, Math.floor(timeSinceLastEmit / emitInterval));

					for (let i = 0; i < particlesToEmit; i++) {
						emitParticle(spotlight);
					}

					if (particlesToEmit > 0) {
						spotlight.lastEmitTime = now - (timeSinceLastEmit % emitInterval);
					}
				}
				break;
			}
		}
	}

	/**
	 * Main animation loop
	 * Uses clock provider's elapsed time for deterministic timing across pages
	 */
	function animate(): void {
		if (!state.running) return;

		// Use clock provider's elapsed time for deterministic sync
		const now = state.clockProvider.getElapsedTime();

		// Calculate delta time
		const deltaTime = state.lastFrameTime > 0 ? now - state.lastFrameTime : 16;
		state.lastFrameTime = now;

		// Check if we need to spawn a new spotlight
		const timeSinceLastSpotlight = now - state.lastNewSpotlightTime;
		const hasUnassignedPomPoms = state.pomPoms.some((p) => !state.assignedPomPoms.has(p.index));

		// Create initial spotlight or spawn new ones after interval
		if (hasUnassignedPomPoms) {
			if (state.internalSpotlights.length === 0) {
				// First spotlight
				const newSpotlight = createNewSpotlight();
				if (newSpotlight) {
					state.internalSpotlights.push(newSpotlight);
					state.lastNewSpotlightTime = now;
				}
			} else if (timeSinceLastSpotlight >= NEW_SPOTLIGHT_INTERVAL_MS) {
				// Spawn additional spotlights every 2 seconds for remaining pom-poms
				const newSpotlight = createNewSpotlight();
				if (newSpotlight) {
					state.internalSpotlights.push(newSpotlight);
					state.lastNewSpotlightTime = now;
				}
			}
		}

		// Update all spotlights
		for (const spotlight of state.internalSpotlights) {
			updateSpotlight(spotlight, now);
		}

		// Update particles
		updateParticles(deltaTime);

		// Convert to public interface
		state.spotlights = state.internalSpotlights.map((s) => ({
			id: s.id,
			x: s.x,
			y: s.y,
			diameter: s.diameter,
			opacity: s.opacity,
			targetPomPomIndex: s.targetPomPomIndex,
			phase: s.phase,
			pomPomColor: s.pomPomColor
		}));

		// Notify listener
		onUpdate(state.spotlights);

		// Continue animation loop
		state.animationFrameId = requestAnimationFrame(animate);
	}

	return {
		id: 'spotlight',

		start() {
			if (state.running) return;
			state.running = true;
			state.assignedPomPoms.clear();
			state.internalSpotlights = [];
			state.spotlights = [];
			state.particles = [];
			state.lastNewSpotlightTime = 0;
			state.lastFrameTime = 0;
			state.nextSpotlightId = 0;
			state.nextParticleId = 0;

			state.animationFrameId = requestAnimationFrame(animate);
		},

		stop() {
			state.running = false;
			if (state.animationFrameId !== null) {
				cancelAnimationFrame(state.animationFrameId);
				state.animationFrameId = null;
			}
			state.spotlights = [];
			state.internalSpotlights = [];
			state.particles = [];
			state.assignedPomPoms.clear();
			onUpdate([]);
		},

		setPomPoms(pomPoms: PomPomInfo[]) {
			state.pomPoms = pomPoms;
			state.assignedPomPoms.clear();
		},

		setColorSampler(sampler: (x: number, y: number) => string | null) {
			state.colorSampler = sampler;
		},

		setClockProvider(clock: ClockProvider) {
			state.clockProvider = clock;
		},

		getSpotlights(): SpotlightInfo[] {
			return state.spotlights;
		},

		getParticles(): SparkParticle[] {
			return state.particles;
		}
	};
}
