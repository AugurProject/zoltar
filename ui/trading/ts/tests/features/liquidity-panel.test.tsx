import { describe, expect, test } from 'bun:test'
import { createWalletClient, custom, type Address } from '@zoltar/core-shared/evm/ethereum'
import { act } from 'preact/test-utils'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { shareBalanceScope, type LiveBalances, type LiveMarket } from '../../protocol/live.js'
import { LiveLiquidityControls, type LiveLiquidityServices } from '../../features/LiveLiquidityControls.js'
import { estimateLiquidity, outcomeSharesValueAttoEth } from '../../features/live/liquidityEstimate.js'
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'
import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { etherScaleMarketFixture } from '../support/liveMarketFixture.js'

const account = `0x${'11'.repeat(20)}` as Address
const configuration = deploymentConfigurationFixture({ securityPoolFactory: `0x${'22'.repeat(20)}`, factory: `0x${'33'.repeat(20)}`, router: `0x${'44'.repeat(20)}` })
// Ten ETH back ten complete sets; the pool holds 50 YES, 50 NO, and 50 LP.
const openMarket = etherScaleMarketFixture()
// The question ended: the pool still holds liquidity but takes no new risk.
const closedMarket = etherScaleMarketFixture({ tradingStatus: 1, endTime: 1n })
const services: LiveLiquidityServices = {
	submitFreshLiquidity: async () => {
		throw new Error('Unexpected send')
	},
}

function renderPanel(market: LiveMarket, connected: boolean, balances: LiveBalances | undefined = undefined, quoteServices = services, walletClient: ReturnType<typeof createWalletClient> | undefined = undefined) {
	return renderIntoDocument(
		<LiveLiquidityControls
			configuration={configuration}
			market={market}
			balances={balances}
			balanceState={connected ? 'ready' : 'disconnected'}
			balanceError={undefined}
			account={connected ? account : undefined}
			walletClient={walletClient}
			networkMismatchReason={undefined}
			walletEthAttoEth={connected ? 10n ** 18n : undefined}
			wallet={{ actionLabel: 'Connect wallet', connect: async () => undefined }}
			settings={DEFAULT_TRADE_SETTINGS}
			externallyLocked={false}
			nowSeconds={100n}
			refresh={async () => undefined}
			onKnownReceipt={() => undefined}
			executeWithCurrentWalletContext={async (_account, _network, _wallet, action) => await action()}
			createGuardedWalletWrite={() => async write => await write()}
			retryBalances={async () => undefined}
			onWorkflowLockChange={() => undefined}
			services={quoteServices}
		/>,
	)
}

function amountInput() {
	const input = document.querySelector('input[name="amount"]')
	if (!(input instanceof HTMLInputElement)) throw new Error('Missing amount input')
	return input
}

