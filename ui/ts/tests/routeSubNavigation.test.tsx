/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from './testUtils/queries'
import { h } from 'preact'
import { RouteSubNavigation } from '../components/RouteSubNavigation.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

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
		const renderedComponent = await renderIntoDocument(
			h(RouteSubNavigation, {
				ariaLabel: 'Market views',
				onChange: () => undefined,
				options: [
					{ href: '#/zoltar?zoltarView=questions', label: 'Questions & Markets', value: 'questions' },
					{ href: '#/zoltar?zoltarView=create', label: 'Create Question', value: 'create' },
					{ disabled: true, label: 'Migrate REP', reason: 'Fork Oracle before migrating REP.', value: 'migrate' },
				],
				value: 'questions',
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Zoltar > Questions & Markets')).toBeNull()
		expect(document.body.querySelector('.route-subnav-shell')).not.toBeNull()
		expect(document.body.querySelector('.route-subtab-nav')).not.toBeNull()
		expect(documentQueries.getByRole('tablist', { name: 'Market views' })).not.toBeNull()

		const questionsTab = documentQueries.getByRole('tab', { name: 'Questions & Markets' }) as HTMLAnchorElement
		expect(questionsTab.tagName).toBe('A')
		expect(questionsTab.getAttribute('href')).toBe('#/zoltar?zoltarView=questions')
		const migrateRepTab = documentQueries.getByRole('tab', { name: 'Migrate REP' }) as HTMLButtonElement
		expect(migrateRepTab.disabled).toBe(true)
		expect(migrateRepTab.title).toBe('Fork Oracle before migrating REP.')
		expect(migrateRepTab.getAttribute('aria-description')).toBe('Fork Oracle before migrating REP.')
	})
})
