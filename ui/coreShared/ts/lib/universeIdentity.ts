import { hexToBytes, keccak256 } from '@zoltar/core-shared/evm/ethereum'
import { oklchToSrgb } from './oklch.js'

// Curated OKLCH hues avoid the semantic Yes (~163°) and No (~12°) hue neighborhoods.
const hues = [55, 70, 85, 100, 115, 130, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330]
const schemes = ['analogous', 'split-complementary', 'two-tone']
const compositions = ['parallel', 'swirl', 'crossing']

/** One whole-ID hash supplies discrete identity choices and sixteen-bit geometry parameters. */
export function createUniverseIdentity(universeId: bigint) {
	if (universeId < 0n || universeId >= 1n << 256n) throw new Error('Universe ID must be an unsigned 256-bit integer')
	const seed = hexToBytes(keccak256(`universe-relief-v9:${universeId}`))
	const byte = (index: number) => seed[index] ?? 0
	const value = (index: number) => (byte(index * 2) * 256 + byte(index * 2 + 1)) / 65535
	const hueBucket = byte(0) % hues.length
	const schemeIndex = byte(1) % schemes.length
	const compositionIndex = byte(2) % compositions.length
	const scheme = schemes[schemeIndex]
	const composition = compositions[compositionIndex]
	if (scheme === undefined || composition === undefined) throw new Error('Universe identity choices must be configured')
	const hue = (hues[hueBucket] ?? 55) + (value(2) - 0.5) * 4
	const distance = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
	const nearestHue = (target: number) => hues.reduce((closest, candidate) => (distance(candidate, target) < distance(closest, target) ? candidate : closest), hues[0] ?? 55)
	const support = nearestHue(hue + ([25, 150, 180][schemeIndex] ?? 25))
	const third = schemeIndex === 1 ? nearestHue(hue + 210) : support
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
	const noise = createNoise([28, 29, 30, 31].reduce((result, index) => result * 256 + byte(index), 0))
	const relief = (t: number, lane: number) => {
		const warp = noise(t / 850, lane / 900) * 200
		const field = [1800, 900, 450, 225].reduce((sum, scale, octave) => sum + noise((t + warp) / scale + octave * 13, lane / scale) * amplitude * (octave < 2 ? 1 / (octave + 1) : detail / octave), 0)
		return field + Math.exp(-(((t - focus) / spread) ** 2)) * amplitude * Math.sin(lane / 500) + t * bend
	}
	const edges = Array.from({ length: count }, (_, index) => {
		if (compositionIndex === 1) {
			// Spiral ribbons radiate from the seeded curl point; their centers and sweep are part of the identity.
			const spiral = (side: number) =>
				Array.from({ length: 33 }, (_, step) => {
					const t = step / 32
					const radius = 35 + t * 1900
					const radians = (index / count) * Math.PI * 2 + t * (1.6 + value(11) * 1.5) + side * (0.12 + value(5) * 0.13)
					return { x: Math.round(curlX + Math.cos(radians) * radius), y: Math.round(curlY + Math.sin(radians) * radius) }
				})
			return `${curve(spiral(-1), 'M', roundness)} ${curve(spiral(1).reverse(), 'L', roundness)} Z`
		}
		const lane = (index - count / 2) * spacing
		const points = Array.from({ length: 49 }, (_, step) => {
			const t = -1900 + step * (3800 / 48)
			const x = 800 + t
			const y = 500 + lane + relief(t, lane)
			const dx = x - curlX
			const dy = y - curlY
			const rotation = curl * Math.exp(-(dx * dx + dy * dy) / 500000)
			return { x: Math.round(curlX + dx * Math.cos(rotation) - dy * Math.sin(rotation)), y: Math.round(curlY + dx * Math.sin(rotation) + dy * Math.cos(rotation)) }
		})
		return `${curve(points, 'M', roundness)} L3500 3500 L-2000 3500 Z`
	})
	const renderImage = (dark: boolean, miniature: boolean, band: boolean) => {
		const palette = dark ? { ground: 17, fold: 24, miniature: 32, miniatureGround: 27, foldChroma: 0.075, foldRange: 2.5 } : { ground: 94, fold: 88, miniature: 84, miniatureGround: 93, foldChroma: 0.055, foldRange: 3 }
		const groundL = miniature ? palette.miniatureGround : palette.ground
		const baseL = miniature ? palette.miniature : palette.fold
		const rangeL = miniature ? 8 : palette.foldRange
		const chroma = miniature ? 0.065 : palette.foldChroma
		let width = 1600
		let height = 1000
		let viewBox = '0 0 1600 1000'
		if (band) {
			height = 80
			viewBox = '0 460 1600 80'
		} else if (miniature) {
			width = 96
			height = 96
			viewBox = '0 -300 1600 1600'
		}
		const gradients = edges
			.map((_, index) => {
				let h = hue
				if (index % 3 === 0) h = third
				else if (index % 2 !== 0) h = support
				const l = baseL + (index / count) * rangeL
				const lane = (index - count / 2) * spacing
				const anchor = 500 + lane + relief(0, lane)
				// The near-vertical lighting axis rotates with the later group rotate, following the fold orientation.
				return `<linearGradient id="fold${index}" gradientUnits="userSpaceOnUse" x1="800" y1="${Math.round(anchor)}" x2="820" y2="${Math.round(anchor + spacing)}"><stop stop-color="${color(h, l, chroma)}"/><stop offset=".4" stop-color="${color(h, l + (miniature ? 3 : 1.5), chroma)}"/><stop offset="1" stop-color="${color(h, l - (miniature ? 2 : 1), chroma)}"/></linearGradient>`
			})
			.join('')
		const paths = edges.map((d, index) => `<path d="${d}" fill="url(#fold${index})"/>`).join('')
		const crossing = compositionIndex === 2 ? `<g opacity=".5" transform="rotate(${55 + value(12) * 35} 800 500)">${paths}</g>` : ''
		// Keep a visible silhouette from the first screen, with gentler shading in the content column.
		// A nonzero center also preserves recognition when portrait viewports crop the artwork.
		const quiet =
			miniature || band
				? ''
				: '<linearGradient id="quiet" x2="0" y2="1"><stop stop-color="#ddd"/><stop offset=".45" stop-color="#ddd"/><stop offset=".7" stop-color="#ddd"/><stop offset="1" stop-color="#fff"/></linearGradient><linearGradient id="margins"><stop stop-color="#fff"/><stop offset=".12" stop-color="#aaa"/><stop offset=".25" stop-color="#aaa"/><stop offset=".75" stop-color="#aaa"/><stop offset=".88" stop-color="#aaa"/><stop offset="1" stop-color="#fff"/></linearGradient><mask id="space"><rect width="1600" height="1000" fill="url(#quiet)"/></mask><mask id="column"><rect width="1600" height="1000" fill="url(#margins)"/></mask>'
		// One bounded filter softens the entire composition; never allocate a full-viewport filter per fold.
		const softness = miniature || band ? '' : '<filter id="soften" filterUnits="userSpaceOnUse" x="-72" y="-72" width="1744" height="1144" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="12"/></filter>'
		const art = `<g transform="rotate(${angle} 800 500)">${paths}${crossing}</g>`
		const composed = miniature || band ? art : `<g mask="url(#space)"><g mask="url(#column)"><g filter="url(#soften)">${art}</g></g></g>`
		return encodeSvg(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid slice" data-composition="${composition}"><defs>${gradients}${quiet}${softness}</defs><rect x="-2000" y="-2000" width="6000" height="6000" fill="${color(hue, groundL, miniature ? 0.04 : 0.035)}"/>${composed}</svg>`,
		)
	}
	const variants = (miniature: boolean, band: boolean) => ({ light: renderImage(false, miniature, band), dark: renderImage(true, miniature, band) })
	return {
		image: variants(false, false),
		bandImage: variants(true, true),
		swatchImage: variants(true, false),
		traits: { hueBucket, hue, support, third, scheme, composition, angle, count },
	}
}

/** Role lightness is fixed across hues; reduce only chroma when needed to stay inside sRGB. */
function color(hue: number, lightness: number, chroma: number) {
	let c = chroma
	while (oklchToSrgb(lightness / 100, c, hue).some(channel => channel < 0 || channel > 1)) c *= 0.9
	return `oklch(${lightness.toFixed(2)}% ${c.toFixed(5)} ${hue.toFixed(2)})`
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