async function typeAmount(value: string) {
	const input = amountInput()
	await act(() => {
		input.value = value
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
}

function operationButtons() {
	return Array.from(document.querySelectorAll('[aria-label="Liquidity operation"] button')).filter(button => button instanceof HTMLButtonElement)
}

function operationButton(label: string) {
	const match = operationButtons().find(button => button.textContent?.trim() === label)
	if (match === undefined) throw new Error(`Missing ${label} operation`)
	return match
}

function amountErrorText() {
	const describedBy = amountInput().getAttribute('aria-describedby') ?? ''
	return describedBy
		.split(' ')
		.map(id => document.getElementById(id)?.textContent ?? '')
		.join(' ')
}

describe('liquidity panel', () => {
	installDomTestLifecycle()

	test('previews additions instantly without wallet requests', async () => {
		let requests = 0
		const walletClient = createWalletClient({
			account,
			transport: custom({
				request: async () => {
					requests++
					throw new Error('Unexpected wallet read')
				},
			}),
		})
		const rendered = await renderPanel(openMarket, true, undefined, services, walletClient)
		try {
			await typeAmount('0.1')
			await act(async () => await new Promise(resolve => setTimeout(resolve, 400)))
			expect(document.body.textContent).not.toContain('Getting a quote…')
			expect(document.querySelector('section[aria-label="Liquidity estimate"]')?.textContent).toContain('0.1 LP')
			const action = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Add liquidity')
			expect(action?.disabled).toBe(false)
			expect(requests).toBe(0)
		} finally {
			await rendered.cleanup()
		}
	})

	test('previews initialization instantly without any wallet quote requests', async () => {
		let requests = 0
		const walletClient = createWalletClient({
			account,
			transport: custom({
				request: async () => {
					requests++
					throw new Error('Unexpected wallet read')
				},
			}),
		})
		const rendered = await renderPanel({ ...openMarket, pair: undefined, lpTotalSupply: 0n }, true, undefined, services, walletClient)
		try {
			await typeAmount('0.1')
			expect(document.querySelector('section[aria-label="Liquidity estimate"]')?.textContent).toContain('0.1 Invalid')
			expect(document.querySelector('section[aria-label="Liquidity estimate"]')?.textContent).toContain('Estimate from your price and the current collateral rate. Rechecked before submitting.')
			expect(document.body.textContent).not.toContain('Getting a quote…')
			await act(async () => await new Promise(resolve => setTimeout(resolve, 400)))
			expect(requests).toBe(0)
			const action = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Initialize pool')
			expect(action?.disabled).toBe(false)
			expect(requests).toBe(0)
		} finally {
			await rendered.cleanup()
		}
	})

	test('explains malformed and over-precise amounts instead of asking for a positive amount', async () => {
		const rendered = await renderPanel(openMarket, true)
		try {
			await typeAmount('1.2.3')
			expect(amountInput().getAttribute('aria-invalid')).toBe('true')
			expect(amountErrorText()).toContain('Enter an ETH amount with at most 18 decimal places.')
			await typeAmount(`0.${'1'.repeat(19)}`)
			expect(amountErrorText()).toContain('at most 18 decimal places')
			await typeAmount('0')
			await act(() => operationButton('Remove').click())
			await typeAmount('1.2.3')
			expect(amountErrorText()).toContain('Enter an LP amount with at most 18 decimal places.')
		} finally {
			await rendered.cleanup()
		}
	})

	test('opens on Remove when the market no longer takes new liquidity', async () => {
		const rendered = await renderPanel(closedMarket, true, { scope: shareBalanceScope(closedMarket), invalid: 0n, yes: 0n, no: 0n, lp: 10n ** 18n })
		try {
			expect(operationButton('Remove').getAttribute('aria-pressed')).toBe('true')
			expect(operationButton('Add').disabled).toBe(true)
			expect(operationButton('Add').getAttribute('aria-description')).toBe('Question ended')
			// Short badge reasons are completed as sentences so they read like the other stacked reasons.
			expect(document.body.textContent).toContain('Add unavailable: Question ended.')
		} finally {
			await rendered.cleanup()
		}
	})

	test('offers Initialize only while the pool is empty', async () => {
		const initialized = await renderPanel(openMarket, true)
		try {
			expect(operationButtons().map(button => button.textContent?.trim())).toEqual(['Add', 'Remove'])
			expect(operationButton('Add').getAttribute('aria-pressed')).toBe('true')
		} finally {
			await initialized.cleanup()
		}
		const empty = await renderPanel({ ...openMarket, yesReserve: 0n, noReserve: 0n, lpTotalSupply: 0n }, true)
		try {
			expect(operationButtons().map(button => button.textContent?.trim())).toEqual(['Initialize', 'Add', 'Remove'])
			expect(operationButton('Initialize').getAttribute('aria-pressed')).toBe('true')
			expect(operationButton('Add').getAttribute('aria-description')).toBe('Initialize the pool first.')
			expect(operationButton('Remove').getAttribute('aria-description')).toBe('The pool has no liquidity yet.')
			// The reasons are also visible text, so touch users do not depend on a hover tooltip.
			expect(Array.from(document.querySelectorAll('.operation-switcher-reasons li')).map(item => item.textContent)).toEqual(['Add unavailable: Initialize the pool first.', 'Remove unavailable: The pool has no liquidity yet.'])
		} finally {
			await empty.cleanup()
		}
	})

	test('estimates a deposit and a removal from public pool state before a wallet connects', async () => {
		const rendered = await renderPanel(openMarket, false)
		try {
			await typeAmount('1')
			const estimate = document.querySelector('section[aria-label="Liquidity estimate"]')
			expect(estimate?.textContent).toContain('1 LP')
			expect(estimate?.textContent).toContain('1 Invalid')
			expect(estimate?.textContent).toContain('Estimate from the current pool state.')
			expect(estimate?.textContent).not.toContain('Connect a wallet to submit.')
			await act(() => operationButton('Remove').click())
			await typeAmount('5')
			const removal = document.querySelector('section[aria-label="Liquidity estimate"]')
			expect(removal?.textContent).toContain('5 Yes')
			expect(removal?.textContent).toContain('5 No')
			expect(removal?.textContent).toContain('Worth about 5 ETH at the current pool price')
			expect(document.body.textContent).toContain('Removing liquidity returns Yes and No shares to your wallet, not ETH. Next, sell them on the Trade tab')
			expect(document.body.textContent).not.toContain('raw Yes and No')
		} finally {
			await rendered.cleanup()
		}
	})

	test('points a closed-market removal to complete-set redemption', async () => {
		const rendered = await renderPanel(closedMarket, false)
		try {
			expect(document.body.textContent).toContain('redeem them with matching Invalid shares as complete sets on the Settlement tab')
		} finally {
			await rendered.cleanup()
		}
	})
})

describe('public liquidity estimate', () => {
	test('mirrors the router deposit, initialization, and pair removal arithmetic', () => {
		const skewed = etherScaleMarketFixture({ yesReserve: 20n * 10n ** 18n, noReserve: 80n * 10n ** 18n, lpTotalSupply: 40n * 10n ** 18n })
		// NO is the larger reserve, so all minted NO goes in and YES is used in proportion.
		expect(estimateLiquidity(skewed, 'add', 10n ** 18n, undefined)).toEqual({ operation: 'add', amount: 10n ** 18n, liquidity: 5n * 10n ** 17n, completeSets: 10n ** 18n, yesUsed: 25n * 10n ** 16n, noUsed: 10n ** 18n, invalidReturned: 10n ** 18n, yesReturned: 75n * 10n ** 16n, noReturned: 0n })
		expect(estimateLiquidity(skewed, 'remove', 4n * 10n ** 18n, undefined)).toEqual({ operation: 'remove', amount: 4n * 10n ** 18n, yesOut: 2n * 10n ** 18n, noOut: 8n * 10n ** 18n })
		const initialization = estimateLiquidity({ ...skewed, yesReserve: 0n, noReserve: 0n, lpTotalSupply: 0n }, 'initialize', 10n ** 18n, 7_500n)
		expect(initialization).toMatchObject({ operation: 'initialize', yesUsed: 10n ** 18n / 3n, noUsed: 10n ** 18n, liquidity: 10n ** 18n / 3n - 1_000n })
		expect(estimateLiquidity(skewed, 'remove', 41n * 10n ** 18n, undefined)).toBeUndefined()
		expect(estimateLiquidity(skewed, 'add', 0n, undefined)).toBeUndefined()
		expect(estimateLiquidity(skewed, 'initialize', 10n ** 18n, undefined)).toBeUndefined()
	})

	test('values returned shares at the conditional pool price', () => {
		// YES trades at 80% and NO at 20%: two YES and eight NO are worth 1.6 + 1.6 ETH.
		const skewed = etherScaleMarketFixture({ yesReserve: 20n * 10n ** 18n, noReserve: 80n * 10n ** 18n })
		expect(outcomeSharesValueAttoEth(skewed, 2n * 10n ** 18n, 8n * 10n ** 18n)).toBe(32n * 10n ** 17n)
	})
})
