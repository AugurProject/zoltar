/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
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
				ariaLabel: 'Zoltar views',
				onChange: () => undefined,
				options: [
					{ href: '/?zoltarView=questions#/zoltar', label: 'Questions', value: 'questions' },
					{ href: '/?zoltarView=create#/zoltar', label: 'Create Question', value: 'create' },
				],
				value: 'questions',
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Zoltar > Questions')).toBeNull()

		const questionsTab = documentQueries.getByRole('tab', { name: 'Questions' }) as HTMLAnchorElement
		expect(questionsTab.tagName).toBe('A')
		expect(questionsTab.getAttribute('href')).toBe('/?zoltarView=questions#/zoltar')
	})
})
