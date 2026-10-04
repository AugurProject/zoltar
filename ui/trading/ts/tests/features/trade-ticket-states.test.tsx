import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { fireEvent } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { LivePositionControls, type PositionTicket, type TicketBalances, type TicketWallet } from '../../features/LivePositionControls.js'
import { MarketPosition } from '../../features/MarketPosition.js'
import { DEFAULT_TRADE_SETTINGS, type TradeSettings } from '../../lib/tradeSettings.js'
import { liveMarketFixture } from '../support/liveMarketFixture.js'
import { positionTicket } from '../support/positionTicket.js'

const eth = 10n ** 18n
const pool = `0x${'11'.repeat(20)}` as Address
const market = liveMarketFixture({ pool, endTime: 10_000n })
const connectedWallet: TicketWallet = { connected: true, networkMismatchReason: undefined, actionLabel: 'Connect wallet', walletEthAttoEth: eth, connect: async () => undefined }
const disconnectedHoldings: TicketBalances = { balances: undefined, balanceState: 'disconnected', balanceError: undefined, retry: async () => undefined }
const readyHoldings: TicketBalances = { balances: { scope: { pool, shareToken: market.shareToken, invalidTokenId: 1n, yesTokenId: 2n, noTokenId: 3n }, yes: 0n, no: 0n, invalid: 0n, lp: 0n }, balanceState: 'ready', balanceError: undefined, retry: async () => undefined }

function buttonNamed(container: ParentNode, name: string) {
	const match = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent === name)
	if (match === undefined) throw new Error(`Missing button ${name}`)
	return match
}

