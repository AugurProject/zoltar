import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { UniverseIdentity } from '../components/UniverseIdentity.js'
import { keccak256 } from '@zoltar/core-shared/evm/ethereum'
import { createUniverseIdentity } from '../lib/universeIdentity.js'
import { oklchToSrgb } from '../lib/oklch.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

const lifecycle = installDomTestLifecycle()

test('page colors use uniform OKLCH roles with AA contrast for theme text and translucent metadata', async () => {
	const tokens = await Bun.file(new URL('../../css/tokens.css', import.meta.url)).text()
	const textColors = (role: string, dark: boolean) => {
		const match = new RegExp(role + ': light-dark\\(rgba\\(([^)]+)\\), rgba\\(([^)]+)\\)\\)').exec(tokens)
		const values = match?.[dark ? 2 : 1]?.split(',').map(Number)
		if (values === undefined || values.length !== 4) throw new Error('Expected light/dark RGBA text tokens')
		return values
	}
	const luminance = (rgb: readonly number[]) => rgb.reduce((sum, channel, index) => sum + ([0.2126, 0.7152, 0.0722][index] ?? 0) * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4), 0)
	const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
	for (let id = 0; id < 384; id++) {
		const identity = createUniverseIdentity(BigInt(id))
		for (const theme of ['light', 'dark']) {
			// Parse the actual emitted SVG colors, including every gradient stop, rather than duplicated role constants.
			const svg = decodeURIComponent(theme === 'light' ? identity.image.light : identity.image.dark)
			expect(svg).not.toContain('hsl(')
			const colors = [...svg.matchAll(/oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)/g)]
			expect(colors.length).toBeGreaterThan(3)
			for (const [, l, c, h] of colors) {
				const background = oklchToSrgb(Number(l) / 100, Number(c), Number(h))
				expect(background.every(channel => channel >= -0.00001 && channel <= 1.00001)).toBe(true)
				const text = textColors('--text', theme === 'dark')
					.slice(0, 3)
					.map(channel => channel / 255)
				const muted = textColors('--muted', theme === 'dark')
				const alpha = muted[3] ?? 1
				const metadata = muted.slice(0, 3).map((channel, index) => (channel / 255) * alpha + (background[index] ?? 0) * (1 - alpha))
				expect(contrast(luminance(text), luminance(background))).toBeGreaterThanOrEqual(4.5)
				expect(contrast(luminance(metadata), luminance(background))).toBeGreaterThanOrEqual(4.5)
				// The Trading probability labels retain their semantic 75% mix: raw Yes ink can dip below AA on a light fold.
				for (const role of ['--outcome-yes', '--outcome-no']) {
					const outcome = textColors(role, theme === 'dark')
					const label = outcome.slice(0, 3).map((channel, index) => (channel / 255) * 0.75 + (text[index] ?? 0) * 0.25)
					expect(contrast(luminance(label), luminance(background))).toBeGreaterThanOrEqual(4.5)
				}
			}
		}
	}
})

test('page recognition retains at least half of the fold shading in the top content column', () => {
	for (let id = 0; id < 32; id++) {
		const identity = createUniverseIdentity(BigInt(id))
		for (const image of [identity.image.light, identity.image.dark]) {
			const svg = decodeURIComponent(image)
			const maskOpacity = (name: string) => {
				const gradient = new RegExp(`<linearGradient id="${name}"[^>]*>(.*?)</linearGradient>`).exec(svg)?.[1]
				if (gradient === undefined) throw new Error('Expected a content shading mask')
				const stops = [...gradient.matchAll(/stop-color="#([0-9a-f])\1\1"/g)].map(match => Number.parseInt(match[1] ?? '', 16) / 15)
				if (stops.length === 0) throw new Error('Expected neutral mask stops')
				return Math.min(...stops)
			}
			// The masks multiply. Keeping each individually visible is insufficient on cropped mobile artwork.
			expect(maskOpacity('quiet') * maskOpacity('margins')).toBeGreaterThanOrEqual(0.5)
		}
	}
})

test('visual identity is deterministic, full-width, and independent of app and theme', () => {
	const id = (1n << 255n) + 37n
	expect(createUniverseIdentity(id)).toEqual(createUniverseIdentity(id))
	expect(createUniverseIdentity(id)).not.toEqual(createUniverseIdentity(37n))
	expect(createUniverseIdentity(id + 1n)).not.toEqual(createUniverseIdentity(id))
	expect(createUniverseIdentity(0n).image.light).not.toBe(createUniverseIdentity(0n).image.dark)
	expect(() => createUniverseIdentity(-1n)).toThrow('unsigned 256-bit')
	expect(() => createUniverseIdentity(1n << 256n)).toThrow('unsigned 256-bit')
})

