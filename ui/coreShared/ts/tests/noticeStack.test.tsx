/// <reference types="bun-types" />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { NoticeStack } from '../components/NoticeStack.js'
import { within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('NoticeStack', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('renders warning items as toned notices like every other tone', async () => {
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
		const notice = document.body.querySelector('.notice.notice-stack-item.warning')
		expect(notice).not.toBeNull()
		expect(notice?.getAttribute('role')).toBe('status')
		expect(notice?.getAttribute('aria-live')).toBe('polite')
		expect(document.body.querySelector('.warning-surface')).toBeNull()
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
		expect(Array.from(notices).map(notice => notice.tagName)).toEqual(['DIV', 'DIV', 'DIV'])
		expect(Array.from(notices).every(notice => notice.classList.contains('notice'))).toBe(true)
		expect(notices[0]?.className).toContain('blocking')
		expect(notices[1]?.className).toContain('pending')
		expect(notices[2]?.className).toContain('success')
		expect(notices[0]?.getAttribute('role')).toBe('alert')
		expect(notices[0]?.getAttribute('aria-live')).toBe('assertive')
		expect(notices[1]?.getAttribute('role')).toBe('status')
		expect(notices[1]?.getAttribute('aria-live')).toBe('polite')
		expect(notices[2]?.getAttribute('role')).toBe('status')
	})
})
