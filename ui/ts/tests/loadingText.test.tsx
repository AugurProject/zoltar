/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from './testUtils/queries'
import { LoadingText } from '../components/LoadingText.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('LoadingText', () => {
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

	test('renders the default text and spinner when no child content is given', async () => {
		const renderedComponent = await renderIntoDocument(<LoadingText />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const wrapper = documentQueries.getByText('Loading…')

		expect(wrapper).not.toBeNull()
		expect(wrapper.className).toContain('loading-value')
		expect(document.body.querySelector('.loading-value .spinner')).not.toBeNull()
	})

	test('applies custom classes and custom children', async () => {
		const renderedComponent = await renderIntoDocument(
			<LoadingText className='compact'>
				<span>Working</span>
			</LoadingText>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.querySelector('.loading-value.compact')).not.toBeNull()
		expect(document.body.querySelector('.loading-value .spinner')).not.toBeNull()
		expect(document.body.querySelector('.loading-value')?.textContent).toContain('Working')
	})
})
