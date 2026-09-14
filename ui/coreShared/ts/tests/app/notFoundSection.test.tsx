/// <reference types="bun-types" />

import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { NotFoundSection } from '../../app/components/NotFoundSection.js'
import { within } from '../testUtils/queries'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

describe('NotFoundSection', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('shows one concise error heading and direct recovery links', async () => {
		const renderedComponent = await renderIntoDocument(
			<NotFoundSection
				links={[
					{ href: '#/deploy', label: 'Deploy' },
					{ href: '#/local', label: 'Local Surface' },
				]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getAllByRole('heading')).toHaveLength(1)
		expect(documentQueries.getByRole('heading', { name: 'Page Not Found' })).not.toBeNull()
		expect(documentQueries.getByRole('link', { name: 'Deploy' }).getAttribute('href')).toBe('#/deploy')
		expect(documentQueries.getByRole('link', { name: 'Local Surface' }).getAttribute('href')).toBe('#/local')
		expect(documentQueries.getAllByRole('link')).toHaveLength(2)
	})
})
