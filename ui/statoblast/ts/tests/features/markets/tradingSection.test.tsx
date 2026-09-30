import { evaluateSecurityPoolState } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolState.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
/// <reference types="bun-types" />

import { zeroAddress, zeroHash } from '@zoltar/core-shared/evm/ethereum'
import { GlobalTransactionPresentationProvider } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { getTransactionButtonState } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createWalletActions, expectWalletFixDescribesAction } from '@zoltar/ui-core-shared/tests/testUtils/walletActions.js'
import { WalletActionsProvider } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import type { GlobalTransactionPresentation } from '@zoltar/ui-core-shared/types/components.js'
import type { ListedSecurityPool, TradingActionResult, TradingDetails, TradingShareBalances, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { ChainTimestampContext } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { TradingSection } from '@zoltar/ui-statoblast-shared/features/markets/components/TradingSection.js'
import { NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE, NO_MINT_CAPACITY_NO_ACTIVE_CAPACITY_OWNERSHIP_MESSAGE, UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE } from '@zoltar/ui-statoblast-shared/features/markets/lib/trading.js'
import { deriveHasForkActivity } from '@zoltar/ui-statoblast-shared/features/truth-auctions/lib/forkAuction.js'
import type { TradingSectionProps } from '@zoltar/ui-zoltar-shared/features/types.js'
import type { AccountState, TradingFormState } from '@zoltar/ui-zoltar-shared/types/app.js'
import { describe, expect, mock, test } from 'bun:test'
import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { createAccountState as createEmptyAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'

/** Amounts are plain text by default; their exact value (plus any unit) lives in the title. */
function getExactValueTitles(root: ParentNode, exactValue: string) {
	return Array.from(root.querySelectorAll('.currency-value')).filter(element => {
		const title = element.getAttribute('title')
		return title === exactValue || title?.startsWith(`${exactValue} `) === true
	})
}

function createSelectedPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	const selectedPool: ListedSecurityPool = {
		settlementCollateralAttoEth: 0n,
		currentRetentionRate: 10n,
		feeEligibleUnderwritingLimitAttoEth: overrides.totalUnderwritingLimitAttoEth ?? 5n * 10n ** 18n,
		hasForkActivity: false,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
		lastOraclePrice: 10n ** 18n,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedAttoRep: 0n,
		hasForkContinuationEscalationGame: false,
		ordinaryEscalationGameStarted: false,
		parent: zeroAddress,
		questionOutcome: 'none',
		questionId: '0x01',
		statoblastSecurityMultiplierBps: 20_000n,
		securityPoolAddress: zeroAddress,
		shareTokenSupplyAttoShares: 0n,
		systemState: 'operational',
		totalPoolHeldAttoRep: 0n,
		totalUnderwritingLimitAttoEth: 5n * 10n ** 18n,
		mintingCapacityAttoEth: overrides.totalUnderwritingLimitAttoEth ?? 5n * 10n ** 18n,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 0n,
		universeHasForked: false,
		universeId: 1n,
		vaultCount: 0n,
		vaults: [],
		...overrides,
	}
	return {
		...selectedPool,
		hasForkActivity: overrides.hasForkActivity ?? deriveHasForkActivity(selectedPool),
	}
}

function createShareBalances(overrides: Partial<TradingShareBalances> = {}): TradingShareBalances {
	return {
		invalidAttoShares: 2n * 10n ** 18n,
		noAttoShares: 4n * 10n ** 18n,
		yesAttoShares: 3n * 10n ** 18n,
		...overrides,
	}
}

function createTradingDetails(overrides: Partial<TradingDetails> = {}): TradingDetails {
	const shareBalances = createShareBalances()
	return {
		maxRedeemableCompleteSetsAttoShares: 2n * 10n ** 18n,
		shareBalances,
		universeId: 1n,
		...overrides,
	}
}

function createTradingForm(overrides: Partial<TradingFormState> = {}): TradingFormState {
	return {
		completeSetAmount: '1',
		redeemAmount: '1',
		securityPoolAddress: zeroAddress,
		selectedShareOutcome: 'yes',
		targetOutcomeIndexes: '',
		...overrides,
	}
}

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return createEmptyAccountState({ ethBalanceAttoEth: 10n * 10n ** 18n, ...overrides })
}

function createTradingSectionProps(overrides: Partial<TradingSectionProps> = {}): TradingSectionProps {
	return {
		oraclePriceUsable: true,
		accountState: createAccountState(),
		embedInCard: true,
		loadingTradingForkUniverse: false,
		loadingTradingDetails: false,
		onCreateCompleteSet: () => undefined,
		onMigrateShares: () => undefined,
		onRedeemCompleteSet: () => undefined,
		onRedeemShares: () => undefined,
		onTradingFormChange: () => undefined,
		repPerEthPrice: 10n ** 18n,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		selectedPool: createSelectedPool(),
		showHeader: false,
		showSecurityPoolAddressInput: false,
		tradingActiveAction: undefined,
		tradingDetails: createTradingDetails(),
		tradingError: undefined,
		tradingForkUniverse: undefined,
		tradingForm: createTradingForm(),
		tradingResult: undefined,
		...overrides,
	}
}

