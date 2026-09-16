import { describe, expect, test } from 'bun:test'
import { EntityCard } from '../../components/EntityCard.js'
import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

describe('EntityCard', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
	})

	test('renders data attributes on the card root so callers can key records without a wrapper', async () => {
		const rendered = await renderIntoDocument(
			<EntityCard title='Pool' className='market-record' dataAttributes={{ 'data-portfolio-pool': '0x1111111111111111111111111111111111111111' }}>
				<p>Balances</p>
			</EntityCard>,
		)
		cleanupRendered = rendered.cleanup

		const card = rendered.container.querySelector('[data-portfolio-pool="0x1111111111111111111111111111111111111111"]')
		expect(card).not.toBeNull()
		expect(card?.classList.contains('entity-card')).toBeTrue()
		expect(card?.classList.contains('market-record')).toBeTrue()
		expect(card?.querySelector('h3')?.textContent).toBe('Pool')
	})

	test('omits data attributes when none are provided', async () => {
		const rendered = await renderIntoDocument(
			<EntityCard title='Pool'>
				<p>Balances</p>
			</EntityCard>,
		)
		cleanupRendered = rendered.cleanup

		const card = rendered.container.querySelector('.entity-card')
		expect(card).not.toBeNull()
		expect(Array.from(card?.attributes ?? []).map(attribute => attribute.name)).toEqual(['class'])
	})
})
