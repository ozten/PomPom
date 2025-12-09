/**
 * WebGL-based perspective transform for mapping a texture onto a quad
 */

export interface Point {
	x: number;
	y: number;
}

export interface Quad {
	topLeft: Point;
	topRight: Point;
	bottomLeft: Point;
	bottomRight: Point;
}

// Cached WebGL resources to avoid creating too many contexts
let cachedGLCanvas: HTMLCanvasElement | null = null;
let cachedGL: WebGLRenderingContext | null = null;
let cachedProgram: WebGLProgram | null = null;
let cachedPositionBuffer: WebGLBuffer | null = null;
let cachedTexture: WebGLTexture | null = null;
let cachedPositionLoc: number = -1;
let cachedResolutionLoc: WebGLUniformLocation | null = null;
let cachedHomographyLoc: WebGLUniformLocation | null = null;

/**
 * Compute a 3x3 homography matrix that maps unit square to the given quad
 * Uses the DLT (Direct Linear Transform) algorithm
 */
function computeHomography(quad: Quad): number[] {
	// Source: unit square corners
	const sx = [0, 1, 1, 0];
	const sy = [0, 0, 1, 1];

	// Destination: quad corners
	const dx = [quad.topLeft.x, quad.topRight.x, quad.bottomRight.x, quad.bottomLeft.x];
	const dy = [quad.topLeft.y, quad.topRight.y, quad.bottomRight.y, quad.bottomLeft.y];

	// Build the 8x8 matrix for DLT
	const A: number[][] = [];
	for (let i = 0; i < 4; i++) {
		A.push([
			sx[i], sy[i], 1, 0, 0, 0, -dx[i] * sx[i], -dx[i] * sy[i]
		]);
		A.push([
			0, 0, 0, sx[i], sy[i], 1, -dy[i] * sx[i], -dy[i] * sy[i]
		]);
	}

	// Right hand side
	const b = [dx[0], dy[0], dx[1], dy[1], dx[2], dy[2], dx[3], dy[3]];

	// Solve using Gaussian elimination
	const h = solveLinearSystem(A, b);

	// Return 3x3 homography matrix (row-major)
	return [
		h[0], h[1], h[2],
		h[3], h[4], h[5],
		h[6], h[7], 1
	];
}

/**
 * Solve Ax = b using Gaussian elimination with partial pivoting
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
	const n = b.length;
	const augmented = A.map((row, i) => [...row, b[i]]);

	// Forward elimination
	for (let col = 0; col < n; col++) {
		// Find pivot
		let maxRow = col;
		for (let row = col + 1; row < n; row++) {
			if (Math.abs(augmented[row][col]) > Math.abs(augmented[maxRow][col])) {
				maxRow = row;
			}
		}
		[augmented[col], augmented[maxRow]] = [augmented[maxRow], augmented[col]];

		// Eliminate
		for (let row = col + 1; row < n; row++) {
			const factor = augmented[row][col] / augmented[col][col];
			for (let j = col; j <= n; j++) {
				augmented[row][j] -= factor * augmented[col][j];
			}
		}
	}

	// Back substitution
	const x = new Array(n).fill(0);
	for (let i = n - 1; i >= 0; i--) {
		x[i] = augmented[i][n];
		for (let j = i + 1; j < n; j++) {
			x[i] -= augmented[i][j] * x[j];
		}
		x[i] /= augmented[i][i];
	}

	return x;
}

/**
 * Initialize or get cached WebGL resources
 */
function getOrCreateGLResources(width: number, height: number): {
	gl: WebGLRenderingContext;
	glCanvas: HTMLCanvasElement;
} | null {
	// Check if we need to recreate (size changed or not initialized)
	if (cachedGLCanvas && cachedGL && cachedProgram) {
		if (cachedGLCanvas.width !== width || cachedGLCanvas.height !== height) {
			cachedGLCanvas.width = width;
			cachedGLCanvas.height = height;
		}
		return { gl: cachedGL, glCanvas: cachedGLCanvas };
	}

	// Create new WebGL canvas
	const glCanvas = document.createElement('canvas');
	glCanvas.width = width;
	glCanvas.height = height;

	const gl = glCanvas.getContext('webgl', { premultipliedAlpha: false });
	if (!gl) {
		return null;
	}

	// Vertex shader - simple fullscreen quad
	const vertexShaderSource = `
		attribute vec2 a_position;
		varying vec2 v_pixelCoord;
		uniform vec2 u_resolution;
		void main() {
			gl_Position = vec4(a_position, 0.0, 1.0);
			// Convert from clip space to pixel coordinates
			// Note: flip Y because WebGL Y-up vs Canvas Y-down
			v_pixelCoord = vec2(
				(a_position.x * 0.5 + 0.5) * u_resolution.x,
				(0.5 - a_position.y * 0.5) * u_resolution.y
			);
		}
	`;

	// Fragment shader - applies inverse homography for perspective-correct sampling
	const fragmentShaderSource = `
		precision highp float;
		uniform sampler2D u_texture;
		uniform mat3 u_invHomography;
		varying vec2 v_pixelCoord;

		void main() {
			// Apply inverse homography to get source coordinates
			vec3 srcHomog = u_invHomography * vec3(v_pixelCoord, 1.0);
			vec2 srcCoord = srcHomog.xy / srcHomog.z;

			// Check if within unit square (source texture bounds)
			if (srcCoord.x < 0.0 || srcCoord.x > 1.0 || srcCoord.y < 0.0 || srcCoord.y > 1.0) {
				discard;
			}

			gl_FragColor = texture2D(u_texture, srcCoord);
		}
	`;

	// Compile shaders
	const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
	const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
	if (!vertexShader || !fragmentShader) return null;

	// Create program
	const program = gl.createProgram();
	if (!program) return null;
	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		console.error('Program link error:', gl.getProgramInfoLog(program));
		return null;
	}

	// Fullscreen quad (two triangles)
	const positions = new Float32Array([
		-1, -1, 1, -1, -1, 1,
		-1, 1, 1, -1, 1, 1
	]);

	// Set up position buffer
	const positionBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

	// Create texture
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

	// Cache everything
	cachedGLCanvas = glCanvas;
	cachedGL = gl;
	cachedProgram = program;
	cachedPositionBuffer = positionBuffer;
	cachedTexture = texture;
	cachedPositionLoc = gl.getAttribLocation(program, 'a_position');
	cachedResolutionLoc = gl.getUniformLocation(program, 'u_resolution');
	cachedHomographyLoc = gl.getUniformLocation(program, 'u_invHomography');

	// Delete shaders after linking (program keeps them)
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);

	return { gl, glCanvas };
}