describe('trade ticket states', () => {
	let cleanup: (() => Promise<void>) | undefined
	installDomTestLifecycle({
		afterTest: async () => {
			await cleanup?.()
			cleanup = undefined
		},
		url: 'http://localhost/#/market',
	})

	async function renderTicket(ticket: PositionTicket, options: Readonly<{ nowSeconds?: bigint; holdings?: TicketBalances; onOpenSettlement?: () => void; onSettingsChange?: (settings: TradeSettings) => void }> = {}) {
		const rendered = await renderIntoDocument(
			<LivePositionControls market={market} nowSeconds={options.nowSeconds ?? 1n} settings={DEFAULT_TRADE_SETTINGS} onSettingsChange={options.onSettingsChange} ticket={ticket} wallet={connectedWallet} holdings={options.holdings ?? readyHoldings} externallyLocked={false} onOpenSettlement={options.onOpenSettlement} />,
		)
		cleanup = rendered.cleanup
		return rendered.container
	}

	test('asks a disconnected visitor to connect instead of showing bare dashes for the position', async () => {
		const rendered = await renderIntoDocument(<MarketPosition market={market} holdings={disconnectedHoldings} wallet={connectedWallet} disabled={false} ownsBalanceError />)
		cleanup = rendered.cleanup
		const position = rendered.container.querySelector('.market-position')
		expect(position?.textContent).toContain('Connect wallet to see your position')
		expect(position?.querySelector('.market-holdings')).toBeNull()
		expect(position?.textContent).not.toContain('—')
	})

	test('a closed market says trading has ended and points to Settlement', async () => {
		let settlementOpened = 0
		const container = await renderTicket(positionTicket(), { nowSeconds: 20_000n, onOpenSettlement: () => (settlementOpened += 1) })
		const notice = container.querySelector('.trade-ticket-closed')
		expect(notice?.textContent).toContain('Trading has ended for this market.')
		expect(container.textContent).not.toContain('Market closed to new positions.')
		await act(() => buttonNamed(container, 'Open settlement').click())
		expect(settlementOpened).toBe(1)
	})

	test('a buy Max fills the wallet ETH less the gas reserve', async () => {
		const amounts: string[] = []
		const container = await renderTicket(positionTicket({ setAmount: value => amounts.push(value) }))
		expect(container.querySelector('.trade-amount-shortcuts')?.getAttribute('aria-label')).toBe('Buy amount shortcuts')
		await act(() => buttonNamed(container, 'Max').click())
		expect(amounts).toEqual(['0.99'])
	})

	test('buy shortcuts offer 25% and 50% of the spendable ETH beside Max', async () => {
		const amounts: string[] = []
		const container = await renderTicket(positionTicket({ setAmount: value => amounts.push(value) }))
		await act(() => buttonNamed(container, '25%').click())
		await act(() => buttonNamed(container, '50%').click())
		expect(amounts).toEqual(['0.2475', '0.495'])
	})

	test('the outcome buttons carry the conditional odds', async () => {
		const container = await renderTicket(positionTicket())
		const picker = container.querySelector('.outcome-picker')
		expect(picker?.getAttribute('aria-label')).toBe('Outcome, with conditional odds')
		expect(Array.from(picker?.querySelectorAll('button') ?? []).map(button => button.textContent)).toEqual(['Yes 50%', 'No 50%'])
		// With no amount entered there is no odds preview, so the caption is what says the percentages are conditional.
		expect(container.querySelector('.trade-ticket-switchers')?.textContent).toContain('Conditional odds')
	})

	test('switching to Sell selects the outcome the wallet holds', async () => {
		const selections: string[] = []
		const record = { setMode: (mode: string) => selections.push(mode), setSide: (side: string) => selections.push(side) }
		const holdingNo: TicketBalances = { ...readyHoldings, balances: readyHoldings.balances === undefined ? undefined : { ...readyHoldings.balances, no: eth } }
		const container = await renderTicket(positionTicket(record), { holdings: holdingNo })
		await act(() => buttonNamed(container, 'Sell').click())
		expect(selections).toEqual(['exit', 'NO'])
		await cleanup?.()
		selections.length = 0
		// With nothing held on either side, or with the selected outcome held, the side stays.
		const unchanged = await renderTicket(positionTicket(record))
		await act(() => buttonNamed(unchanged, 'Sell').click())
		expect(selections).toEqual(['exit'])
	})

	test('an amount above the wallet balance is explained at the amount field', async () => {
		const container = await renderTicket(positionTicket({ amount: '2' }))
		const input = container.querySelector<HTMLInputElement>('input[name="amount"]')
		expect(input?.getAttribute('aria-invalid')).toBe('true')
		const describedBy = input?.getAttribute('aria-describedby')?.split(' ') ?? []
		expect(describedBy.map(id => container.ownerDocument.getElementById(id)?.textContent)).toContain('Insufficient ETH balance.')
	})

	test('Enter in the amount field submits only when the trade is ready', async () => {
		let submitted = 0
		const submit = async () => void (submitted += 1)
		const pressEnter = async (container: ParentNode) => {
			const input = container.querySelector('input[name="amount"]')
			if (input === null) throw new Error('Missing amount field')
			await act(() => fireEvent.keyDown(input, { key: 'Enter' }))
		}
		const empty = await renderTicket(positionTicket({ submit }))
		await pressEnter(empty)
		expect(submitted).toBe(0)
		await cleanup?.()
		// A submission in flight disables the button, and Enter with it.
		const submitting = await renderTicket(positionTicket({ amount: '0.5', state: 'submitting', submit }))
		await pressEnter(submitting)
		expect(submitted).toBe(0)
		await cleanup?.()
		const ready = await renderTicket(positionTicket({ amount: '0.5', submit }))
		await pressEnter(ready)
		expect(submitted).toBe(1)
	})

	test('the estimate leads with price, profit, and the resulting holding, and keeps a low price impact in the details', async () => {
		const container = await renderTicket(positionTicket({ amount: '0.5' }))
		const visible = container.querySelector('.transaction-review-details')?.textContent
		for (const phrase of ['Average price', 'Minimum received', 'Yes after trade']) expect(visible).toContain(phrase)
		// The profit is the payout shown beside the shares received less the ETH paid, with the return it makes.
		expect(visible).toMatch(/Profit if Yes wins\+[\d.]+ ETH \(\+[\d.]+%\)/)
		expect(visible).not.toContain('Price impact')
		const details = container.querySelector('.trade-estimate details')?.textContent
		for (const phrase of ['Price impact', 'Pool fee', '0.3% · ≈ 0.00', 'Invalid insurance', 'you keep their Invalid shares', 'Holding fees reduce ETH payouts']) expect(details).toContain(phrase)
		// The odds preview sits in the estimate, below the amount, so typing never moves the field.
		expect(container.querySelector('.trade-estimate .probability')).not.toBeNull()
		expect(container.querySelector('.position-controls > .probability')).toBeNull()
	})

	test('slippage and validity can be changed from the estimate', async () => {
		const changes: TradeSettings[] = []
		const container = await renderTicket(positionTicket({ amount: '0.5' }), { onSettingsChange: settings => changes.push(settings) })
		const disclosures = Array.from(container.querySelectorAll('.trade-estimate details'))
		expect(disclosures.map(disclosure => disclosure.querySelector('summary')?.textContent)).toEqual(['Trade details', 'Slippage 0.5% · valid up to 20 min'])
		expect(container.textContent).not.toContain('change in Settings')
		await act(() => buttonNamed(container, '1%').click())
		expect(changes).toEqual([{ ...DEFAULT_TRADE_SETTINGS, slippageBps: 100n }])
	})

	test('a price that moved before signing reads as a warning to review, not as a failure', async () => {
		const requote = 'The price moved since your estimate: You receive ≈ 1 YES. The estimate has been refreshed; review it and press the button again.'
		const container = await renderTicket(positionTicket({ state: 'error', message: requote, requoteNotice: requote }))
		expect(container.querySelector('.notice.error')).toBeNull()
		const warning = container.querySelector('.notice.warning')
		expect(warning?.textContent).toBe(requote)
		expect(warning?.getAttribute('role')).toBe('status')
	})
})
