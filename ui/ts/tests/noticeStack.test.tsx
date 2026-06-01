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

		expect(within(document.body).getByText('Needs attention')).not.toBeNull()
		expect(document.body.querySelector('.warning-surface.notice-stack-item')).not.toBeNull()
	})

	test('renders nothing when there are no notices to show', async () => {
		const renderedComponent = await renderIntoDocument(<NoticeStack items={[]} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.querySelector('.page-notices')).toBeNull()
	})

	test('orders notices by tone and preserves info/success rendering styles', async () => {
		const renderedComponent = await renderIntoDocument(
			<NoticeStack
				items={[
					{
						detail: 'Pending step needs review',
						id: 'pending-item',
						title: 'Review step',
						tone: 'pending',
					},
					{
						detail: 'Action blocked',
						id: 'blocking-item',
						title: 'Critical',
						tone: 'blocking',
					},
					{
						detail: 'Everything looks good',
						id: 'success-item',
						title: 'Complete',
						tone: 'success',
					},
				]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const notices = document.body.querySelectorAll('.notice-stack-item')
		expect(notices.length).toBe(3)
		expect(notices[0]?.className).toContain('blocking')
		expect(notices[1]?.className).toContain('notice-stack-item')
		expect(notices[2]?.className).toContain('success')
	})
})
