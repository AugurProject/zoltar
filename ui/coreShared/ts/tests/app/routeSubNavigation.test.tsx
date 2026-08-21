/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '../testUtils/queries'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { RouteSubNavigation } from '../../app/components/RouteSubNavigation.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

describe('RouteSubNavigation', () => {
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

	test('renders linked secondary tabs without extra route path text', async () => {
		const routeChanges: string[] = []
		const renderedComponent = await renderIntoDocument(
			h(RouteSubNavigation, {
				ariaLabel: 'Zoltar views',
				onChange: value => {
					routeChanges.push(value)
				},
				options: [
					{ href: '#/zoltar?zoltarView=questions', label: 'Questions', value: 'questions' },
					{ href: '#/zoltar?zoltarView=create', label: 'Create Question', value: 'create' },
					{ disabled: true, label: 'Migrate REP', value: 'migrate' },
				],
				value: 'questions',
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Zoltar > Questions')).toBeNull()
		expect(document.body.querySelector('.route-subnav-shell')).not.toBeNull()
		expect(document.body.querySelector('.route-subtab-nav')).not.toBeNull()
		expect(documentQueries.getByRole('navigation', { name: 'Zoltar views' })).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Show earlier Zoltar views' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Show later Zoltar views' })).toBeNull()
		const mobileNavigation = documentQueries.getByRole('combobox', { name: 'Zoltar views' }) as HTMLSelectElement
		expect(mobileNavigation.value).toBe('questions')
		fireEvent.change(mobileNavigation, { target: { value: 'create' } })
		expect(routeChanges).toEqual(['create'])

		const questionsTab = documentQueries.getByRole('link', { name: 'Questions' }) as HTMLAnchorElement
		expect(questionsTab.tagName).toBe('A')
		expect(questionsTab.getAttribute('href')).toBe('#/zoltar?zoltarView=questions')
		expect(questionsTab.getAttribute('aria-current')).toBe('page')
		const migrateRepTab = documentQueries.getByRole('button', { name: 'Migrate REP' }) as HTMLButtonElement
		expect(migrateRepTab.disabled).toBe(true)
		expect(migrateRepTab.title).toBe('')
		expect(migrateRepTab.getAttribute('aria-description')).toBeNull()
		expect(documentQueries.queryByText('Available after this universe forks.')).toBeNull()

		const createQuestionTab = documentQueries.getByRole('link', { name: 'Create Question' })
		const locationBeforeClicks = window.location.href
		const preventNativeNavigation = (event: Event) => event.preventDefault()
		document.body.addEventListener('click', preventNativeNavigation)
		for (const clickInit of [{ altKey: true }, { button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) fireEvent.click(createQuestionTab, clickInit)

		expect(routeChanges).toEqual(['create'])
		expect(window.location.href).toBe(locationBeforeClicks)
		document.body.removeEventListener('click', preventNativeNavigation)
	})

	test('shows only controls for scrollable edges', async () => {
		const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
		const scrollWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
		Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 100 })
		Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 400 })

		try {
			const renderedComponent = await renderIntoDocument(
				h(RouteSubNavigation, {
					ariaLabel: 'Overflow views',
					onChange: () => undefined,
					options: [
						{ label: 'First', value: 'first' },
						{ label: 'Second', value: 'second' },
						{ label: 'Third', value: 'third' },
					],
					value: 'first',
				}),
			)
			cleanupRenderedComponent = renderedComponent.cleanup
			const documentQueries = within(document.body)
			const tabStrip = document.body.querySelector('.route-subtab-nav')
			if (!(tabStrip instanceof HTMLElement)) throw new Error('Expected route tab strip')

			expect(documentQueries.queryByRole('button', { name: 'Show earlier Overflow views' })).toBeNull()
			expect(documentQueries.getByRole('button', { name: 'Show later Overflow views' })).not.toBeNull()

			await act(() => {
				tabStrip.scrollLeft = 50
				tabStrip.dispatchEvent(new Event('scroll'))
			})
			const earlierControl = documentQueries.getByRole('button', { name: 'Show earlier Overflow views' })
			expect(earlierControl).not.toBeNull()
			expect(documentQueries.getByRole('button', { name: 'Show later Overflow views' })).not.toBeNull()

			const laterControl = documentQueries.getByRole('button', { name: 'Show later Overflow views' })
			laterControl.focus()
			await act(() => {
				tabStrip.scrollLeft = 300
				tabStrip.dispatchEvent(new Event('scroll'))
			})
			expect(documentQueries.getByRole('button', { name: 'Show earlier Overflow views' })).not.toBeNull()
			expect(documentQueries.queryByRole('button', { name: 'Show later Overflow views' })).toBeNull()
			expect(document.activeElement).toBe(documentQueries.getByRole('button', { name: 'Third' }))

			await act(() => {
				tabStrip.scrollLeft = 50
				tabStrip.dispatchEvent(new Event('scroll'))
			})
			const restoredEarlierControl = documentQueries.getByRole('button', { name: 'Show earlier Overflow views' })
			restoredEarlierControl.focus()
			await act(() => {
				tabStrip.scrollLeft = 0
				tabStrip.dispatchEvent(new Event('scroll'))
			})
			expect(documentQueries.queryByRole('button', { name: 'Show earlier Overflow views' })).toBeNull()
			expect(document.activeElement).toBe(documentQueries.getByRole('button', { name: 'First' }))
		} finally {
			if (clientWidthDescriptor === undefined) delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
			else Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
			if (scrollWidthDescriptor === undefined) delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth
			else Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidthDescriptor)
		}
	})
})
