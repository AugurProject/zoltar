import { describe, expect, test } from 'bun:test'
import { createPublicClient, createWalletClient, custom, getAddress, type Hash } from '@zoltar/core-shared/evm/ethereum'
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
const blockHash: Hash = `0x${'77'.repeat(32)}`
const configuration = deploymentConfigurationFixture({ securityPoolFactory: getAddress(`0x${'88'.repeat(20)}`), factory: getAddress(`0x${'99'.repeat(20)}`), router: getAddress(`0x${'55'.repeat(20)}`) })
// The question ended without a fork: ten ETH back ten complete sets, so one complete set redeems for one ETH.
const closedMarket = etherScaleMarketFixture({ tradingStatus: 1, endTime: 1n })
const publicClient = createPublicClient({ transport: custom({ request: async () => undefined }) })
const services: LiveSettlementServices = {
	createPublicClient: () => publicClient,
	loadForkContext: async () => {
		throw new Error('An unforked market has no fork context')
	},
	simulate: async (_client, _configuration, quoteMarket, _account, _operation, parameters) => ({ blockNumber: 12n, blockHash, operation: 'redeem-complete-set', market: quoteMarket, amount: parameters.amount ?? 0n, deadline: 1000n, slippageBps: 50n, expectedAttoEth: 1n, minimumAttoEth: 1n }),
	submit: async () => {
		throw new Error('Unexpected send')
	},
}

const walletClient = createWalletClient({ account, transport: custom({ request: async () => undefined }) })

function renderPanel(market: LiveMarket, holdings: Readonly<{ invalid: bigint; yes: bigint; no: bigint }>) {
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
			settings={DEFAULT_TRADE_SETTINGS}
			externallyLocked={false}
			refresh={async () => undefined}
			onKnownReceipt={() => undefined}
			executeWithCurrentWalletContext={async (_account, _network, _wallet, action) => await action()}
			createGuardedWalletWrite={() => async write => await write()}
			retryBalances={async () => undefined}
			onWorkflowLockChange={() => undefined}
			services={services}
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

	test('shows the complete sets held and fills the full redemption value with Max', async () => {
		const rendered = await renderPanel(closedMarket, { invalid: 2n * 10n ** 18n, yes: 3n * 10n ** 18n, no: 25n * 10n ** 17n })
		try {
			expect(describedText(amountInput())).toContain('You hold 2 complete sets, worth 2 ETH')
			await act(() => buttonByLabel('Max').click())
			expect(amountInput().value).toBe('2')
			expect(amountInput().getAttribute('aria-invalid')).toBeNull()
		} finally {
			await rendered.cleanup()
		}
	})

	test('names why a settlement action is unavailable and disables migration before a fork', async () => {
		const rendered = await renderPanel(closedMarket, { invalid: 0n, yes: 10n ** 18n, no: 10n ** 18n })
		try {
			expect(document.body.textContent).not.toContain('lifecycle state or wallet balances')
			expect(operationButton('Fork migration').disabled).toBe(true)
			expect(operationButton('Fork migration').getAttribute('aria-description')).toBe('The universe has not forked, so there is nothing to migrate.')
			expect(Array.from(document.querySelectorAll('.operation-switcher-reasons li')).map(item => item.textContent)).toEqual(['Fork migration unavailable: The universe has not forked, so there is nothing to migrate.'])
			// The disabled option is described by the visible reason, not only by a tooltip.
			const migrationReasonId = operationButton('Fork migration').getAttribute('aria-describedby')
			expect(migrationReasonId).not.toBeNull()
			expect(document.getElementById(migrationReasonId ?? '')?.closest('.operation-switcher-reasons')).not.toBeNull()
			expect(describedText(operationButton('Fork migration'))).toBe('Fork migration unavailable: The universe has not forked, so there is nothing to migrate.')
			expect(Array.from(document.querySelectorAll('.operation-switcher .view-tab:not([disabled])')).every(option => !option.hasAttribute('aria-describedby'))).toBe(true)
			// Without complete sets there is nothing to fill, and the action names the missing INVALID.
			expect(Array.from(document.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Max')).toBe(false)
			const redeem = buttonByLabel('Redeem complete sets')
			expect(redeem.disabled).toBe(true)
			expect(describedText(redeem)).toContain('You hold no complete sets. Redeeming needs equal INVALID, YES, and NO.')
		} finally {
			await rendered.cleanup()
		}
	})
})
