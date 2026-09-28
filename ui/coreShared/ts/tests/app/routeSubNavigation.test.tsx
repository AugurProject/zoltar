/// <reference types="bun-types" />

import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { h } from 'preact'
import { RouteSubNavigation } from '../../app/components/RouteSubNavigation.js'
import { fireEvent, within } from '../testUtils/queries'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

describe('RouteSubNavigation', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
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
		expect(documentQueries.queryByRole('combobox')).toBeNull()

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

		expect(routeChanges).toEqual([])
		expect(window.location.href).toBe(locationBeforeClicks)
		document.body.removeEventListener('click', preventNativeNavigation)
	})

	test('presents section views as a segmented control without sideways scroll controls', async () => {
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

			expect(tabStrip.classList.contains('segmented')).toBe(true)
			expect(documentQueries.queryByRole('button', { name: 'Show earlier Overflow views' })).toBeNull()
			expect(documentQueries.queryByRole('button', { name: 'Show later Overflow views' })).toBeNull()
			expect(documentQueries.getByRole('button', { name: 'First' }).getAttribute('aria-current')).toBe('page')
		} finally {
			if (clientWidthDescriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
			else Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
			if (scrollWidthDescriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth')
			else Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidthDescriptor)
		}
	})
})
