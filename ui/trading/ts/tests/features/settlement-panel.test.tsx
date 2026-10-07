import { describe, expect, test } from 'bun:test'
import { createPublicClient, createWalletClient, custom, getAddress } from '@zoltar/core-shared/evm/ethereum'
import { act } from 'preact/test-utils'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LiveSettlementControls, type LiveSettlementServices } from '../../features/LiveSettlementControls.js'
import { shareBalanceScope, type LiveMarket } from '../../protocol/live.js'
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'
import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { buttonByLabel } from '../support/dom.js'
import { etherScaleMarketFixture } from '../support/liveMarketFixture.js'

const account = getAddress(`0x${'11'.repeat(20)}`)
const configuration = deploymentConfigurationFixture({ securityPoolFactory: getAddress(`0x${'88'.repeat(20)}`), factory: getAddress(`0x${'99'.repeat(20)}`), router: getAddress(`0x${'55'.repeat(20)}`) })
// The question ended without a fork: ten ETH back ten complete sets, so one complete set redeems for one ETH.
const closedMarket = etherScaleMarketFixture({ tradingStatus: 1, endTime: 1n })
const publicClient = createPublicClient({ transport: custom({ request: async () => undefined }) })
const services: LiveSettlementServices = {
	createPublicClient: () => publicClient,
	loadForkContext: async () => {
		throw new Error('An unforked market has no fork context')
	},
	submit: async () => {
		throw new Error('Unexpected send')
	},
}

let walletRequests = 0
const walletClient = createWalletClient({
	account,
	transport: custom({
		request: async () => {
			walletRequests++
			throw new Error('Unexpected wallet read')
		},
	}),
})

function renderPanel(market: LiveMarket, holdings: Readonly<{ invalid: bigint; yes: bigint; no: bigint }>, nowSeconds = 100n, settings = DEFAULT_TRADE_SETTINGS, options: Readonly<{ services?: LiveSettlementServices; refresh?(options?: Readonly<{ background?: boolean }>): Promise<void> }> = {}) {
	return renderIntoDocument(
		<LiveSettlementControls
			configuration={configuration}
			market={market}
			balances={{ scope: shareBalanceScope(market), ...holdings, lp: 0n }}
			balanceState='ready'
			balanceError={undefined}
			account={account}
			walletClient={walletClient}
			networkMismatchReason={undefined}
			wallet={{ actionLabel: 'Connect wallet', connect: async () => undefined }}
			settings={settings}
			nowSeconds={nowSeconds}
			externallyLocked={false}
			refresh={options.refresh ?? (async () => undefined)}
			onKnownReceipt={() => undefined}
			executeWithCurrentWalletContext={async (_account, _network, _wallet, action) => await action()}
			createGuardedWalletWrite={() => async write => await write()}
			retryBalances={async () => undefined}
			onWorkflowLockChange={() => undefined}
			services={options.services ?? services}
		/>,
	)
}

