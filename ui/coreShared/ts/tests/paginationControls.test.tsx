/// <reference types="bun-types" />

import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { PaginationControls } from '../components/PaginationControls.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { fireEvent, within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

let cleanup: (() => Promise<void>) | undefined
installDomTestLifecycle({
	afterTest: async () => {
		await cleanup?.()
		cleanup = undefined
	},
})

test('shows the pending state inside the pressed control while its page loads', async () => {
	const props = { hasNextPage: true, hasPreviousPage: true, onNextPage: () => undefined, onPreviousPage: () => undefined, summary: 'Page 2 of 5' }
	const rendered = await renderIntoDocument(<PaginationControls {...props} />)
	cleanup = rendered.cleanup
	const queries = within(document.body)

	await act(() => {
		fireEvent.click(queries.getByRole('button', { name: 'Next page' }))
	})
	await act(() => {
		render(<PaginationControls {...props} loading />, rendered.container)
	})
	const nextButton = queries.getByRole('button', { name: 'Next page' }) as HTMLButtonElement
	const previousButton = queries.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement
	expect(nextButton.disabled).toBe(true)
	expect(nextButton.querySelector('.loading-value .spinner')).not.toBeNull()
	// The spinner is silent; the summary status announces the page that arrives.
	expect(nextButton.querySelector('[role="status"]')).toBeNull()
	expect(previousButton.querySelector('.loading-value')).toBeNull()

	await act(() => {
		render(<PaginationControls {...props} summary='Page 3 of 5' />, rendered.container)
	})
	expect(queries.getByRole('button', { name: 'Next page' }).querySelector('.loading-value')).toBeNull()
	expect(queries.getByText('Page 3 of 5').getAttribute('aria-live')).toBe('polite')
})

test('does not show a pending state in a control that was not pressed', async () => {
	const rendered = await renderIntoDocument(<PaginationControls hasNextPage loading onLoadMore={() => undefined} />)
	cleanup = rendered.cleanup
	expect(document.querySelector('.loading-value')).toBeNull()
	expect((within(document.body).getByRole('button', { name: 'Show more' }) as HTMLButtonElement).disabled).toBe(true)
})
