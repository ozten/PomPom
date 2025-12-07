/**
 * Mask transformation using inverse homography
 *
 * Transforms SAM masks from camera/wall image space to projector output space.
 * Uses WebGL for efficient perspective-correct texture sampling.
 */

import type { Quad, Point } from './projection-config';
import { PROJECTOR_WIDTH, PROJECTOR_HEIGHT, CAMERA_IMAGE_SIZE } from './projection-config';

/**
 * Compute a 3x3 homography matrix that maps source quad to destination quad
 * Uses the DLT (Direct Linear Transform) algorithm
 */
function computeHomographyQuadToQuad(src: Quad, dst: Quad): number[] {
	// Source quad corners
	const sx = [src.topLeft.x, src.topRight.x, src.bottomRight.x, src.bottomLeft.x];
	const sy = [src.topLeft.y, src.topRight.y, src.bottomRight.y, src.bottomLeft.y];

	// Destination quad corners
	const dx = [dst.topLeft.x, dst.topRight.x, dst.bottomRight.x, dst.bottomLeft.x];
	const dy = [dst.topLeft.y, dst.topRight.y, dst.bottomRight.y, dst.bottomLeft.y];

	// Build the 8x8 matrix for DLT
	const A: number[][] = [];
	for (let i = 0; i < 4; i++) {
		A.push([sx[i], sy[i], 1, 0, 0, 0, -dx[i] * sx[i], -dx[i] * sy[i]]);
		A.push([0, 0, 0, sx[i], sy[i], 1, -dy[i] * sx[i], -dy[i] * sy[i]]);
	}

	// Right hand side
	const b = [dx[0], dy[0], dx[1], dy[1], dx[2], dy[2], dx[3], dy[3]];

	// Solve using Gaussian elimination
	const h = solveLinearSystem(A, b);

	// Return 3x3 homography matrix (row-major)
	return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
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
 * Invert a 3x3 homography matrix
 */
function invertHomography(H: number[]): number[] {
	const [a, b, c, d, e, f, g, h, i] = H;

	const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);

	return [
		(e * i - f * h) / det,
		(c * h - b * i) / det,
		(b * f - c * e) / det,
		(f * g - d * i) / det,
		(a * i - c * g) / det,
		(c * d - a * f) / det,
		(d * h - e * g) / det,
		(b * g - a * h) / det,
		(a * e - b * d) / det
	];
}

/**
 * Convert row-major matrix to column-major for WebGL
 */
