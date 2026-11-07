/// <reference types="bun-types" />

import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { LocalBrowseBar } from '../components/LocalBrowseControls.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { fireEvent, within } from './testUtils/queries.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

const { trackRendered } = installDomTestLifecycle()

test('keeps keyboard focus on Show more while the next page is discovered', async () => {
	let discoverCalls = 0
	const bar = (loading: boolean) => (
		<LocalBrowseBar
			directory={{
				collection: 'downloaded',
				discovery: { discoverNext: () => (discoverCalls += 1), hasMore: true, hasScanned: true, loading, scannedItemCount: 10n, totalCount: 12n },
				downloaded: { entries: [1, 2] },
				favoriteEntries: [],
				setCollection: () => undefined,
			}}
			nounPlural='questions'
		/>
	)
	const rendered = await renderIntoDocument(bar(false))
	trackRendered(rendered)
	const showMore = within(rendered.container).getByRole('button', { name: 'Show more' })
	if (!(showMore instanceof HTMLButtonElement)) throw new Error('Expected a button')
	await act(() => showMore.focus())
	await act(() => fireEvent.click(showMore))
	expect(discoverCalls).toBe(1)

	await act(() => render(bar(true), rendered.container))
	expect(document.activeElement).toBe(showMore)
	expect(showMore.disabled).toBe(false)
	expect(showMore.getAttribute('aria-disabled')).toBe('true')
	expect(showMore.getAttribute('aria-busy')).toBe('true')
	await act(() => fireEvent.click(showMore))
	expect(discoverCalls).toBe(1)
})