function createScalarForkUniverse(): ZoltarUniverseSummary {
	return {
		childUniverses: [
			{
				exists: true,
				forkTime: 1n,
				outcomeIndex: 2n,
				outcomeLabel: '20 USD',
				parentUniverseId: 1n,
				reputationToken: zeroAddress,
				universeId: 2n,
			},
		],
		forkThresholdAttoRep: 0n,
		forkQuestionDetails: {
			...createMarketDetails(),
			answerUnit: 'USD',
			displayValueMax: 100n,
			displayValueMin: 0n,
			marketType: 'scalar',
			numTicks: 10n,
			outcomeLabels: [],
		},
		forkTime: 1n,
		forkingOutcomeIndex: 0n,
		hasForked: true,
		parentUniverseId: 1n,
		reputationToken: zeroAddress,
		totalTheoreticalSupplyAttoRep: 0n,
		universeId: 10n,
	}
}

function createBinaryForkUniverse(): ZoltarUniverseSummary {
	return {
		childUniverses: [
			{
				exists: true,
				forkTime: 1n,
				outcomeIndex: 0n,
				outcomeLabel: 'Yes',
				parentUniverseId: 1n,
				reputationToken: zeroAddress,
				universeId: 2n,
			},
			{
				exists: true,
				forkTime: 1n,
				outcomeIndex: 1n,
				outcomeLabel: 'No',
				parentUniverseId: 1n,
				reputationToken: zeroAddress,
				universeId: 3n,
			},
		],
		forkThresholdAttoRep: 0n,
		forkQuestionDetails: {
			...createMarketDetails(),
			marketType: 'binary',
			numTicks: 2n,
			outcomeLabels: ['Yes', 'No'],
		},
		forkTime: 1n,
		forkingOutcomeIndex: 0n,
		hasForked: true,
		parentUniverseId: 1n,
		reputationToken: zeroAddress,
		totalTheoreticalSupplyAttoRep: 0n,
		universeId: 10n,
	}
}

function TradingSectionHarness({ tradingForkUniverse }: { tradingForkUniverse: ZoltarUniverseSummary }) {
	const [tradingForm, setTradingForm] = useState<TradingFormState>(createTradingForm())

	return (
		<TradingSection
			{...createTradingSectionProps({
				selectedPool: createSelectedPool({ universeHasForked: true }),
				tradingForkUniverse,
				tradingForm,
			})}
			onTradingFormChange={update => setTradingForm(current => ({ ...current, ...update }))}
		/>
	)
}

function TradingSectionWithMutableForm({ initialTradingForm = {}, tradingForkUniverse, selectedPool = createSelectedPool({ universeHasForked: true }) }: { initialTradingForm?: Partial<TradingFormState>; tradingForkUniverse: ZoltarUniverseSummary; selectedPool?: ListedSecurityPool }) {
	const [tradingForm, setTradingForm] = useState<TradingFormState>({ ...createTradingForm(), ...initialTradingForm })

	return (
		<TradingSection
			{...createTradingSectionProps({
				selectedPool,
				tradingForkUniverse,
				tradingForm,
			})}
			onTradingFormChange={update => setTradingForm(current => ({ ...current, ...update }))}
		/>
	)
}

function TradingSectionNetworkHarness() {
	const [accountState, setAccountState] = useState(createAccountState())

	return (
		<>
			<button type='button' onClick={() => setAccountState(createAccountState({ chainId: '0x1' }))}>
				Switch Test Network
			</button>
			<TradingSection
				{...createTradingSectionProps({
					accountState,
				})}
			/>
		</>
	)
}

