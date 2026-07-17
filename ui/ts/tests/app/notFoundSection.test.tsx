/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { NotFoundSection } from '../../app/components/NotFoundSection.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'
import { within } from '../testUtils/queries'

describe('NotFoundSection', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('shows one concise error heading and direct recovery links', async () => {
		const renderedComponent = await renderIntoDocument(<NotFoundSection />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getAllByRole('heading')).toHaveLength(1)
		expect(documentQueries.getByRole('heading', { name: 'Page Not Found' })).not.toBeNull()
		expect(documentQueries.getByRole('link', { name: 'Deploy' }).getAttribute('href')).toBe('#/deploy')
		expect(documentQueries.getByRole('link', { name: 'Markets' }).getAttribute('href')).toBe('#/zoltar')
		expect(documentQueries.getByRole('link', { name: 'Security Pools' }).getAttribute('href')).toBe('#/security-pools')
	})
})
