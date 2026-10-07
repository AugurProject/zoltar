/// <reference types="bun-types" />

import { AppPageHeading } from '@zoltar/ui-core-shared/app/components/AppPageHeading.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { describe, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { pushHistoryUrl } from '@zoltar/ui-core-shared/navigation/historyEntries.js'
import { formatAppDocumentTitle, getAppPageTitle, type AppPageTitleInput } from '../../app/lib/appPageTitle.js'

/** Records the top offset of every window scroll the heading requests. */
function mockWindowScroll() {
	const originalScrollTo = window.scrollTo
	const calls: number[] = []
	window.scrollTo = (options?: ScrollToOptions | number) => {
		calls.push(typeof options === 'object' ? (options.top ?? Number.NaN) : Number.NaN)
	}
	return {
		calls,
		restore: () => {
			window.scrollTo = originalScrollTo
		},
	}
}

const baseInput: AppPageTitleInput = {
	activeZoltarView: 'questions',
	route: 'zoltar',
}

describe('app page titles', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('maps routes and active views to user-facing page titles', () => {
		const cases: Array<{ input: AppPageTitleInput; title: ReturnType<typeof getAppPageTitle> }> = [
			{ input: { ...baseInput, route: 'deploy' }, title: 'Deploy contracts' },
			{ input: { ...baseInput, route: 'zoltar', activeZoltarView: 'questions' }, title: 'Browse questions' },
			{ input: { ...baseInput, route: 'zoltar', activeZoltarView: 'create' }, title: 'Create question' },
			{ input: { ...baseInput, route: 'zoltar', activeZoltarView: 'overview' }, title: 'Overview' },
			{ input: { ...baseInput, route: 'zoltar', activeZoltarView: 'universes' }, title: 'Universes' },
			{ input: { ...baseInput, route: 'zoltar', activeZoltarView: 'fork' }, title: 'Fork universe' },
			{ input: { ...baseInput, route: 'zoltar', activeZoltarView: 'migrate' }, title: 'Migrate REP' },
			{ input: { ...baseInput, route: 'not-found' }, title: 'Page not found' },
		]

		for (const { input, title } of cases) {
			expect(getAppPageTitle(input)).toBe(title)
		}
	})

	test('renders the hidden page heading and updates the document title', async () => {
		const renderedComponent = await renderIntoDocument(<AppPageHeading formatDocumentTitle={formatAppDocumentTitle} pageTitle='Questions' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.title).toBe(formatAppDocumentTitle('Questions'))
		expect(document.title).toBe('Questions | Zoltar')
		const heading = within(document.body).getByRole('heading', { level: 1, name: 'Questions' })
		expect(heading.classList.contains('visually-hidden')).toBe(true)
	})

	test('moves focus to the heading at the start of the content and opens a new page at the top', async () => {
		const scrollCalls = mockWindowScroll()
		try {
			const renderedComponent = await renderIntoDocument(
				<div id='app-content'>
					<AppPageHeading formatDocumentTitle={formatAppDocumentTitle} pageTitle='Questions' />
					<p>Question content</p>
				</div>,
			)
			cleanupRenderedComponent = renderedComponent.cleanup

			await act(() => {
				render(
					<div id='app-content'>
						<AppPageHeading formatDocumentTitle={formatAppDocumentTitle} pageTitle='Create question' />
						<p>Create question content</p>
					</div>,
					renderedComponent.container,
				)
			})

			const heading = within(document.body).getByRole('heading', { level: 1, name: 'Create question' })
			expect(document.activeElement).toBe(heading)
			expect(heading.getAttribute('tabindex')).toBe('-1')
			expect(document.title).toBe('Create question | Zoltar')
			expect(scrollCalls.calls).toEqual([0])
		} finally {
			scrollCalls.restore()
		}
	})

	test('keeps the restored scroll position when Back reaches a page, and resets it for the next new page', async () => {
		const scrollCalls = mockWindowScroll()
		try {
			window.history.replaceState(null, '', '#/zoltar?zoltarView=questions')
			const renderedComponent = await renderIntoDocument(<AppPageHeading formatDocumentTitle={formatAppDocumentTitle} pageTitle='Browse questions' />)
			cleanupRenderedComponent = renderedComponent.cleanup

			pushHistoryUrl('#/zoltar?zoltarView=create')
			await act(() => {
				render(<AppPageHeading formatDocumentTitle={formatAppDocumentTitle} pageTitle='Create question' />, renderedComponent.container)
			})
			expect(scrollCalls.calls).toEqual([0])

			const popped = new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true }))
			window.history.back()
			await popped
			await act(() => {
				render(<AppPageHeading formatDocumentTitle={formatAppDocumentTitle} pageTitle='Browse questions' />, renderedComponent.container)
			})
			expect(document.activeElement).toBe(within(document.body).getByRole('heading', { level: 1, name: 'Browse questions' }))
			expect(scrollCalls.calls).toEqual([0])

			pushHistoryUrl('#/zoltar?zoltarView=migrate')
			await act(() => {
				render(<AppPageHeading formatDocumentTitle={formatAppDocumentTitle} pageTitle='Migrate REP' />, renderedComponent.container)
			})
			expect(scrollCalls.calls).toEqual([0, 0])
		} finally {
			scrollCalls.restore()
		}
	})

	test('treats a link or hash navigation that fires popstate as a new page, not as Back', async () => {
		const scrollCalls = mockWindowScroll()
		try {
			window.history.replaceState(null, '', '#/zoltar?zoltarView=questions')
			const renderedComponent = await renderIntoDocument(<AppPageHeading formatDocumentTitle={formatAppDocumentTitle} pageTitle='Browse questions' />)
			cleanupRenderedComponent = renderedComponent.cleanup

			// Assigning location.hash or following a link opens an entry without state and fires popstate before hashchange.
			window.history.pushState(null, '', '#/zoltar?zoltarView=create')
			window.dispatchEvent(new Event('popstate'))
			await act(() => {
				render(<AppPageHeading formatDocumentTitle={formatAppDocumentTitle} pageTitle='Create question' />, renderedComponent.container)
			})

			expect(scrollCalls.calls).toEqual([0])
		} finally {
			scrollCalls.restore()
		}
	})
})
