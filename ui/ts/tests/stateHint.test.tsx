/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { StateHint } from '../components/StateHint.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('StateHint', () => {
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

	test('suppresses loading badges while keeping loading detail text visible', async () => {
		const renderedComponent = await renderIntoDocument(
			<StateHint
				presentation={{
					badgeLabel: 'Loading',
					badgeTone: 'pending',
					detail: 'Refreshing report summaries.',
					key: 'loading',
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Refreshing report summaries.')).not.toBeNull()
		expect(documentQueries.queryByText('Loading')).toBeNull()
		expect(document.body.querySelector('.state-hint .badge')).toBeNull()
	})

	test('does not render non-card badges for non-loading state hints', async () => {
		const renderedComponent = await renderIntoDocument(
			<StateHint
				presentation={{
					actionHint: 'Try another address.',
					badgeLabel: 'Not found',
					badgeTone: 'blocked',
					detail: 'This item is unavailable.',
					key: 'not_found',
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('This item is unavailable.')).not.toBeNull()
		expect(documentQueries.getByText('Try another address.')).not.toBeNull()
		expect(documentQueries.queryByText('Not found')).toBeNull()
		expect(document.body.querySelector('.state-hint .badge')).toBeNull()
	})
})
