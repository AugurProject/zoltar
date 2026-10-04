import { hexToBytes, keccak256 } from '@zoltar/core-shared/evm/ethereum'
import { oklchToSrgb } from './oklch.js'

// Continuous travel through safe hue arcs skips the semantic Yes (~163°) and No (~12°) neighborhoods.
const safeHue = (position: number) => {
	const travel = (((position % 1) + 1) % 1) * 237
	return travel <= 93 ? 42 + travel : 195 + travel - 93
}

/** One whole-ID hash supplies sixteen-bit palette and geometry parameters; there are no style buckets. */
export function createUniverseIdentity(universeId: bigint) {
	if (universeId < 0n || universeId >= 1n << 256n) throw new Error('Universe ID must be an unsigned 256-bit integer')
	const seed = hexToBytes(keccak256(`universe-relief-v10:${universeId}`))
	const byte = (index: number) => seed[index] ?? 0
	const value = (index: number) => (byte(index * 2) * 256 + byte(index * 2 + 1)) / 65535
	const paletteStart = value(0)
	const paletteSpread = 0.24 + value(1) * 0.48
	const hue = safeHue(paletteStart)
	const support = safeHue(paletteStart + paletteSpread / 2)
	const third = safeHue(paletteStart + paletteSpread)
	const winding = value(14)
	const crossing = value(15) ** 2 * 0.65
	const angle = Math.round(value(3) * 359)
	const count = 6 + (byte(3) % 6)
	const amplitude = 90 + value(4) * 210
	const spacing = 155 + value(5) * 110
	const focus = -500 + value(6) * 1000
	const spread = 350 + value(7) * 650
	const bend = (value(8) - 0.5) * 0.8
	const curlX = 350 + value(9) * 900
	const curlY = 250 + value(10) * 500
	const curl = (value(11) - 0.5) * 2.4
	const roundness = 0.75 + value(12) * 0.25
	const detail = value(13) * 0.2
	const widthRatio = 0.3 + value(12) * 0.5
	const sweep = (value(11) - 0.5) * 7
	const noise = createNoise([28, 29, 30, 31].reduce((result, index) => result * 256 + byte(index), 0))
	const relief = (t: number, lane: number) => {
		const warp = noise(t / 850, lane / 900) * 200
		const field = [1800, 900, 450, 225].reduce((sum, scale, octave) => sum + noise((t + warp) / scale + octave * 13, lane / scale) * amplitude * (octave < 2 ? 1 / (octave + 1) : detail / octave), 0)
		return field + Math.exp(-(((t - focus) / spread) ** 2)) * amplitude * Math.sin(lane / 500) + t * bend
	}
	const edges = Array.from({ length: count }, (_, index) => {
		const lane = (index - count / 2) * spacing
		// Matching ribbon boundaries let straight flow and radial winding interpolate without a topology switch.
		const contour = (side: number) =>
			Array.from({ length: 49 }, (_, step) => {
				const u = step / 48
				const t = -1900 + u * 3800
				const offset = (side * spacing * widthRatio) / 2
				const x = 800 + t
				const y = 500 + lane + offset + relief(t, lane + offset)
				const dx = x - curlX
				const dy = y - curlY
				const rotation = curl * Math.exp(-(dx * dx + dy * dy) / 500000)
				const flowX = curlX + dx * Math.cos(rotation) - dy * Math.sin(rotation)
				const flowY = curlY + dx * Math.sin(rotation) + dy * Math.cos(rotation)
				const radius = 35 + u * 2200 + noise(u * 3, index) * amplitude * u
				const radians = ((index + 0.5) / count) * Math.PI * 2 + u * sweep + (side * widthRatio * Math.PI) / count
				const radialX = curlX + Math.cos(radians) * radius
				const radialY = curlY + Math.sin(radians) * radius
				return { x: Math.round(flowX + (radialX - flowX) * winding), y: Math.round(flowY + (radialY - flowY) * winding) }
			})
		return `${curve(contour(-1), 'M', roundness)} ${curve(contour(1).reverse(), 'L', roundness)} Z`
	})
	const renderImage = (dark: boolean, miniature: boolean) => {
		const palette = dark ? { ground: 17, fold: 24, miniature: 32, miniatureGround: 27, foldChroma: 0.075, foldRange: 2.5 } : { ground: 94, fold: 88, miniature: 84, miniatureGround: 93, foldChroma: 0.055, foldRange: 3 }
		const groundL = miniature ? palette.miniatureGround : palette.ground
		const baseL = miniature ? palette.miniature : palette.fold
		const rangeL = miniature ? 8 : palette.foldRange
		const chroma = miniature ? 0.065 : palette.foldChroma
		let width = 1600
		let height = 1000
		let viewBox = '0 0 1600 1000'
		if (miniature) {
			width = 96
			height = 96
			viewBox = '0 -300 1600 1600'
		}
		const gradients = edges
			.map((_, index) => {
				const h = safeHue(paletteStart + (index / (count - 1)) * paletteSpread)
				const l = baseL + (index / count) * rangeL
				const lane = (index - count / 2) * spacing
				const anchor = 500 + lane + relief(0, lane)
				// The near-vertical lighting axis rotates with the later group rotate, following the fold orientation.
				return `<linearGradient id="fold${index}" gradientUnits="userSpaceOnUse" x1="800" y1="${Math.round(anchor)}" x2="820" y2="${Math.round(anchor + spacing)}"><stop stop-color="${color(h, l, chroma)}"/><stop offset=".4" stop-color="${color(h, l + (miniature ? 3 : 1.5), chroma)}"/><stop offset="1" stop-color="${color(h, l - (miniature ? 2 : 1), chroma)}"/></linearGradient>`
			})
			.join('')
		const paths = edges.map((d, index) => `<path d="${d}" fill="url(#fold${index})"/>`).join('')
		const crossFlow = `<g opacity="${crossing.toFixed(5)}" transform="rotate(${35 + value(13) * 110} ${curlX.toFixed(2)} ${curlY.toFixed(2)})">${paths}</g>`
		// Keep a visible silhouette from the first screen, with gentler shading in the content column.
		// A nonzero center also preserves recognition when portrait viewports crop the artwork.
		const quiet = miniature
			? ''
			: '<linearGradient id="quiet" x2="0" y2="1"><stop stop-color="#ddd"/><stop offset=".45" stop-color="#ddd"/><stop offset=".7" stop-color="#ddd"/><stop offset="1" stop-color="#fff"/></linearGradient><linearGradient id="margins"><stop stop-color="#fff"/><stop offset=".12" stop-color="#aaa"/><stop offset=".25" stop-color="#aaa"/><stop offset=".75" stop-color="#aaa"/><stop offset=".88" stop-color="#aaa"/><stop offset="1" stop-color="#fff"/></linearGradient><mask id="space"><rect width="1600" height="1000" fill="url(#quiet)"/></mask><mask id="column"><rect width="1600" height="1000" fill="url(#margins)"/></mask>'
		// One bounded filter softens the entire composition; never allocate a full-viewport filter per fold.
		const softness = miniature ? '' : '<filter id="soften" filterUnits="userSpaceOnUse" x="-72" y="-72" width="1744" height="1144" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="12"/></filter>'
		const art = `<g transform="rotate(${angle} 800 500)">${paths}${crossFlow}</g>`
		const composed = miniature ? art : `<g mask="url(#space)"><g mask="url(#column)"><g filter="url(#soften)">${art}</g></g></g>`
		return encodeSvg(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid slice" data-winding="${winding.toFixed(5)}" data-crossing="${crossing.toFixed(5)}"><defs>${gradients}${quiet}${softness}</defs><rect x="-2000" y="-2000" width="6000" height="6000" fill="${color(hue, groundL, miniature ? 0.04 : 0.035)}"/>${composed}</svg>`,
		)
	}
	const variants = (miniature: boolean) => ({ light: renderImage(false, miniature), dark: renderImage(true, miniature) })
	return {
		image: variants(false),
		swatchImage: variants(true),
		traits: { hue, support, third, paletteSpread, winding, crossing, widthRatio, sweep, angle, count },
	}
}