void describe('TradingSection', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('blocks minting with a stale oracle even when a separate calculation price exists', async () => {
		const rendered = await renderIntoDocument(<TradingSection {...createTradingSectionProps({ oraclePriceUsable: true, repPerEthPrice: 3n * 10n ** 18n, tradingForm: createTradingForm({ completeSetAmount: '0.1' }) })} />)
		cleanupRenderedComponent = rendered.cleanup
		fireEvent.click(within(document.body).getByRole('button', { name: 'Mint complete sets' }))
		await act(() => render(<TradingSection {...createTradingSectionProps({ oraclePriceUsable: false, repPerEthPrice: 3n * 10n ** 18n, tradingForm: createTradingForm({ completeSetAmount: '0.1' }) })} />, rendered.container))
		const dialog = within(document.body).getByRole('dialog')
		const confirm = within(dialog).getByRole('button', { name: 'Mint complete sets' })
		expect(confirm.hasAttribute('disabled')).toBe(true)
		expect(dialog.textContent).toContain('Request a new price in Price oracle before minting.')
	})

	for (const [blockedAccount, fixLabel] of [
		[createAccountState({ address: undefined }), 'Connect wallet'],
		[createAccountState({ chainId: '0x1' }), 'Switch to Sepolia'],
	] as const)
		test(`offers the ${fixLabel} fix inside the mint dialog when the wallet changes while it is open`, async () => {
			const { calls, walletActions } = createWalletActions()
			const renderSection = (accountState: AccountState) => (
				<WalletActionsProvider walletActions={walletActions}>
					<TradingSection {...createTradingSectionProps({ accountState, tradingForm: createTradingForm({ completeSetAmount: '0.1' }) })} />
				</WalletActionsProvider>
			)
			const rendered = await renderIntoDocument(renderSection(createAccountState()))
			cleanupRenderedComponent = rendered.cleanup
			fireEvent.click(within(document.body).getByRole('button', { name: 'Mint complete sets' }))
			await act(() => render(renderSection(blockedAccount), rendered.container))
			const fix = expectWalletFixDescribesAction(within(document.body).getByRole('dialog'), 'Mint complete sets', fixLabel)
			await act(() => fireEvent.click(fix))
			expect(calls).toEqual([fixLabel === 'Connect wallet' ? 'connect' : 'switch'])
		})

	test('explains a mint action that becomes unavailable while its dialog is open', async () => {
		const props = createTradingSectionProps({ tradingForm: createTradingForm({ completeSetAmount: '0.1' }) })
		const rendered = await renderIntoDocument(<TradingSection {...props} />)
		cleanupRenderedComponent = rendered.cleanup
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Mint complete sets' })))
		await act(() => render(<TradingSection {...props} poolState={evaluateSecurityPoolState({ lifecycleState: 'ended' })} />, rendered.container))
		const state = getTransactionButtonState(within(document.body).getByRole('dialog'), 'Mint complete sets')
		expect(state.disabled).toBe(true)
		expect(state.reason).toBe('This action is unavailable in the current pool state.')
	})

	test('keeps the stale-price reason as text in the mint dialog while the wallet is disconnected', async () => {
		const { walletActions } = createWalletActions()
		const renderSection = (accountState: AccountState, oraclePriceUsable: boolean) => (
			<WalletActionsProvider walletActions={walletActions}>
				<TradingSection {...createTradingSectionProps({ accountState, oraclePriceUsable, tradingForm: createTradingForm({ completeSetAmount: '0.1' }) })} />
			</WalletActionsProvider>
		)
		const rendered = await renderIntoDocument(renderSection(createAccountState(), true))
		cleanupRenderedComponent = rendered.cleanup
		fireEvent.click(within(document.body).getByRole('button', { name: 'Mint complete sets' }))
		await act(() => render(renderSection(createAccountState({ address: undefined }), false), rendered.container))
		const dialog = within(document.body).getByRole('dialog')
		expect(within(dialog).queryByRole('button', { name: 'Connect wallet' })).toBeNull()
		expect(getTransactionButtonState(dialog, 'Mint complete sets').reason).toBe('Request a new price in Price oracle before minting.')
	})

	void test('labels the max complete sets metric as redeemable complete sets', async () => {
		const renderedComponent = await renderIntoDocument(<TradingSection {...createTradingSectionProps()} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Redeemable complete sets')).not.toBeNull()
		expect(documentQueries.queryByText('Max Complete Sets')).toBeNull()
	})

	void test('renders trading content without the workflow strip and launches complete-set actions from the share summary', async () => {
		const renderedComponent = await renderIntoDocument(<TradingSection {...createTradingSectionProps({ embedInCard: false, showHeader: false })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Share Workflow')).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Your holdings' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Shares' })).not.toBeNull()
		expect(document.body.textContent?.includes('Balances are shown as complete-set amounts for the selected pool.')).toBe(false)
		expect(document.body.textContent?.includes('Statoblast does not execute secondary-market trades here. Use this panel to mint, redeem, or migrate share balances after reviewing pool capacity and finality.')).toBe(false)
		expect(documentQueries.queryByRole('heading', { name: 'Mint complete sets' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Redeem complete sets' })).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Mint complete sets' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Redeem complete sets' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Migrate forked shares' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Redeem resolved shares' })).toBeNull()
	})

	void test('does not render a local latest trading action card when a result exists', async () => {
		const poolAddress = '0x00000000000000000000000000000000000000ab'
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					tradingResult: {
						action: 'createCompleteSet',
						hash: zeroHash,
						securityPoolAddress: poolAddress,
						universeId: 0n,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Mint complete sets' }))
		})

		const documentQueries = within(document.body)
		expect(poolAddress).toBe('0x00000000000000000000000000000000000000ab')
		expect(documentQueries.queryByRole('heading', { name: 'Latest Share Action' })).toBeNull()
		expect(documentQueries.queryByText('Complete Sets Minted')).toBeNull()
		expect(documentQueries.queryByRole('button', { name: `Copy address ${poolAddress}` })).toBeNull()
		expect(document.body.querySelector('.workflow-transaction-status')).toBeNull()
	})

	void test('closes a trading modal for a new result without blocking the same modal from reopening', async () => {
		let completeTradingOperation: ((result: TradingActionResult) => void) | undefined

		function TradingResultHarness() {
			const [tradingResult, setTradingResult] = useState<TradingActionResult | undefined>(undefined)
			const [transaction, setTransaction] = useState<GlobalTransactionPresentation | undefined>()
			useEffect(() => {
				completeTradingOperation = result => {
					setTradingResult(result)
					setTransaction({
						dismissKey: result.hash,
						hash: result.hash,
						operationKey: 'trading-request-1',
						title: 'Complete sets minted',
						tone: 'success',
					})
				}
			}, [])

			return (
				<GlobalTransactionPresentationProvider transaction={transaction}>
					<TradingSection {...createTradingSectionProps({ tradingResult })} />
				</GlobalTransactionPresentationProvider>
			)
		}

		const renderedComponent = await renderIntoDocument(<TradingResultHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Mint complete sets' }))
		})
		expect(documentQueries.getByRole('dialog', { name: 'Mint complete sets' })).not.toBeNull()

		await act(() => {
			if (completeTradingOperation === undefined) throw new Error('Expected trading operation completion')
			completeTradingOperation({
				action: 'createCompleteSet',
				hash: zeroHash,
				securityPoolAddress: zeroAddress,
				universeId: 1n,
			})
		})
		expect(documentQueries.queryByRole('dialog', { name: 'Mint complete sets' })).toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Mint complete sets' }))
		})
		expect(documentQueries.getByRole('dialog', { name: 'Mint complete sets' })).not.toBeNull()
	})

	void test('renders your share metrics using rounded values with exact value titles', async () => {
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					tradingDetails: createTradingDetails({
						maxRedeemableCompleteSetsAttoShares: 410000000000000n,
						shareBalances: createShareBalances({
							invalidAttoShares: 410000000000000n,
							noAttoShares: 23000000000000000n,
							yesAttoShares: 1234000000000000000n,
						}),
					}),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getAllByText('≈ 1.23').length).toBeGreaterThan(0)
		expect(documentQueries.getAllByText('0.023').length).toBeGreaterThan(0)
		expect(documentQueries.getAllByText('0.00041').length).toBeGreaterThanOrEqual(2)
		expect(getExactValueTitles(document.body, '1.234').length).toBeGreaterThan(0)
		expect(getExactValueTitles(document.body, '0.023').length).toBeGreaterThan(0)
		expect(getExactValueTitles(document.body, '0.00041').length).toBeGreaterThanOrEqual(2)
	})

	void test('keeps share quantities fixed while displaying their reduced ETH backing', async () => {
		const firstMintShareAmount = 10n ** 18n
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					selectedPool: createSelectedPool({
						settlementCollateralAttoEth: 900_000_000_000_000_000n,
						shareTokenSupplyAttoShares: firstMintShareAmount,
					}),
					tradingDetails: createTradingDetails({
						maxRedeemableCompleteSetsAttoShares: firstMintShareAmount,
						shareBalances: createShareBalances({
							invalidAttoShares: firstMintShareAmount,
							noAttoShares: firstMintShareAmount,
							yesAttoShares: firstMintShareAmount,
						}),
					}),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Total across outcomes')).toBeNull()
		expect(documentQueries.queryByText('Total Collateral Equivalent')).toBeNull()
		expect(documentQueries.queryByText('Total Shares')).toBeNull()
		expect(documentQueries.getAllByText('1.00').length).toBeGreaterThanOrEqual(4)
		expect(getExactValueTitles(document.body, '1').length).toBeGreaterThanOrEqual(4)
		expect(document.body.textContent?.includes('1 000 000 000 000 000 000')).toBe(false)
		expect(getExactValueTitles(document.body, '0.9 ETH')).toHaveLength(4)
		expect(document.body.textContent).toContain('(0.9000 ETH)')
	})

	void test('keeps losing share quantities visible with zero ETH value after resolution', async () => {
		const unit = 10n ** 18n
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					selectedPool: createSelectedPool({ questionOutcome: 'yes', settlementCollateralAttoEth: 900_000_000_000_000_000n, shareTokenSupplyAttoShares: unit }),
					tradingDetails: createTradingDetails({ maxRedeemableCompleteSetsAttoShares: unit, shareBalances: createShareBalances({ yesAttoShares: unit, noAttoShares: unit, invalidAttoShares: unit }) }),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const outcomes = document.querySelector('.trading-share-distribution')
		if (outcomes === null) throw new Error('Missing holdings')
		expect(getExactValueTitles(outcomes, '1')).toHaveLength(3)
		expect(getExactValueTitles(outcomes, '0 ETH')).toHaveLength(2)
		expect(getExactValueTitles(outcomes, '0.9 ETH')).toHaveLength(1)
	})

	void test('keeps minting inputs and the submit action without a review panel', async () => {
		const renderedComponent = await renderIntoDocument(<TradingSection {...createTradingSectionProps({ selectedPool: createSelectedPool({ settlementCollateralAttoEth: 0n, shareTokenSupplyAttoShares: 0n }), tradingForm: createTradingForm({ completeSetAmount: '1' }) })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Mint complete sets' })))
		const dialog = within(within(document.body).getByRole('dialog', { name: 'Mint complete sets' }))
		expect(dialog.queryByText('Estimated complete sets received')).toBeNull()
		expect(dialog.getByRole('button', { name: 'Mint complete sets' })).not.toBeNull()
	})

	void test('shows the minting disabled reason when total underwriting commitments remain unclaimed and none is fee eligible', async () => {
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					selectedPool: createSelectedPool({
						settlementCollateralAttoEth: 0n,
						feeEligibleUnderwritingLimitAttoEth: 0n,
						totalPoolHeldAttoRep: 20n * 10n ** 18n,
						totalUnderwritingLimitAttoEth: 0n,
						universeHasForked: false,
					}),
					tradingForm: createTradingForm({ completeSetAmount: '100' }),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const mintButton = documentQueries.getByRole('button', { name: 'Mint complete sets' }) as HTMLButtonElement
		expect(mintButton.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Mint complete sets').reason).toBe(NO_MINT_CAPACITY_NO_ACTIVE_CAPACITY_OWNERSHIP_MESSAGE)
	})

	void test('shows wallet ETH and the amount currently available to mint', async () => {
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					accountState: createAccountState({ ethBalanceAttoEth: 1_250_000_000_000_000_000n }),
					selectedPool: createSelectedPool({
						settlementCollateralAttoEth: 0n,
						totalUnderwritingLimitAttoEth: 5n * 10n ** 18n,
					}),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Mint complete sets' }))
		})

		const modalQueries = within(documentQueries.getByRole('dialog', { name: 'Mint complete sets' }))
		const walletMetric = modalQueries.getByText('Wallet ETH').parentElement
		const mintableMetric = modalQueries.getByText('Available to mint').parentElement
		if (walletMetric === null || mintableMetric === null) throw new Error('Expected mint balance metrics')
		expect(getExactValueTitles(walletMetric, '1.25')).toHaveLength(1)
		expect(getExactValueTitles(mintableMetric, '1.25')).toHaveLength(1)
	})

	void test.each([
		{ capacity: 5n * 10n ** 18n, expected: '1.25' },
		{ capacity: 10n ** 18n, expected: '1' },
	])('fills the mint amount within wallet balance and live backing capacity: $expected', async ({ capacity, expected }) => {
		let mintedAmount: string | undefined
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					accountState: createAccountState({ ethBalanceAttoEth: 1_250_000_000_000_000_000n }),
					onTradingFormChange: ({ completeSetAmount }) => {
						if (completeSetAmount !== undefined) mintedAmount = completeSetAmount
					},
					selectedPool: createSelectedPool({ settlementCollateralAttoEth: 0n, totalUnderwritingLimitAttoEth: 5n * 10n ** 18n, mintingCapacityAttoEth: capacity }),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Mint complete sets' }))
		})
		await act(() => {
			const maxButton = documentQueries.getByRole('dialog', { name: 'Mint complete sets' }).querySelector('.field-inline-action')
			if (!(maxButton instanceof HTMLButtonElement)) throw new Error('Expected mint max button')
			fireEvent.click(maxButton)
		})

		expect(mintedAmount).toBe(expected)
		expect(document.body.textContent?.includes('Max uses your entire ETH balance. Leave ETH for gas.')).toBe(expected === '1.25')
	})

	void test('uses standing commitments when the optional UI price is unavailable', async () => {
		const rendered = await renderIntoDocument(<TradingSection {...createTradingSectionProps({ repPerEthPrice: undefined })} />)
		cleanupRenderedComponent = rendered.cleanup
		expect(document.body.textContent).not.toContain('Unavailable (no price)')
		expect(document.body.textContent).not.toContain('Loading mint capacity.')
		const button = within(document.body).getByRole('button', { name: 'Mint complete sets' })
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected mint button')
		expect(button.disabled).toBe(false)
	})

	void test('keeps mint submission independent of the UI price setting', async () => {
		const rendered = await renderIntoDocument(<TradingSection {...createTradingSectionProps({ oraclePriceUsable: true, repPerEthPrice: undefined, tradingForm: createTradingForm({ completeSetAmount: '0.1' }) })} />)
		cleanupRenderedComponent = rendered.cleanup
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Mint complete sets' })))
		const dialog = within(document.body).getByRole('dialog', { name: 'Mint complete sets' })
		expect(getTransactionButtonState(dialog, 'Mint complete sets').disabled).toBe(false)
		expect(dialog.textContent).not.toContain('Request a new price in Price oracle before minting.')
	})

	void test('shows zero mint capacity without waiting for an unavailable price', async () => {
		const rendered = await renderIntoDocument(<TradingSection {...createTradingSectionProps({ repPerEthPrice: undefined, selectedPool: createSelectedPool({ totalUnderwritingLimitAttoEth: 0n, feeEligibleUnderwritingLimitAttoEth: 0n }) })} />)
		cleanupRenderedComponent = rendered.cleanup
		expect(document.body.textContent).toContain('No mint capacity remaining.')
		expect(document.body.textContent).not.toContain('Loading mint capacity.')
	})

	void test('uses standing ETH limits independently of the configured UI price', async () => {
		let mintedAmount: string | undefined
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					accountState: createAccountState({ ethBalanceAttoEth: 10n * 10n ** 18n }),
					onTradingFormChange: ({ completeSetAmount }) => {
						if (completeSetAmount !== undefined) mintedAmount = completeSetAmount
					},
					repPerEthPrice: 10n * 10n ** 18n,
					selectedPool: createSelectedPool({ lastOraclePrice: 10n ** 18n, settlementCollateralAttoEth: 0n, totalUnderwritingLimitAttoEth: 10n * 10n ** 18n }),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		await act(() => fireEvent.click(documentQueries.getByRole('button', { name: 'Mint complete sets' })))
		await act(() => {
			const maxButton = documentQueries.getByRole('dialog', { name: 'Mint complete sets' }).querySelector('.field-inline-action')
			if (!(maxButton instanceof HTMLButtonElement)) throw new Error('Expected mint max button')
			fireEvent.click(maxButton)
		})
		expect(mintedAmount).toBe('10')
	})

	void test('keeps minting disabled off Sepolia and explains how to recover after the modal is already open', async () => {
		const renderedComponent = await renderIntoDocument(<TradingSectionNetworkHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Mint complete sets' }))
		})

		let modalQueries = within(documentQueries.getByRole('dialog', { name: 'Mint complete sets' }))
		let mintSubmitButton = modalQueries.getByRole('button', { name: 'Mint complete sets' })
		if (!(mintSubmitButton instanceof HTMLButtonElement)) throw new Error('Expected Mint complete sets transaction button')
		expect(mintSubmitButton.disabled).toBe(false)

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Switch Test Network' }))
		})

		modalQueries = within(documentQueries.getByRole('dialog', { name: 'Mint complete sets' }))
		mintSubmitButton = modalQueries.getByRole('button', { name: 'Mint complete sets' })
		if (!(mintSubmitButton instanceof HTMLButtonElement)) throw new Error('Expected Mint complete sets transaction button after network switch')
		expect(mintSubmitButton.disabled).toBe(true)
		expect(getTransactionButtonState(documentQueries.getByRole('dialog', { name: 'Mint complete sets' }), 'Mint complete sets').reason).toBe('Switch to Sepolia.')
		expect(document.body.textContent?.includes('Switch to Sepolia')).toBe(true)
	})

	void test('keeps minting available beyond question end using the child fee horizon', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={2n}>
				<TradingSection
					{...createTradingSectionProps({
						selectedPool: createSelectedPool({
							currentRetentionRate: 900_000_000_000_000_000n,
							marketDetails: { ...createMarketDetails(), endTime: 1n },
							feeAccrualState: { feeEndTimestamp: 200n, feeIndexRemainder: 0n, lastUpdatedFeeAccumulator: 1n, totalFeesOwedRemainder: 0n },
							settlementCollateralAttoEth: 10n * 10n ** 18n,
							shareTokenSupplyAttoShares: 10n * 10n ** 18n,
							totalUnderwritingLimitAttoEth: 50n * 10n ** 18n,
						}),
						tradingForm: createTradingForm({ completeSetAmount: '1' }),
					})}
				/>
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Mint complete sets' }))
		})

		const dialogElement = within(document.body).getByRole('dialog', { name: 'Mint complete sets' })
		const dialog = within(dialogElement)
		expect(dialog.queryByRole('heading', { name: 'Transaction review' })).toBeNull()
		expect(document.body.querySelector('.transaction-review')).toBeNull()
		expect(dialog.queryByText('You pay')).toBeNull()
		expect(dialog.queryByText('Estimated complete sets received')).toBeNull()
		expect(dialog.queryByText('Estimated holding fee until market end')).toBeNull()
		expect(dialog.getByRole('button', { name: 'Mint complete sets' }).hasAttribute('disabled')).toBe(false)
	})

	void test('shows the minting disabled reason on the launcher when migrated shares have no collateral exchange rate', async () => {
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					selectedPool: createSelectedPool({
						settlementCollateralAttoEth: 0n,
						shareTokenSupplyAttoShares: 10n * 10n ** 18n,
						totalUnderwritingLimitAttoEth: 5n * 10n ** 18n,
						universeHasForked: false,
					}),
					tradingForm: createTradingForm({ completeSetAmount: '1' }),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const mintButton = documentQueries.getByRole('button', { name: 'Mint complete sets' }) as HTMLButtonElement
		expect(mintButton.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Mint complete sets').reason).toBe(UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE)
	})

	void test('shows the complete-set redemption disabled reason on the launcher when the wallet lacks matching shares', async () => {
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					selectedPool: createSelectedPool({ universeHasForked: false }),
					tradingDetails: createTradingDetails({
						maxRedeemableCompleteSetsAttoShares: 0n,
						shareBalances: createShareBalances({
							invalidAttoShares: 0n,
							noAttoShares: 2n * 10n ** 18n,
							yesAttoShares: 2n * 10n ** 18n,
						}),
					}),
					tradingForm: createTradingForm({ redeemAmount: '1' }),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const redeemButton = documentQueries.getByRole('button', { name: 'Redeem complete sets' }) as HTMLButtonElement
		expect(redeemButton.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Redeem complete sets').reason).toBe(NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE)
	})

	void test('shows the share migration disabled reason before the universe forks', async () => {
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					selectedPool: createSelectedPool({ universeHasForked: false }),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const migrateButton = documentQueries.getByRole('button', { name: 'Migrate forked shares' }) as HTMLButtonElement
		expect(migrateButton.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Migrate forked shares').reason).toBe('Available only after this pool forks.')
	})

	void test('opens the migration modal with the shared outcome selector and target picker when migration is available', async () => {
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					selectedPool: createSelectedPool({ universeHasForked: true }),
					tradingForkUniverse: createScalarForkUniverse(),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Migrate forked shares' }))
		})

		const modalQueries = within(documentQueries.getByRole('dialog'))
		const shareOutcomeDropdown = modalQueries.getByRole('button', { name: 'Share outcome to migrate' }) as HTMLButtonElement
		expect(shareOutcomeDropdown.disabled).toBe(false)
		expect(modalQueries.getByText('Target child universes')).not.toBeNull()
	})

	void test('shows the share redemption disabled reason before finalization', async () => {
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					selectedPool: createSelectedPool({ questionOutcome: 'none' }),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const redeemSharesButton = documentQueries.getByRole('button', { name: 'Redeem resolved shares' }) as HTMLButtonElement
		expect(redeemSharesButton.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Redeem resolved shares').reason).toBe('Wait for the selected pool to resolve before redeeming shares.')
	})

	void test('redeems resolved shares directly without a confirmation dialog', async () => {
		const redeem = mock(() => undefined)
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					selectedPool: createSelectedPool({ questionOutcome: 'yes' }),
					onRedeemShares: redeem,
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const launcher = documentQueries.getByRole('button', { name: 'Redeem resolved shares' })
		fireEvent.click(launcher)

		expect(documentQueries.queryByRole('dialog')).toBeNull()
		expect(redeem).toHaveBeenCalledTimes(1)
	})

	void test('blocks minting once the selected market has finalized', async () => {
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					selectedPool: createSelectedPool({ questionOutcome: 'yes' }),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const mintButton = documentQueries.getByRole('button', { name: 'Mint complete sets' }) as HTMLButtonElement
		expect(mintButton.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Mint complete sets').reason).toBe('This market has already finalized.')
	})

	void test('shows mint write failures through the shared error notice', async () => {
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					tradingError: 'Transaction failed. Reason: question already resolved.',
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Mint complete sets' }))
		})

		const modalQueries = within(documentQueries.getByRole('dialog'))
		expect(documentQueries.getByText('Transaction failed. Reason: question already resolved.')).not.toBeNull()
		expect(modalQueries.queryByText('Mint failed')).toBeNull()
	})

	void test('keeps non-suppressed trading guard messages visible in the redeem modal', async () => {
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					loadingTradingDetails: true,
					tradingDetails: undefined,
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const redeemButton = documentQueries.getByRole('button', { name: 'Redeem complete sets' }) as HTMLButtonElement
		expect(redeemButton.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Redeem complete sets').reason).toBe('Loading wallet share balances.')
	})

	void test('keeps scalar share migration interactive through the shared target list and picker', async () => {
		const renderedComponent = await renderIntoDocument(<TradingSectionHarness tradingForkUniverse={createScalarForkUniverse()} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Migrate forked shares' }))
		})

		const modalQueries = within(documentQueries.getByRole('dialog'))
		const slider = modalQueries.getByRole('slider') as HTMLInputElement

		expect(modalQueries.getByText('Select scalar target')).not.toBeNull()
		expect(modalQueries.getByText('No target child universes selected.')).not.toBeNull()
		expect(modalQueries.getByRole('button', { name: 'Add target' })).not.toBeNull()

		await act(() => {
			fireEvent.input(slider, {
				target: { value: '7' },
			})
		})

		expect(modalQueries.getByText('7 / 10')).not.toBeNull()

		await act(() => {
			fireEvent.click(modalQueries.getByRole('button', { name: 'Add target' }))
		})

		expect(modalQueries.queryByText('No target child universes selected.')).toBeNull()
		expect(modalQueries.getByRole('button', { name: 'Remove target' })).not.toBeNull()
	})

	void test('does not render local trading outcome cards for completed action variants', async () => {
		for (const scenario of [
			{ action: 'redeemCompleteSet' as const, title: 'Complete Sets Redeemed' },
			{ action: 'migrateShares' as const, title: 'Shares Migrated' },
			{ action: 'redeemShares' as const, title: 'Resolved Shares Redeemed' },
		] as const) {
			const tradingResult: TradingActionResult = {
				action: scenario.action,
				hash: zeroHash,
				securityPoolAddress: zeroAddress,
				universeId: 1n,
				...(scenario.action === 'migrateShares' ? { shareOutcome: 'yes', targetOutcomeIndexes: [0n, 1n] } : {}),
			} as const

			const renderedComponent = await renderIntoDocument(<TradingSection {...createTradingSectionProps({ tradingResult })} />)
			cleanupRenderedComponent = renderedComponent.cleanup

			const documentQueries = within(document.body)
			expect(documentQueries.queryByText('Latest Share Action')).toBeNull()
			expect(documentQueries.queryByText(scenario.title)).toBeNull()
			expect(documentQueries.queryByRole('button', { name: `Copy address ${zeroAddress}` })).toBeNull()
			expect(document.body.querySelector('.workflow-transaction-status')).toBeNull()

			await renderedComponent.cleanup()
			cleanupRenderedComponent = undefined
		}
	})

	void test('renders security pool address input when enabled and updates it through onTradingFormChange', async () => {
		let nextSecurityPoolAddress: string | undefined
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					onTradingFormChange: ({ securityPoolAddress }) => {
						if (securityPoolAddress !== undefined) {
							nextSecurityPoolAddress = securityPoolAddress
						}
					},
					showSecurityPoolAddressInput: true,
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const input = documentQueries.getByPlaceholderText('0x...')
		expect(input).not.toBeNull()

		await act(() => {
			fireEvent.input(input, { target: { value: '0xabc' } })
		})
		expect(nextSecurityPoolAddress).toBe('0xabc')
	})

	void test('fills the redeem amount from the max helper in the redeem modal', async () => {
		let redeemedAmount: string | undefined
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					onTradingFormChange: ({ redeemAmount }) => {
						if (redeemAmount !== undefined) {
							redeemedAmount = redeemAmount
						}
					},
					tradingDetails: createTradingDetails({
						maxRedeemableCompleteSetsAttoShares: 1n * 10n ** 18n,
					}),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Redeem complete sets' }))
		})

		const modalElement = documentQueries.getByRole('dialog')
		const maxButton = modalElement.querySelector('.field-inline-action') as HTMLButtonElement
		expect(maxButton.disabled).toBe(false)

		await act(() => {
			fireEvent.click(maxButton)
		})

		expect(redeemedAmount).toBe('1')
	})

	void test('lets malformed migration targets be reset and toggled through shared target helpers', async () => {
		const renderedComponent = await renderIntoDocument(
			<TradingSectionWithMutableForm
				tradingForkUniverse={createBinaryForkUniverse()}
				initialTradingForm={{
					targetOutcomeIndexes: 'bad index',
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Migrate forked shares' }))
		})

		const modalQueries = within(documentQueries.getByRole('dialog'))
		const selectAllButton = modalQueries.getByRole('button', { name: 'Select all' }) as HTMLButtonElement
		const clearButton = modalQueries.getByRole('button', { name: 'Clear' }) as HTMLButtonElement
		expect(clearButton.disabled).toBe(true)
		await act(() => {
			fireEvent.click(selectAllButton)
		})
		expect(clearButton.disabled).toBe(false)

		const yesTarget = modalQueries.getByRole('button', { name: /^Yes/ }) as HTMLButtonElement
		expect(yesTarget.getAttribute('aria-pressed')).toBe('true')
		await act(() => {
			fireEvent.click(yesTarget)
		})
		expect(yesTarget.getAttribute('aria-pressed')).toBe('false')
	})
})
