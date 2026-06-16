/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { act } from 'preact/test-utils'
import { ErrorNotice } from '../components/ErrorNotice.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('ErrorNotice', () => {
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

	test('renders nothing when no message is provided', async () => {
		const renderedComponent = await renderIntoDocument(<ErrorNotice message={undefined} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('alert')).toBeNull()
	})

	test('dismisses a closeable error message when the close button is used', async () => {
		const renderedComponent = await renderIntoDocument(<ErrorNotice message='user rejected the request' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const dismiss = documentQueries.getByRole('button', { name: 'Dismiss error' })
		expect(documentQueries.getByText('user rejected the request')).not.toBeNull()
		expect(dismiss).not.toBeNull()

		await act(() => {
			fireEvent.click(dismiss)
		})
		expect(documentQueries.queryByText('user rejected the request')).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Dismiss error' })).toBeNull()
	})

	test('keeps non-closeable notices visible and non-dismissible', async () => {
		const renderedComponent = await renderIntoDocument(<ErrorNotice message='Something failed' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Something failed')).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Dismiss error' })).toBeNull()
	})
})
