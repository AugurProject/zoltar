import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { UniverseIdentity } from '../components/UniverseIdentity.js'
import { createUniverseIdentity } from '../lib/universeIdentity.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

const lifecycle = installDomTestLifecycle()

test('visual identity is deterministic, full-width, and independent of app and theme', () => {
	const id = (1n << 255n) + 37n
	expect(createUniverseIdentity(id)).toEqual(createUniverseIdentity(id))
	expect(createUniverseIdentity(id)).not.toEqual(createUniverseIdentity(37n))
	expect(createUniverseIdentity(id + 1n)).not.toEqual(createUniverseIdentity(id))
	expect(createUniverseIdentity(0n).ink).toMatch(/^light-dark\(hsl\(.+\), hsl\(.+\)\)$/)
	expect(() => createUniverseIdentity(-1n)).toThrow('unsigned 256-bit')
	expect(() => createUniverseIdentity(1n << 256n)).toThrow('unsigned 256-bit')
})

test('neighboring IDs produce diverse palettes and geometry instead of a sequential gradient', () => {
	const identities = Array.from({ length: 256 }, (_, index) => createUniverseIdentity(BigInt(index)))
	expect(new Set(identities.map(identity => identity.image)).size).toBe(256)
	expect(new Set(identities.map(identity => identity.ink)).size).toBeGreaterThan(150)
	const images = identities.map(identity => decodeURIComponent(identity.image))
	expect(images.every(image => !image.includes('<circle') && !image.includes('<pattern'))).toBe(true)
	expect(images.every(image => !image.includes('data-composition'))).toBe(true)
	const orientations = images.map(image => /rotate\((\d+) 800 500\)/.exec(image)?.[1])
	expect(new Set(orientations).size).toBeGreaterThan(150)
	expect(images.every(image => image.includes('linearGradient') && image.includes(' C'))).toBe(true)
	// Variation includes silhouette complexity and colors within a single image, not only rotation.
	const pathCounts = images.map(image => [...image.matchAll(/<path\b/g)].length)
	expect(new Set(pathCounts).size).toBeGreaterThan(5)
	expect(images.every(image => new Set([...image.matchAll(/hsl\([^)]+\)/g)].map(match => match[0])).size > 12)).toBe(true)
	expect(images.every(image => image.length < 1_000_000 && !/NaN|Infinity|undefined/.test(image))).toBe(true)
	expect(images.every(image => image.includes('viewBox="0 0 1600 1000"'))).toBe(true)
	expect(images.some(image => /--\d/.test(image))).toBe(false)
})

test('recognition surfaces share the palette, use their own compositions, and update on selection', async () => {
	const view = (id: bigint) => (
		<>
			<UniverseIdentity universeId={id} variant='band' />
			<UniverseIdentity universeId={id} variant='backdrop' />
			<UniverseIdentity universeId={id} variant='swatch' />
		</>
	)
	const rendered = await renderIntoDocument(view(0n))
	lifecycle.trackRendered(rendered)
	expect(new Set([...rendered.container.querySelectorAll<HTMLElement>('.universe-identity')].map(surface => surface.style.getPropertyValue('--universe-image'))).size).toBe(3)
	const originalImage = rendered.container.querySelector<HTMLElement>('.universe-identity')?.style.getPropertyValue('--universe-image')
	await act(() => render(view(1n), rendered.container))
	const surfaces = [...rendered.container.querySelectorAll<HTMLElement>('.universe-identity')]
	expect(surfaces.length).toBe(3)
	for (const surface of surfaces) {
		expect(surface.dataset['universeId']).toBe('1')
		expect(surface.getAttribute('aria-hidden')).toBe('true')
		expect(surface.style.getPropertyValue('--universe-image')).not.toBe(originalImage)
		const identity = createUniverseIdentity(1n)
		const expected = [
			{ variant: 'band', image: identity.bandImage },
			{ variant: 'swatch', image: identity.swatchImage },
			{ variant: 'backdrop', image: identity.image },
		].find(entry => surface.classList.contains(`universe-identity-${entry.variant}`))?.image
		expect(surface.style.getPropertyValue('--universe-image')).toBe(expected)
		expect(surface.style.getPropertyValue('--universe-ink')).toBe(identity.ink)
	}
})
