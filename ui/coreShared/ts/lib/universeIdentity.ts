import { hexToBytes, keccak256 } from '@zoltar/core-shared/evm/ethereum'

/** A shared palette and flow field, composed separately for page, band, and swatch. */
export function createUniverseIdentity(universeId: bigint) {
	if (universeId < 0n || universeId >= 1n << 256n) throw new Error('Universe ID must be an unsigned 256-bit integer')
	const seed = Array.from({ length: 4 }, (_, block) => [...hexToBytes(keccak256(`universe-relief-v8:${universeId}:${block}`))]).flat()
	const value = (index: number) => (seed[index % seed.length] ?? 0) / 255
	const hue = Math.round(value(0) * 359)
	const support = hue + (value(1) < 0.5 ? -1 : 1) * (20 + value(2) * 25)
	const accent = hue + 90 + value(3) * 50
	const saturation = 38 + value(4) * 20
	const color = (h: number, lightness: number) => `hsl(${Math.round((h + 360) % 360)} ${Math.round(saturation)}% ${Math.round(lightness)}%)`
	const noise = createNoise(seed.slice(16, 20).reduce((result, byte) => result * 256 + byte, 0))
	const angle = Math.round(value(5) * 360)
	const count = 8 + Math.round(value(6) * 6)
	const spacing = 145 + value(7) * 75
	const amplitude = 90 + value(8) * 230
	const focus = -500 + value(9) * 1000
	const spread = 350 + value(10) * 650
	const bend = (value(11) - 0.5) * 1.5
	const curl = (value(12) - 0.5) * 3.2
	const curlX = 150 + value(13) * 1300
	const curlY = 150 + value(14) * 700
	const curlRadius = 350 + value(15) * 400
	const detail = value(20) * 0.22
	const roundness = 0.65 + value(21) * 0.35
	const relief = (t: number, lane: number) => {
		const warp = noise(t / 850, lane / 900) * 200
		const field = [1800, 900, 450, 225].reduce((sum, scale, octave) => sum + noise((t + warp) / scale + octave * 13, lane / scale) * amplitude * (octave < 2 ? 1 / (octave + 1) : detail / octave), 0)
		return field + Math.exp(-(((t - focus) / spread) ** 2)) * amplitude * Math.sin(lane / 500 + value(22) * 6) + t * bend
	}
	const transform = (point: Point): Point => {
		const dx = point.x - curlX
		const dy = point.y - curlY
		const rotation = curl * Math.exp(-(dx * dx + dy * dy) / (curlRadius * curlRadius))
		return { x: Math.round(curlX + dx * Math.cos(rotation) - dy * Math.sin(rotation)), y: Math.round(curlY + dx * Math.sin(rotation) + dy * Math.cos(rotation)) }
	}
	const gradients: string[] = []
	const layers = Array.from({ length: count }, (_, index) => {
		const lane = (index - count / 2) * spacing
		const edge = Array.from({ length: 49 }, (_, step) => {
			const t = -1700 + step * (3400 / 48)
			return transform({ x: 800 + t, y: 500 + lane + relief(t, lane) })
		})
		const h = hue + (support - hue) * (index / count)
		const lightness = 64 + (index / count) * 15
		const anchor = 500 + lane + relief(0, lane)
		gradients.push(
			`<linearGradient id="fold${index}" gradientUnits="userSpaceOnUse" x1="800" y1="${Math.round(anchor)}" x2="820" y2="${Math.round(anchor + spacing * 1.1)}"><stop stop-color="${color(h, lightness)}"/><stop offset=".18" stop-color="${color(h, lightness + 20)}"/><stop offset=".7" stop-color="${color(h, lightness + 6)}"/><stop offset="1" stop-color="${color(h, lightness - 12)}"/></linearGradient>`,
		)
		return `<path d="${curve(edge, 'M', roundness)} L3000 3000 L-1500 3000 Z" fill="url(#fold${index})" filter="url(#depth)"/><path d="${curve(edge, 'M', roundness)}" fill="none" stroke="${color(h, 95)}" stroke-opacity=".55" stroke-width="2"/>`
	}).join('')
	const accentLane = (Math.round(value(23) * (count - 2)) - count / 2) * spacing
	const accentEdge = Array.from({ length: 49 }, (_, step) => {
		const t = -1700 + step * (3400 / 48)
		return transform({ x: 800 + t, y: 500 + accentLane + relief(t, accentLane) + 10 })
	})
	const image = encodeSvg(
		`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><defs>${gradients.join('')}<filter id="depth" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="${color(hue, 25)}" flood-opacity=".24"/></filter><radialGradient id="quiet"><stop stop-color="#aaa"/><stop offset=".4" stop-color="#bbb"/><stop offset="1" stop-color="#fff"/></radialGradient><mask id="space"><rect width="1600" height="1000" fill="url(#quiet)"/></mask></defs><rect width="1600" height="1000" fill="${color(hue, 93)}"/><g mask="url(#space)"><g transform="rotate(${angle} 800 500)">${layers}<path d="${curve(accentEdge)}" fill="none" stroke="${color(accent, 67)}" stroke-width="7" stroke-opacity=".55"/></g></g></svg>`,
	)
	// A few broad folds fit the band; their proportions are never squeezed from the page image.
	const bandPaths = Array.from({ length: 3 }, (_, index) => {
		const edge = Array.from({ length: 25 }, (_, step) => {
			const x = step * (1800 / 24) - 100
			const y = 14 + index * 28 + noise(x / (500 + value(24) * 700), index * 0.4) * 18 + Math.exp(-(((x - 250 - value(25) * 1100) / 350) ** 2)) * Math.sin(index * 1.3 + value(26) * 6) * 65 + (x - 800) * (value(28) - 0.5) * 0.06
			return { x, y: Math.round(y) }
		})
		return `<path d="${curve(edge)} L1800 150 L-100 150 Z" fill="${color(index === 2 ? support : hue, 62 + index * 9)}"/><path d="${curve(edge)}" fill="none" stroke="${color(hue, 94)}" stroke-opacity=".65" stroke-width="1.5"/>`
	}).join('')
	const bandImage = encodeSvg(
		`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="80" viewBox="0 0 1600 80"><defs><linearGradient id="light" x2="0" y2="1"><stop stop-color="${color(hue, 95)}" stop-opacity=".6"/><stop offset=".5" stop-color="${color(hue, 95)}" stop-opacity="0"/><stop offset="1" stop-color="${color(hue, 25)}" stop-opacity=".12"/></linearGradient></defs><rect width="1600" height="80" fill="${color(hue, 88)}"/>${bandPaths}<rect width="1600" height="80" fill="url(#light)"/><path d="M0 70 Q800 ${35 + Math.round(value(26) * 35)} 1600 70" fill="none" stroke="${color(accent, 63)}" stroke-width="3"/></svg>`,
	)
	const swatchImage = encodeSvg(
		`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><defs><linearGradient id="face" x2=".3" y2="1"><stop stop-color="${color(hue, 85)}"/><stop offset="1" stop-color="${color(hue, 61)}"/></linearGradient></defs><rect width="96" height="96" fill="${color(support, 85)}"/><path d="M-10 18 Q${Math.round(value(27) * 80)} 90 106 40 L106 106 L-10 106Z" fill="url(#face)"/><path d="M-10 18 Q${Math.round(value(27) * 80)} 90 106 40" fill="none" stroke="${color(hue, 96)}" stroke-width="3"/><path d="M-10 30 Q${Math.round(value(27) * 80)} 102 106 52" fill="none" stroke="${color(accent, 60)}" stroke-width="5"/></svg>`,
	)
	return { image, bandImage, swatchImage, ink: `light-dark(hsl(${hue} 48% 32%), hsl(${hue} 48% 72%))` }
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
