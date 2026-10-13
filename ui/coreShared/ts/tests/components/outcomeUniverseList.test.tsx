import { describe, expect, test } from 'bun:test'
import { OutcomeUniverseList } from '../../components/OutcomeUniverseList.js'
import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { fireEvent, within } from '../testUtils/queries.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

const lifecycle = installDomTestLifecycle()

describe('outcome universe availability', () => {
	test('allows an outcome with unknown deployment status without inventing a description', async () => {
		let selected = false
		const view = lifecycle.trackRendered(
			await renderIntoDocument(
				<OutcomeUniverseList
					outcomes={[
						{
							key: 'yes',
							label: 'Yes',
							onSelect: () => {
								selected = true
							},
						},
					]}
				/>,
			),
		)
		const open = within(view.container).getByRole('button', { name: 'Open Yes universe' })
		expect(open.hasAttribute('disabled')).toBe(false)
		expect(open.hasAttribute('aria-describedby')).toBe(false)
		expect(view.container.querySelector('.badge')).toBeNull()
		expect(view.container.querySelector('.migration-outcome-metrics')).toBeNull()
		fireEvent.click(open)
		expect(selected).toBe(true)
	})
})