test('neighboring IDs produce diverse palettes and geometry instead of a sequential gradient', () => {
	const identities = Array.from({ length: 256 }, (_, index) => createUniverseIdentity(BigInt(index)))
	expect(new Set(identities.map(identity => identity.image.light)).size).toBe(256)
	expect(new Set(identities.map(identity => identity.image.dark)).size).toBe(256)
	expect(new Set(identities.map(identity => identity.traits.hueBucket)).size).toBe(16)
	const images = identities.map(identity => decodeURIComponent(identity.image.light))
	expect(images.every(image => !image.includes('<circle') && !image.includes('<pattern'))).toBe(true)
	expect(new Set(identities.map(identity => identity.traits.composition)).size).toBe(3)
	const orientations = images.map(image => /rotate\((\d+) 800 500\)/.exec(image)?.[1])
	expect(new Set(orientations).size).toBeGreaterThan(150)
	expect(images.every(image => image.includes('linearGradient') && image.includes(' C'))).toBe(true)
	// Variation includes silhouette complexity and colors within a single image, not only rotation.
	const pathCounts = images.map(image => [...image.matchAll(/<path\b/g)].length)
	expect(new Set(pathCounts).size).toBeGreaterThan(5)
	expect(images.every(image => new Set([...image.matchAll(/oklch\([^)]+\)/g)].map(match => match[0])).size > 12)).toBe(true)
	expect(images.every(image => [...image.matchAll(/<filter\b/g)].length === 1 && !image.includes('stroke='))).toBe(true)
	expect(images.every(image => [...image.matchAll(/filter="url\(#soften\)"/g)].length === 1 && !image.includes('<feDropShadow'))).toBe(true)
	expect(images.every(image => image.length < 1_000_000 && !/NaN|Infinity|undefined/.test(image))).toBe(true)
	expect(images.every(image => image.includes('viewBox="0 0 1600 1000"'))).toBe(true)
	expect(images.some(image => /--\d/.test(image))).toBe(false)
})

test('discrete identities are diverse and palette hues avoid both semantic outcome neighborhoods', () => {
	const ids = [...Array.from({ length: 384 }, (_, index) => BigInt(index)), ...Array.from({ length: 384 }, (_, index) => BigInt(keccak256(`identity-test-random:${index}`)))]
	for (const samples of [ids.slice(0, 384), ids.slice(384)]) {
		const counts = new Map<string, number>()
		for (const id of samples) {
			const { traits } = createUniverseIdentity(id)
			for (const hue of [traits.hue, traits.support, traits.third]) {
				// OKLCH hues of current light/dark Yes and No tokens, including their small theme differences.
				for (const outcome of [161.78, 165.62, 12.55, 8.98]) expect(Math.abs(((hue - outcome + 540) % 360) - 180)).toBeGreaterThanOrEqual(25)
			}
			const key = `${traits.hueBucket}:${traits.scheme}:${traits.composition}`
			counts.set(key, (counts.get(key) ?? 0) + 1)
		}
		const collisions = [...counts.values()].reduce((sum, count) => sum + (count * (count - 1)) / 2, 0)
		// Pair collision probability, rather than impossible uniqueness among more IDs than 144 discrete tuples.
		expect(collisions / ((samples.length * (samples.length - 1)) / 2)).toBeLessThan(0.015)
		expect(counts.size).toBeGreaterThan(120)
	}
})

test('OKLCH conversion matches neutral and sRGB red reference colors', () => {
	for (const channel of oklchToSrgb(1, 0, 0)) expect(channel).toBeCloseTo(1, 6)
	for (const channel of oklchToSrgb(0, 0, 0)) expect(channel).toBe(0)
	const red = oklchToSrgb(0.62795536, 0.25768331, 29.233885)
	expect(red[0]).toBeCloseTo(1, 5)
	expect(red[1]).toBeCloseTo(0, 5)
	expect(red[2]).toBeCloseTo(0, 5)
})

test('swatches retain the backdrop geometry, scheme, angle and count in both native themes', () => {
	for (let id = 0; id < 32; id++) {
		const identity = createUniverseIdentity(BigInt(id))
		for (const theme of ['light', 'dark']) {
			const page = decodeURIComponent(theme === 'light' ? identity.image.light : identity.image.dark)
			const swatch = decodeURIComponent(theme === 'light' ? identity.swatchImage.light : identity.swatchImage.dark)
			expect([...page.matchAll(/<path d="([^"]+)"/g)].map(match => match[1])).toEqual([...swatch.matchAll(/<path d="([^"]+)"/g)].map(match => match[1]))
			expect(swatch).toContain(`data-composition="${identity.traits.composition}"`)
			expect(swatch).toContain(`rotate(${identity.traits.angle} 800 500)`)
		}
	}
})

test('recognition surfaces expose native theme images and update on selection without supplying ink', async () => {
	const view = (id: bigint) => (
		<>
			<UniverseIdentity universeId={id} variant='backdrop' />
			<UniverseIdentity universeId={id} variant='swatch' />
		</>
	)
	const rendered = await renderIntoDocument(view(0n))
	lifecycle.trackRendered(rendered)
	const original = rendered.container.querySelector<HTMLElement>('.universe-identity')?.style.getPropertyValue('--universe-image-light')
	await act(() => render(view(1n), rendered.container))
	const surfaces = [...rendered.container.querySelectorAll<HTMLElement>('.universe-identity')]
	expect(surfaces.length).toBe(2)
	for (const surface of surfaces) {
		expect(surface.dataset['universeId']).toBe('1')
		expect(surface.getAttribute('aria-hidden')).toBe('true')
		const identity = createUniverseIdentity(1n)
		const expected = surface.classList.contains('universe-identity-swatch') ? identity.swatchImage : identity.image
		expect(surface.style.getPropertyValue('--universe-image-light')).toBe(expected.light)
		expect(surface.style.getPropertyValue('--universe-image-dark')).toBe(expected.dark)
		expect(surface.style.getPropertyValue('--universe-image-light')).not.toBe(original)
		expect(surface.style.getPropertyValue('--universe-ink')).toBe('')
	}
})