/**
 * Draw a texture onto a destination canvas with perspective transformation
 * Uses homography-based perspective-correct texture mapping
 */
export function drawPerspective(
	destCtx: CanvasRenderingContext2D,
	sourceCanvas: HTMLCanvasElement,
	destQuad: Quad
): void {
	const destCanvas = destCtx.canvas;

	// Get or create cached WebGL resources
	const resources = getOrCreateGLResources(destCanvas.width, destCanvas.height);
	if (!resources) {
		console.error('WebGL not supported, falling back to basic draw');
		fallbackDraw(destCtx, sourceCanvas, destQuad);
		return;
	}

	const { gl, glCanvas } = resources;

	// Use cached program
	gl.useProgram(cachedProgram);

	// Set up position attribute
	gl.bindBuffer(gl.ARRAY_BUFFER, cachedPositionBuffer);
	gl.enableVertexAttribArray(cachedPositionLoc);
	gl.vertexAttribPointer(cachedPositionLoc, 2, gl.FLOAT, false, 0, 0);

	// Compute homography from unit square to destination quad (in pixel coords)
	const H = computeHomography(destQuad);

	// Compute inverse homography (from dest pixels to source UV)
	const Hinv = invertHomography(H, destCanvas.width, destCanvas.height);

	// Set uniforms
	gl.uniform2f(cachedResolutionLoc, destCanvas.width, destCanvas.height);
	gl.uniformMatrix3fv(cachedHomographyLoc, false, new Float32Array(Hinv));

	// Update texture with source canvas
	gl.bindTexture(gl.TEXTURE_2D, cachedTexture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);

	// Clear and draw
	gl.viewport(0, 0, glCanvas.width, glCanvas.height);
	gl.clearColor(0, 0, 0, 0);
	gl.clear(gl.COLOR_BUFFER_BIT);
	gl.drawArrays(gl.TRIANGLES, 0, 6);

	// Copy WebGL result to destination canvas
	destCtx.drawImage(glCanvas, 0, 0);
}

/**
 * Invert the homography and scale to map from pixel coords to unit square
 */
function invertHomography(H: number[], width: number, height: number): number[] {
	// First, compute the inverse of H
	const [a, b, c, d, e, f, g, h, i] = H;

	const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);

	const invH = [
		(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
		(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
		(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det
	];

	// Return as column-major for WebGL uniformMatrix3fv
	return [
		invH[0], invH[3], invH[6],
		invH[1], invH[4], invH[7],
		invH[2], invH[5], invH[8]
	];
}

function compileShader(
	gl: WebGLRenderingContext,
	type: number,
	source: string
): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		console.error('Shader compile error:', gl.getShaderInfoLog(shader));
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

function fallbackDraw(
	ctx: CanvasRenderingContext2D,
	source: HTMLCanvasElement,
	quad: Quad
): void {
	// Simple bounding box fallback
	const minX = Math.min(quad.topLeft.x, quad.topRight.x, quad.bottomRight.x, quad.bottomLeft.x);
	const maxX = Math.max(quad.topLeft.x, quad.topRight.x, quad.bottomRight.x, quad.bottomLeft.x);
	const minY = Math.min(quad.topLeft.y, quad.topRight.y, quad.bottomRight.y, quad.bottomLeft.y);
	const maxY = Math.max(quad.topLeft.y, quad.topRight.y, quad.bottomRight.y, quad.bottomLeft.y);

	ctx.save();
	ctx.beginPath();
	ctx.moveTo(quad.topLeft.x, quad.topLeft.y);
	ctx.lineTo(quad.topRight.x, quad.topRight.y);
	ctx.lineTo(quad.bottomRight.x, quad.bottomRight.y);
	ctx.lineTo(quad.bottomLeft.x, quad.bottomLeft.y);
	ctx.closePath();
	ctx.clip();
	ctx.drawImage(source, minX, minY, maxX - minX, maxY - minY);
	ctx.restore();
}