/** Role lightness is fixed across hues; reduce only chroma when needed to stay inside sRGB. */
function color(hue: number, lightness: number, chroma: number) {
	const l = Number(lightness.toFixed(2))
	const h = Number(hue.toFixed(2))
	let c = Number(chroma.toFixed(5))
	// Test the rounded values actually emitted into SVG, not the unrounded parameters.
	while (oklchToSrgb(l / 100, c, h).some(channel => channel < 0 || channel > 1)) c = Number((c * 0.9).toFixed(5))
	return `oklch(${l.toFixed(2)}% ${c.toFixed(5)} ${h.toFixed(2)})`
}

function encodeSvg(svg: string) {
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

type Point = { x: number; y: number }

function curve(points: readonly Point[], move: 'M' | 'L' = 'M', tension = 1) {
	const first = points[0]
	if (first === undefined) throw new Error('A flow contour needs a starting point')
	let path = `${move}${first.x} ${first.y}`
	for (let index = 1; index < points.length; index++) {
		const point = points[index]
		const previous = points[index - 1]
		if (point === undefined || previous === undefined) throw new Error('A flow contour is incomplete')
		const before = points[index - 2] ?? previous
		const after = points[index + 1] ?? point
		const c1 = { x: previous.x + ((point.x - before.x) * tension) / 6, y: previous.y + ((point.y - before.y) * tension) / 6 }
		const c2 = { x: point.x - ((after.x - previous.x) * tension) / 6, y: point.y - ((after.y - previous.y) * tension) / 6 }
		path += ` C${Math.round(c1.x)} ${Math.round(c1.y)} ${Math.round(c2.x)} ${Math.round(c2.y)} ${point.x} ${point.y}`
	}
	return path
}

/** Seeded value noise with smooth lattice interpolation; octave blending builds the fractal field. */
function createNoise(seed: number) {
	const lattice = (x: number, y: number) => {
		let n = Math.imul(x, 0x45d9f3b) ^ Math.imul(y, 0x27d4eb2d) ^ seed
		n = Math.imul(n ^ (n >>> 16), 0x45d9f3b)
		n = Math.imul(n ^ (n >>> 16), 0x45d9f3b)
		return (((n ^ (n >>> 16)) >>> 0) / 0xffffffff) * 2 - 1
	}
	const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
	const mix = (a: number, b: number, t: number) => a + (b - a) * t
	return (x: number, y: number) => {
		const ix = Math.floor(x)
		const iy = Math.floor(y)
		const u = smooth(x - ix)
		const v = smooth(y - iy)
		return mix(mix(lattice(ix, iy), lattice(ix + 1, iy), u), mix(lattice(ix, iy + 1), lattice(ix + 1, iy + 1), u), v)
	}
}
