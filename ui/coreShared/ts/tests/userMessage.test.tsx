import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { UserMessageShowcase } from './fixtures/userMessageShowcase.js'
import { StateHint } from '../components/StateHint.js'
import { UserMessage } from '../components/UserMessage.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { fireEvent, within } from './testUtils/queries'

describe('UserMessage', () => {
	let cleanup: (() => Promise<void>) | undefined
	installDomTestLifecycle({
		afterTest: async () => {
			await cleanup?.()
			cleanup = undefined
		},
	})

	test.each([
		'Enter an amount greater than zero.',
		'Enter a mint amount greater than zero.',
		'Enter a redeem amount greater than zero.',
		'Enter a bid amount greater than zero.',
		'Enter a bid price greater than zero.',
		'Enter a valid report amount greater than zero.',
		'Enter a liquidation amount greater than zero.',
		'Enter a valid new WETH amount greater than zero.',
		'Base token amount must be greater than zero.',
		'Quote token amount must be greater than zero.',
		'Enter an amount first.',
	])('keeps the amount blocker accessible without a visible notice: %s', async message => {
		const rendered = await renderIntoDocument(<UserMessage id='amount-reason' detail={message} />)
		cleanup = rendered.cleanup
		const reason = rendered.container.querySelector('#amount-reason')
		expect(reason?.textContent).toBe(message)
		expect(reason?.className).toBe('visually-hidden')
		expect(rendered.container.querySelector('.tx-action-notice')).toBeNull()
	})

	test.each(['Insufficient balance.', 'Enter a number, such as 1.5.', 'Enter an ETH amount with at most 18 decimal places.', 'Enter at least 2 REP.'])('keeps actionable validation visible: %s', async message => {
		const rendered = await renderIntoDocument(<UserMessage detail={message} />)
		cleanup = rendered.cleanup
		expect(rendered.container.querySelector('.tx-action-notice')?.textContent).toBe(message)
		expect(rendered.container.querySelector('.visually-hidden')).toBeNull()
	})

	test('renders the browser showcase through the same shared components used by both apps', async () => {
		const rendered = await renderIntoDocument(<UserMessageShowcase />)
		cleanup = rendered.cleanup
		expect(new Set(Array.from(rendered.container.querySelectorAll('[data-message-placement]')).map(element => element.getAttribute('data-message-placement')))).toEqual(new Set(['field', 'inline', 'section', 'page']))
		expect(within(rendered.container).getByRole('button', { name: 'Submit trade' }).hasAttribute('disabled')).toBe(true)
	})

	test('renders field guidance as phrasing content inside a label without an announcement', async () => {
		const rendered = await renderIntoDocument(
			<label>
				<select aria-label='Oracle' aria-describedby='oracle-help' />
				<UserMessage placement='field' as='span' id='oracle-help' detail='Choose the price source.' />
			</label>,
		)
		cleanup = rendered.cleanup
		expect(rendered.container.querySelector('label p, label div')).toBeNull()
		expect(within(rendered.container).getByText('Choose the price source.').tagName).toBe('SPAN')
		expect(rendered.container.querySelector('[aria-live]')).toBeNull()
	})

	test('keeps explanatory guidance quiet regardless of tone or placement', async () => {
		const rendered = await renderIntoDocument(
			<>
				<UserMessage placement='field' tone='warning' id='amount-help' detail='Leave enough ETH for gas.' />
				<UserMessage placement='section' tone='error' title='Unavailable' detail='Choose another pool.' />
			</>,
		)
		cleanup = rendered.cleanup
		expect(rendered.container.querySelector('[aria-live]')).toBeNull()
		expect(within(rendered.container).queryByRole('alert')).toBeNull()
		expect(rendered.container.querySelector('p.field-hint')?.id).toBe('amount-help')
		expect(within(rendered.container).getByRole('heading', { name: 'Unavailable' })).not.toBeNull()
	})

	test('keeps an inline reason on the element referenced by a disabled action', async () => {
		const rendered = await renderIntoDocument(<UserMessage id='trade-reason' detail='Connect your wallet to trade.' />)
		cleanup = rendered.cleanup
		expect(within(rendered.container).getByText('Connect your wallet to trade.').id).toBe('trade-reason')
	})

	test('maps failed state presentations to error tone without forcing an announcement', async () => {
		const rendered = await renderIntoDocument(<StateHint presentation={{ key: 'load_failed', badgeTone: 'blocked', detail: 'Pool read failed.' }} />)
		cleanup = rendered.cleanup
		expect(rendered.container.querySelector('[data-message-tone=error]')).not.toBeNull()
		expect(rendered.container.querySelector('[aria-live]')).toBeNull()
	})

	test('announces loading once when a section has its own live region', async () => {
		const rendered = await renderIntoDocument(<UserMessage placement='section' announcement='polite' loading detail='Refreshing pools…' />)
		cleanup = rendered.cleanup
		expect(rendered.container.querySelectorAll('[aria-live]').length).toBe(1)
		expect(within(rendered.container).getByRole('status').textContent).toBe('Refreshing pools…')
		expect(rendered.container.querySelector('.spinner')).not.toBeNull()
	})

	test('lets an inline error announce assertively and a success announce politely', async () => {
		const rendered = await renderIntoDocument(
			<>
				<UserMessage tone='error' announcement='assertive' detail='Enter a valid amount.' />
				<UserMessage placement='page' tone='success' announcement='polite' detail='Settings saved.' />
			</>,
		)
		cleanup = rendered.cleanup
		expect(within(rendered.container).getByRole('alert').getAttribute('aria-atomic')).toBe('true')
		expect(within(rendered.container).getByRole('status').getAttribute('data-message-tone')).toBe('success')
	})

	test('keeps next steps, recovery actions, and optional details in the same context', async () => {
		let retries = 0
		const rendered = await renderIntoDocument(
			<UserMessage
				placement='section'
				title='Pool unavailable'
				detail='The read timed out.'
				actionHint='Retry to refresh this pool.'
				actions={
					<button
						type='button'
						onClick={() => {
							retries += 1
						}}
					>
						Retry
					</button>
				}
				expandableDetail={{ label: 'Technical details', content: 'RPC request timed out after 30 seconds.' }}
			/>,
		)
		cleanup = rendered.cleanup
		const queries = within(rendered.container)
		expect(queries.getByText('Retry to refresh this pool.')).not.toBeNull()
		expect(rendered.container.querySelector('details')?.open).toBe(false)
		await act(() => {
			fireEvent.click(queries.getByRole('button', { name: 'Retry' }))
		})
		expect(retries).toBe(1)
	})
})
