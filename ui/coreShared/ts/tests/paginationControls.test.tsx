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

test('keeps keyboard focus on a control that disables itself while its page loads and after the last page arrives', async () => {
	let nextCalls = 0
	const props = { hasPreviousPage: true, onNextPage: () => (nextCalls += 1), onPreviousPage: () => undefined }
	const rendered = await renderIntoDocument(<PaginationControls {...props} hasNextPage summary='Page 1 of 2' />)
	cleanup = rendered.cleanup
	const next = within(document.body).getByRole('button', { name: 'Next page' })
	if (!(next instanceof HTMLButtonElement)) throw new Error('Expected a button')
	await act(() => next.focus())
	await act(() => fireEvent.click(next))
	expect(nextCalls).toBe(1)

	await act(() => render(<PaginationControls {...props} hasNextPage loading summary='Page 1 of 2' />, rendered.container))
	expect(document.activeElement).toBe(next)
	expect(next.disabled).toBe(false)
	expect(next.getAttribute('aria-disabled')).toBe('true')
	expect(next.getAttribute('aria-busy')).toBe('true')
	await act(() => fireEvent.click(next))
	expect(nextCalls).toBe(1)

	await act(() => render(<PaginationControls {...props} hasNextPage={false} summary='Page 2 of 2' />, rendered.container))
	expect(document.activeElement).toBe(next)
	expect(next.getAttribute('aria-disabled')).toBe('true')
	expect(next.getAttribute('aria-busy')).toBe('false')
	await act(() => fireEvent.click(next))
	expect(nextCalls).toBe(1)
	// Once focus moves on, the unavailable control leaves the tab order again.
	await act(() => next.blur())
	expect(next.disabled).toBe(true)
	expect(next.hasAttribute('aria-disabled')).toBe(false)
})
