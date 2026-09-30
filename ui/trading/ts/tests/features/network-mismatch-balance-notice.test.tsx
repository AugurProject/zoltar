import { describe, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LivePositionControls } from '../../features/LivePositionControls.js'
import { MarketPosition } from '../../features/MarketPosition.js'
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'
import { smallReserveMarketFixture } from '../support/liveMarketFixture.js'
import { positionTicket } from '../support/positionTicket.js'

const pool = `0x${'11'.repeat(20)}` as Address
const pair = `0x${'22'.repeat(20)}` as Address
const shareToken = `0x${'33'.repeat(20)}` as Address
const market = smallReserveMarketFixture({ pool, pair, shareToken, universeId: 7n, questionId: 9n, title: 'Network mismatch', description: 'Balance notice fixture', endTime: 10_000n })

/** The ticket names the network fix; the market's position section owns the balance failure and its retry. */
function positionControls(networkMismatchReason: string | undefined) {
	const wallet = { connected: true, networkMismatchReason, actionLabel: networkMismatchReason === undefined ? 'Connect wallet' : 'Switch to Browser simulation', walletEthAttoEth: undefined, connect: async () => undefined }
	const holdings = { balances: undefined, balanceState: 'error' as const, balanceError: 'Balance refresh failed.', retry: async () => undefined }
	return (
		<>
			<MarketPosition market={market} holdings={holdings} wallet={wallet} disabled={false} ownsBalanceError />
			<LivePositionControls market={market} nowSeconds={1n} settings={DEFAULT_TRADE_SETTINGS} ticket={positionTicket()} wallet={wallet} holdings={holdings} externallyLocked={false} />
		</>
	)
}

describe('trading balance notices during a network mismatch', () => {
	let cleanup: (() => Promise<void>) | undefined
	installDomTestLifecycle({ afterTest: async () => cleanup?.(), url: 'http://localhost/#/market' })

	test('hides the balance failure while the wallet is on another chain and restores the retry once it is back', async () => {
		const rendered = await renderIntoDocument(positionControls('Switch to Browser simulation.'))
		cleanup = rendered.cleanup

		expect(rendered.container.textContent).toContain('Switch to Browser simulation')
		expect(rendered.container.textContent).not.toContain('Balance refresh failed.')
		expect(rendered.container.textContent).not.toContain('Retry balances')

		await act(() => render(positionControls(undefined), rendered.container))

		expect(rendered.container.textContent).toContain('Balance refresh failed.')
		expect(rendered.container.querySelector('button.secondary')?.textContent).toBe('Retry balances')
	})
})
