/// <reference types='bun-types' />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { ErrorNotice } from '../components/ErrorNotice.js'
import { fireEvent, within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('ErrorNotice', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('renders nothing when no message is provided', async () => {
		const renderedComponent = await renderIntoDocument(<ErrorNotice message={undefined} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('alert')).toBeNull()
	})

	test('shows a wallet cancellation as a neutral, polite notice that can be dismissed', async () => {
		for (const message of ['user rejected the request', 'Canceled in wallet.']) {
			const renderedComponent = await renderIntoDocument(<ErrorNotice message={message} />)
			cleanupRenderedComponent = renderedComponent.cleanup

			const documentQueries = within(document.body)
			const notice = documentQueries.getByText(message).closest('.notice')
			if (!(notice instanceof HTMLElement)) throw new Error('Expected the cancellation notice')
			// Declining in the wallet is the user's choice: it is reported calmly instead of as a failure.
			expect(notice.getAttribute('data-message-tone')).toBe('neutral')
			expect(notice.getAttribute('role')).toBe('status')
			expect(documentQueries.queryByRole('alert')).toBeNull()

			await act(() => {
				fireEvent.click(documentQueries.getByRole('button', { name: 'Dismiss notice' }))
			})
			expect(documentQueries.queryByText(message)).toBeNull()
			await renderedComponent.cleanup()
			cleanupRenderedComponent = undefined
		}
	})

	test('keeps non-closeable notices visible and non-dismissible', async () => {
		const renderedComponent = await renderIntoDocument(<ErrorNotice message='Something failed' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const alert = documentQueries.getByRole('alert')
		expect(alert.textContent).toContain('Something failed')
		expect(alert.getAttribute('aria-live')).toBe('assertive')
		expect(alert.getAttribute('aria-atomic')).toBe('true')
		expect(documentQueries.queryByRole('button', { name: /Dismiss/ })).toBeNull()
	})
})
