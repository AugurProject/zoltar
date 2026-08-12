/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from './testUtils/queries'
import { LoadingAwareText, LoadingText, isLoadingText } from '../components/LoadingText.js'
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
		expect(wrapper.getAttribute('role')).toBe('status')
		expect(wrapper.getAttribute('aria-live')).toBe('polite')
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

	test('recognizes and decorates user-facing loading messages', async () => {
		expect(isLoadingText('Loading truth auction status…')).toBe(true)
		expect(isLoadingText('  loading auction bids…')).toBe(true)
		expect(isLoadingText('Auction loaded.')).toBe(false)

		const renderedComponent = await renderIntoDocument(<LoadingAwareText>Loading truth auction status…</LoadingAwareText>)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByRole('status').textContent).toContain('Loading truth auction status…')
		expect(document.body.querySelector('.loading-value .spinner')).not.toBeNull()
	})

	test('leaves non-loading messages unchanged', async () => {
		const renderedComponent = await renderIntoDocument(<LoadingAwareText>Connect a wallet before submitting.</LoadingAwareText>)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByText('Connect a wallet before submitting.')).not.toBeNull()
		expect(document.body.querySelector('.spinner')).toBeNull()
		expect(within(document.body).queryByRole('status')).toBeNull()
	})
})
