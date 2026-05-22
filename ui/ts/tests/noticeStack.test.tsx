/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { NoticeStack } from '../components/NoticeStack.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('NoticeStack', () => {
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

	test('renders warning items inside the shared warning surface', async () => {
		const renderedComponent = await renderIntoDocument(
			<NoticeStack
				items={[
					{
						detail: 'Refresh this workflow before continuing.',
						id: 'warning-item',
						title: 'Needs attention',
						tone: 'warning',
					},
				]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Needs attention')).not.toBeNull()
		expect(document.body.querySelector('.warning-surface.notice-stack-item')).not.toBeNull()
	})
})