function toColumnMajor(m: number[]): number[] {
	return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
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

/**
 * Transform a mask from camera space to projector space using WebGL
 *
 * The cameraQuad defines where the projection appears in the camera image.
 * This function warps the mask so that content within cameraQuad maps to
 * the full projector output rectangle.
 *
 * @param maskImage - The SAM mask in camera/wall image coordinates
 * @param cameraQuad - The quad in camera space where projection appears
 * @returns A canvas with the transformed mask at projector resolution
 */
export function transformMaskToProjector(
	maskImage: HTMLImageElement | HTMLCanvasElement,
	cameraQuad: Quad
): HTMLCanvasElement {
	// Create output canvas at projector resolution
	const outputCanvas = document.createElement('canvas');
	outputCanvas.width = PROJECTOR_WIDTH;
	outputCanvas.height = PROJECTOR_HEIGHT;

	const gl = outputCanvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
	if (!gl) {
		console.error('WebGL not supported, using fallback');
		return fallbackTransform(maskImage, cameraQuad);
	}

	// Projector rectangle (destination)
	const projectorRect: Quad = {
		topLeft: { x: 0, y: 0 },
		topRight: { x: PROJECTOR_WIDTH, y: 0 },
		bottomLeft: { x: 0, y: PROJECTOR_HEIGHT },
		bottomRight: { x: PROJECTOR_WIDTH, y: PROJECTOR_HEIGHT }
	};

	// Compute homography: projector coords → camera coords
	// For each projector pixel, we need to know where to sample from the mask
	const H = computeHomographyQuadToQuad(projectorRect, cameraQuad);

	// Normalize by camera image size to get UV coordinates (0-1)
	// We need to scale the camera coordinates to UV space
	const scaleMatrix = [
		1 / CAMERA_IMAGE_SIZE.width,
		0,
		0,
		0,
		1 / CAMERA_IMAGE_SIZE.height,
		0,
		0,
		0,
		1
	];

	// Combine: first apply H (projector→camera), then scale to UV
	// Combined = Scale * H
	const combined = multiplyMatrices(scaleMatrix, H);
	const combinedColMajor = toColumnMajor(combined);

	// Vertex shader
	const vertexShaderSource = `
		attribute vec2 a_position;
		varying vec2 v_pixelCoord;
		uniform vec2 u_resolution;
		void main() {
			gl_Position = vec4(a_position, 0.0, 1.0);
			// Convert from clip space to pixel coordinates
			v_pixelCoord = vec2(
				(a_position.x * 0.5 + 0.5) * u_resolution.x,
				(0.5 - a_position.y * 0.5) * u_resolution.y
			);
		}
	`;

	// Fragment shader - applies homography to sample from mask
	// SAM masks are RGB (white=mask, black=background), so we convert to alpha
	const fragmentShaderSource = `
		precision highp float;
		uniform sampler2D u_texture;
		uniform mat3 u_homography;
		varying vec2 v_pixelCoord;

		void main() {
			// Apply homography to get UV coordinates in mask texture
			vec3 uvHomog = u_homography * vec3(v_pixelCoord, 1.0);
			vec2 uv = uvHomog.xy / uvHomog.z;

			// Check if within texture bounds
			if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
				gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
				return;
			}

			vec4 maskColor = texture2D(u_texture, uv);
			// SAM returns masked regions with original pixels + alpha channel
			// Convert to binary B&W mask: if pixel has any alpha, make it fully white
			// This gives us a clean signal to drive animations
			float alpha = maskColor.a;
			// Threshold: any alpha > 0.1 becomes fully opaque white
			if (alpha > 0.1) {
				gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
			} else {
				gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
			}
		}
	`;

	// Compile shaders
	const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
	const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
	if (!vertexShader || !fragmentShader) {
		return fallbackTransform(maskImage, cameraQuad);
	}

	// Create program
	const program = gl.createProgram();
	if (!program) {
		return fallbackTransform(maskImage, cameraQuad);
	}
	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		console.error('Program link error:', gl.getProgramInfoLog(program));
		return fallbackTransform(maskImage, cameraQuad);
	}

	gl.useProgram(program);

	// Fullscreen quad
	const positions = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

	const positionBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
	const positionLoc = gl.getAttribLocation(program, 'a_position');
	gl.enableVertexAttribArray(positionLoc);
	gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

	// Set uniforms
	const resolutionLoc = gl.getUniformLocation(program, 'u_resolution');
	gl.uniform2f(resolutionLoc, PROJECTOR_WIDTH, PROJECTOR_HEIGHT);

	const homographyLoc = gl.getUniformLocation(program, 'u_homography');
	gl.uniformMatrix3fv(homographyLoc, false, new Float32Array(combinedColMajor));

	// Create texture from mask image
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskImage);

	// Enable blending for transparency
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

	// Clear and draw
	gl.viewport(0, 0, PROJECTOR_WIDTH, PROJECTOR_HEIGHT);
	gl.clearColor(0, 0, 0, 0);
	gl.clear(gl.COLOR_BUFFER_BIT);
	gl.drawArrays(gl.TRIANGLES, 0, 6);

	// Cleanup
	gl.deleteTexture(texture);
	gl.deleteBuffer(positionBuffer);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);
	gl.deleteProgram(program);

	return outputCanvas;
}

/**
 * Multiply two 3x3 matrices (row-major)
 */
function multiplyMatrices(a: number[], b: number[]): number[] {
	return [
		a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
		a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
		a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
		a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
		a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
		a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
		a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
		a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
		a[6] * b[2] + a[7] * b[5] + a[8] * b[8]
	];
}

/**
 * Canvas 2D fallback when WebGL is unavailable
 */
function fallbackTransform(
	maskImage: HTMLImageElement | HTMLCanvasElement,
	cameraQuad: Quad
): HTMLCanvasElement {
	const outputCanvas = document.createElement('canvas');
	outputCanvas.width = PROJECTOR_WIDTH;
	outputCanvas.height = PROJECTOR_HEIGHT;
	const ctx = outputCanvas.getContext('2d')!;

	// Simple bounding box crop and stretch (not perspective-correct)
	const minX = Math.min(
		cameraQuad.topLeft.x,
		cameraQuad.topRight.x,
		cameraQuad.bottomRight.x,
		cameraQuad.bottomLeft.x
	);
	const maxX = Math.max(
		cameraQuad.topLeft.x,
		cameraQuad.topRight.x,
		cameraQuad.bottomRight.x,
		cameraQuad.bottomLeft.x
	);
	const minY = Math.min(
		cameraQuad.topLeft.y,
		cameraQuad.topRight.y,
		cameraQuad.bottomRight.y,
		cameraQuad.bottomLeft.y
	);
	const maxY = Math.max(
		cameraQuad.topLeft.y,
		cameraQuad.topRight.y,
		cameraQuad.bottomRight.y,
		cameraQuad.bottomLeft.y
	);

	ctx.drawImage(
		maskImage,
		minX,
		minY,
		maxX - minX,
		maxY - minY,
		0,
		0,
		PROJECTOR_WIDTH,
		PROJECTOR_HEIGHT
	);

	return outputCanvas;
}

/**
 * Transform multiple masks at once (for batch processing)
 */
export function transformMasksToProjector(
	maskImages: HTMLImageElement[],
	cameraQuad: Quad
): HTMLCanvasElement[] {
	return maskImages.map((img) => transformMaskToProjector(img, cameraQuad));
}
