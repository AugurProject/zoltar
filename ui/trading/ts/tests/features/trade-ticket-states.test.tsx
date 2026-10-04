import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LivePositionControls, type PositionTicket, type TicketBalances, type TicketWallet } from '../../features/LivePositionControls.js'
import { MarketPosition } from '../../features/MarketPosition.js'
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'
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

	async function renderTicket(ticket: PositionTicket, options: Readonly<{ nowSeconds?: bigint; holdings?: TicketBalances; onOpenSettlement?: () => void }> = {}) {
		const rendered = await renderIntoDocument(<LivePositionControls market={market} nowSeconds={options.nowSeconds ?? 1n} settings={DEFAULT_TRADE_SETTINGS} ticket={ticket} wallet={connectedWallet} holdings={options.holdings ?? readyHoldings} externallyLocked={false} onOpenSettlement={options.onOpenSettlement} />)
		cleanup = rendered.cleanup
		return rendered.container
	}

	test('asks a disconnected visitor to connect instead of showing bare dashes for the position', async () => {
		const rendered = await renderIntoDocument(<MarketPosition market={market} holdings={disconnectedHoldings} wallet={connectedWallet} disabled={false} ownsBalanceError />)
		cleanup = rendered.cleanup
		const position = rendered.container.querySelector('.market-position')
		expect(position?.textContent).toContain('Connect a wallet to see your position')
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

	test('a price that moved before signing reads as a warning to review, not as a failure', async () => {
		const requote = 'The price moved since your estimate: You receive ≈ 1 YES. The estimate has been refreshed; review it and press the button again.'
		const container = await renderTicket(positionTicket({ state: 'error', message: requote, requoteNotice: requote }))
		expect(container.querySelector('.notice.error')).toBeNull()
		const warning = container.querySelector('.notice.warning')
		expect(warning?.textContent).toBe(requote)
		expect(warning?.getAttribute('role')).toBe('status')
	})
})
