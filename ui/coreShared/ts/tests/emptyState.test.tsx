/// <reference types="bun-types" />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { EmptyState } from '../components/EmptyState.js'
import { within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('EmptyState', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('renders the title, detail, and actions in the shared empty-state structure', async () => {
		const renderedComponent = await renderIntoDocument(<EmptyState actions={<button type='button'>Create pool</button>} className='custom' detail='Create the first pool to get started.' title='No pools yet' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const root = document.body.querySelector('.empty-state')
		if (root === null) throw new Error('Expected an empty state root')
		expect(root.classList.contains('custom')).toBe(true)
		expect(root.getAttribute('role')).toBeNull()
		expect(root.querySelector('p.empty-state-title')?.textContent).toBe('No pools yet')
		expect(root.querySelector('p.empty-state-detail')?.textContent).toBe('Create the first pool to get started.')
		expect(within(root.querySelector('.empty-state-actions') ?? root).getByRole('button', { name: 'Create pool' })).not.toBeNull()
	})

	test('omits optional detail and actions and announces only when live', async () => {
		const renderedComponent = await renderIntoDocument(<EmptyState live title='No matches' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const root = within(document.body).getByRole('status')
		expect(root.classList.contains('empty-state')).toBe(true)
		expect(root.querySelector('.empty-state-detail')).toBeNull()
		expect(root.querySelector('.empty-state-actions')).toBeNull()
	})
})
