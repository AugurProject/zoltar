/// <reference types="bun-types" />

import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { UniversePoolDirectorySection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/UniversePoolDirectorySection.js'
import { describe, expect, test } from 'bun:test'
import { h } from 'preact'
import { createForkedUniverseSummary } from '@zoltar/ui-core-shared/tests/testUtils/universeFixtures.js'

installTestRouting()
describe('UniversePoolDirectorySection', () => {
	test('renders universe details without loading a global pool or vault directory', async () => {
		const rendered = await renderIntoDocument(h(UniversePoolDirectorySection, { activeUniverseId: 1n, zoltarUniverse: createForkedUniverseSummary() }))
		try {
			expect(document.body.textContent).toContain('Forked')
			expect(document.body.textContent).not.toContain('Loading')
			expect(document.body.textContent).not.toContain('Pool-held REP')
			expect(document.body.textContent).not.toContain('known vaults')
		} finally {
			await rendered.cleanup()
		}
	})

	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('keeps direct lookup available for an unknown universe instead of spinning forever', async () => {
		window.history.replaceState({}, '', '#/pools/universes?universe=999')
		const rendered = await renderIntoDocument(h(UniversePoolDirectorySection, { activeUniverseId: 999n, zoltarUniverse: undefined, universeMissing: true }))
		cleanupRenderedComponent = rendered.cleanup
		expect(document.body.textContent).toContain('Choose another universe.')
		expect(document.body.textContent).not.toContain('Loading')
		expect(within(document.body).getByRole('textbox', { name: 'Open universe by ID' })).toBeTruthy()
		within(document.body).getByRole('button', { name: 'Go to Genesis universe' }).click()
		expect(window.location.hash).toContain('universe=0')
		expect(within(document.body).queryByText('Go to Genesis universe', { selector: 'p' })).toBeNull()
	})

	test('shows selection actions only for deployed non-active child universes', async () => {
		const renderedComponent = await renderIntoDocument(h(UniversePoolDirectorySection, { activeUniverseId: 1n, zoltarUniverse: createForkedUniverseSummary() }))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const selectLinks = documentQueries.getAllByRole('link', { name: 'Open' })
		expect(selectLinks).toHaveLength(1)
		expect(selectLinks[0]?.className).toContain('button-link')
	})

	test('keeps a parent universe link available when the active universe is a child', async () => {
		const renderedComponent = await renderIntoDocument(
			h(UniversePoolDirectorySection, {
				activeUniverseId: 2n,
				zoltarUniverse: createForkedUniverseSummary({
					childUniverses: [],
					parentUniverseId: 1n,
					universeId: 2n,
				}),
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const parentLink = within(document.body).getByRole('link', { name: 'Universe 0x1' })
		expect(parentLink.getAttribute('href')).toContain('universe=1')
	})
})
