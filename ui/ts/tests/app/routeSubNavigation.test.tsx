/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '../testUtils/queries'
import { h } from 'preact'
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
					{ disabled: true, label: 'Migrate REP', reason: 'REP migration is unavailable because this universe has not forked.', value: 'migrate' },
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
		expect(documentQueries.getByRole('button', { name: 'Show earlier Zoltar views' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Show later Zoltar views' })).not.toBeNull()

		const questionsTab = documentQueries.getByRole('link', { name: 'Questions' }) as HTMLAnchorElement
		expect(questionsTab.tagName).toBe('A')
		expect(questionsTab.getAttribute('href')).toBe('#/zoltar?zoltarView=questions')
		expect(questionsTab.getAttribute('aria-current')).toBe('page')
		const migrateRepTab = documentQueries.getByRole('button', { name: 'Migrate REP' }) as HTMLButtonElement
		expect(migrateRepTab.disabled).toBe(true)
		expect(migrateRepTab.title).toBe('REP migration is unavailable because this universe has not forked.')
		expect(migrateRepTab.getAttribute('aria-description')).toBe('REP migration is unavailable because this universe has not forked.')
		expect(documentQueries.getByText('REP migration is unavailable because this universe has not forked.')).not.toBeNull()

		const createQuestionTab = documentQueries.getByRole('link', { name: 'Create Question' })
		const locationBeforeClicks = window.location.href
		const preventNativeNavigation = (event: Event) => event.preventDefault()
		document.body.addEventListener('click', preventNativeNavigation)
		for (const clickInit of [{ altKey: true }, { button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) fireEvent.click(createQuestionTab, clickInit)

		expect(routeChanges).toEqual([])
		expect(window.location.href).toBe(locationBeforeClicks)
		document.body.removeEventListener('click', preventNativeNavigation)
	})
})