function operationButton(label: string) {
	const match = Array.from(document.querySelectorAll('[aria-label="Settlement operation"] button')).find(button => button.textContent?.trim() === label)
	if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing ${label} operation`)
	return match
}

function amountInput() {
	const input = document.querySelector('input[name="amount"]')
	if (!(input instanceof HTMLInputElement)) throw new Error('Missing redemption amount')
	return input
}

function describedText(element: HTMLElement) {
	return (element.getAttribute('aria-describedby') ?? '')
		.split(' ')
		.map(id => document.getElementById(id)?.textContent ?? '')
		.join(' ')
}

describe('settlement panel', () => {
	installDomTestLifecycle()

	test('projects redemption holding fees from current chain time without a quote read', async () => {
		const collateral = 10n * 10n ** 18n
		const feeAccounting = { settlementCollateralAttoEth: collateral, totalUnderwritingLimitAttoEth: collateral, feeEligibleUnderwritingLimitAttoEth: collateral, currentRetentionRate: 999_990_000_000_000_000n, lastUpdatedFeeAccumulator: 100n, feeIndexRemainder: 0n, totalFeesOwedRemainder: 0n }
		const market = { ...closedMarket, currentRetentionRate: feeAccounting.currentRetentionRate, valuation: { timestamp: 100n, feeEndTime: 10000n, projectedCollateralAttoEth: collateral, feeAccounting } }
		const rendered = await renderPanel(market, { invalid: 2n * 10n ** 18n, yes: 2n * 10n ** 18n, no: 2n * 10n ** 18n }, 2000n, { ...DEFAULT_TRADE_SETTINGS, validityMinutes: 1n })
		try {
			await act(() => buttonByLabel('Max').click())
			expect(buttonByLabel('Redeem complete sets').disabled).toBe(true)
			expect(document.body.textContent).toContain('Holding fees')
			expect(walletRequests).toBe(0)
		} finally {
			await rendered.cleanup()
		}
	})

	test('refreshes a rejected redemption estimate without clearing the entered amount or error', async () => {
		let refreshes = 0
		const rendered = await renderPanel(closedMarket, { invalid: 2n * 10n ** 18n, yes: 2n * 10n ** 18n, no: 2n * 10n ** 18n }, 100n, DEFAULT_TRADE_SETTINGS, {
			services: {
				...services,
				submit: async () => {
					throw new Error('Refreshed estimate no longer satisfies the approved minimum ETH')
				},
			},
			refresh: async options => {
				expect(options).toEqual({ background: true })
				refreshes++
			},
		})
		try {
			await act(() => buttonByLabel('Max').click())
			await act(async () => {
				buttonByLabel('Redeem complete sets').click()
				await Bun.sleep(10)
			})
			expect(refreshes).toBe(1)
			expect(amountInput().value).toBe('2')
			expect(document.body.textContent).toContain('The price moved past your slippage limit.')
		} finally {
			await rendered.cleanup()
		}
	})

	test('shows the complete sets held and fills the full redemption value with Max', async () => {
		const rendered = await renderPanel(closedMarket, { invalid: 2n * 10n ** 18n, yes: 3n * 10n ** 18n, no: 25n * 10n ** 17n })
		try {
			expect(describedText(amountInput())).toContain('You hold 2 complete sets, worth 2 ETH')
			await act(() => buttonByLabel('Max').click())
			expect(amountInput().value).toBe('2')
			expect(buttonByLabel('Redeem complete sets').disabled).toBe(false)
			expect(document.querySelector('.trade-estimate')?.textContent?.replaceAll('\u00a0', ' ')).toContain('2 ETH')
			expect(document.querySelector('.trade-estimate')?.textContent).toContain('Estimate from the current collateral rate. Rechecked before your wallet opens.')
			expect(document.body.textContent).not.toContain('Getting a quote')
			await act(async () => await Bun.sleep(400))
			expect(walletRequests).toBe(0)
			expect(amountInput().getAttribute('aria-invalid')).toBeNull()
		} finally {
			await rendered.cleanup()
		}
	})

	test('enables winning redemption from loaded balances without wallet requests', async () => {
		const rendered = await renderPanel({ ...closedMarket, questionOutcome: 1 }, { invalid: 0n, yes: 10n ** 18n, no: 0n })
		try {
			expect(buttonByLabel('Redeem Yes').disabled).toBe(false)
			await act(async () => await Bun.sleep(400))
			expect(walletRequests).toBe(0)
			expect(document.body.textContent).not.toContain('Getting a quote')
		} finally {
			await rendered.cleanup()
		}
	})

	for (const originUniverseId of [undefined, 0n])
		test(`selects winning redemption and disables migration after a resolved ${originUniverseId === undefined ? 'ordinary' : 'inherited'} pool's universe forks`, async () => {
			let forkContextLoads = 0
			const market = { ...closedMarket, originUniverseId, questionOutcome: 1, universeForkTime: 9n, tradingStatus: 4 }
			const rendered = await renderPanel(market, { invalid: 0n, yes: 10n ** 18n, no: 0n }, 100n, DEFAULT_TRADE_SETTINGS, {
				services: {
					...services,
					loadForkContext: async () => {
						forkContextLoads++
						throw new Error('Resolved shares cannot migrate')
					},
				},
			})
			try {
				expect(operationButton('Redeem Yes').getAttribute('aria-pressed')).toBe('true')
				const redemption = rendered.container.querySelector('.transaction-outcome button')
				if (!(redemption instanceof HTMLButtonElement)) throw new Error('Missing winning-redemption action')
				expect(redemption.textContent?.trim()).toBe('Redeem Yes')
				expect(redemption.disabled).toBe(false)
				expect(operationButton('Migrate').disabled).toBe(true)
				expect(describedText(operationButton('Migrate'))).toBe('Redeem sets, Migrate unavailable: The question resolved. Redeem your winning shares instead.')
				expect(describedText(operationButton('Redeem sets'))).toBe('Redeem sets, Migrate unavailable: The question resolved. Redeem your winning shares instead.')
				await act(async () => await Bun.sleep(10))
				expect(forkContextLoads).toBe(0)
				expect(document.body.textContent).not.toContain('Loading fork question')
			} finally {
				await rendered.cleanup()
			}
		})

	test('names why a settlement action is unavailable and disables migration before a fork', async () => {
		const rendered = await renderPanel(closedMarket, { invalid: 0n, yes: 10n ** 18n, no: 10n ** 18n })
		try {
			expect(document.body.textContent).not.toContain('lifecycle state or wallet balances')
			expect(operationButton('Migrate').disabled).toBe(true)
			expect(operationButton('Migrate').getAttribute('aria-description')).toBe('The universe has not forked, so there is nothing to migrate.')
			expect(Array.from(document.querySelectorAll('.operation-switcher-reasons li')).map(item => item.textContent)).toEqual(['Migrate unavailable: The universe has not forked, so there is nothing to migrate.'])
			// The disabled option is described by the visible reason, not only by a tooltip.
			const migrationReasonId = operationButton('Migrate').getAttribute('aria-describedby')
			expect(migrationReasonId).not.toBeNull()
			expect(document.getElementById(migrationReasonId ?? '')?.closest('.operation-switcher-reasons')).not.toBeNull()
			expect(describedText(operationButton('Migrate'))).toBe('Migrate unavailable: The universe has not forked, so there is nothing to migrate.')
			expect(Array.from(document.querySelectorAll('.operation-switcher .view-tab:not([disabled])')).every(option => !option.hasAttribute('aria-describedby'))).toBe(true)
			// Without complete sets there is nothing to fill, and the action names the missing INVALID.
			expect(Array.from(document.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Max')).toBe(false)
			const redeem = buttonByLabel('Redeem complete sets')
			expect(redeem.disabled).toBe(true)
			expect(describedText(redeem)).toContain('You hold no complete sets. Redeeming needs equal Yes, No, and Invalid shares.')
		} finally {
			await rendered.cleanup()
		}
	})
})
