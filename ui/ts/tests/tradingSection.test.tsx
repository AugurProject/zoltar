/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { zeroAddress, zeroHash } from 'viem'
import { TradingSection } from '../components/TradingSection.js'
import { deriveHasForkActivity } from '../lib/forkAuction.js'
import { NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE, NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE } from '../lib/trading.js'
import type { AccountState, TradingFormState } from '../types/app.js'
import type { ListedSecurityPool, MarketDetails, TradingActionResult, TradingDetails, TradingShareBalances, ZoltarUniverseSummary } from '../types/contracts.js'
import type { TradingSectionProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function createMarketDetails(): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Question description',
		displayValueMax: 100n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId: '0x01',
		startTime: 1n,
		title: 'Will this resolve?',
	}
}

function createSelectedPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	const selectedPool: ListedSecurityPool = {
		completeSetCollateralAmount: 0n,
		currentRetentionRate: 10n,
		hasForkActivity: false,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		lastOraclePrice: undefined,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedRep: 0n,
		parent: zeroAddress,
		questionOutcome: 'none',
		questionId: '0x01',
		securityMultiplier: 2n,
		securityPoolAddress: zeroAddress,
		systemState: 'operational',
		totalRepDeposit: 0n,
		totalSecurityBondAllowance: 5n * 10n ** 18n,
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
		invalid: 2n * 10n ** 18n,
		no: 4n * 10n ** 18n,
		yes: 3n * 10n ** 18n,
		...overrides,
	}
}

function createTradingDetails(overrides: Partial<TradingDetails> = {}): TradingDetails {
	const shareBalances = createShareBalances()
	return {
		maxRedeemableCompleteSets: 2n * 10n ** 18n,
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
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalance: 10n * 10n ** 18n,
		wethBalance: 0n,
		...overrides,
	}
}

function createTradingSectionProps(overrides: Partial<TradingSectionProps> = {}): TradingSectionProps {
	return {
		accountState: createAccountState(),
		embedInCard: true,
		loadingTradingForkUniverse: false,
		loadingTradingDetails: false,
		onCreateCompleteSet: () => undefined,
		onMigrateShares: () => undefined,
		onRedeemCompleteSet: () => undefined,
		onRedeemShares: () => undefined,
		onTradingFormChange: () => undefined,
		repPerEthPrice: undefined,
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
		forkThreshold: 0n,
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
		totalTheoreticalSupply: 0n,
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
		forkThreshold: 0n,
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
		totalTheoreticalSupply: 0n,
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

void describe('TradingSection', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	void test('renames the max complete sets metric to total complete sets', async () => {
		const renderedComponent = await renderIntoDocument(<TradingSection {...createTradingSectionProps()} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Total Complete Sets')).not.toBeNull()
		expect(documentQueries.queryByText('Max Complete Sets')).toBeNull()
	})

	void test('renders trading content without the workflow strip and launches complete-set actions from the share summary', async () => {
		const renderedComponent = await renderIntoDocument(<TradingSection {...createTradingSectionProps({ embedInCard: false, showHeader: false })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Trading Workflow')).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Your Shares' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Trading Action Launchers' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Mint Complete Sets' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Redeem Complete Sets' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Mint complete sets' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Redeem complete sets' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Migrate Forked Shares' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Redeem Resolved Shares' })).not.toBeNull()
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
		expect(documentQueries.queryByRole('heading', { name: 'Latest Trading Action' })).toBeNull()
		expect(documentQueries.queryByText('Complete Sets Minted')).toBeNull()
		expect(documentQueries.queryByRole('button', { name: `Copy address ${poolAddress}` })).toBeNull()
		expect(document.body.querySelector('.workflow-transaction-status')).toBeNull()
	})

	void test('renders your share metrics using rounded values with exact copy affordances', async () => {
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					tradingDetails: createTradingDetails({
						maxRedeemableCompleteSets: 410000000000000n,
						shareBalances: createShareBalances({
							invalid: 410000000000000n,
							no: 23000000000000000n,
							yes: 1234000000000000000n,
						}),
					}),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getAllByText('≈ 1.23').length).toBeGreaterThan(0)
		expect(documentQueries.getAllByText('≈ 0.023').length).toBeGreaterThan(0)
		expect(documentQueries.getAllByText('≈ 0.00041').length).toBeGreaterThanOrEqual(2)
		expect(documentQueries.getAllByRole('button', { name: 'Copy exact value 1.234' }).length).toBeGreaterThan(0)
		expect(documentQueries.getAllByRole('button', { name: 'Copy exact value 0.023' }).length).toBeGreaterThan(0)
		expect(documentQueries.getAllByRole('button', { name: 'Copy exact value 0.00041' }).length).toBeGreaterThanOrEqual(2)
	})

	void test('shows the minting disabled reason on the launcher when the pool has no active allowance', async () => {
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					selectedPool: createSelectedPool({
						completeSetCollateralAmount: 0n,
						totalRepDeposit: 20n * 10n ** 18n,
						totalSecurityBondAllowance: 0n,
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
		expect(mintButton.title).toBe(NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE)
	})

	void test('shows the complete-set redemption disabled reason on the launcher when the wallet lacks matching shares', async () => {
		const renderedComponent = await renderIntoDocument(
			<TradingSection
				{...createTradingSectionProps({
					selectedPool: createSelectedPool({ universeHasForked: false }),
					tradingDetails: createTradingDetails({
						maxRedeemableCompleteSets: 0n,
						shareBalances: createShareBalances({
							invalid: 0n,
							no: 2n * 10n ** 18n,
							yes: 2n * 10n ** 18n,
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
		expect(redeemButton.title).toBe(NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE)
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
		expect(migrateButton.title).toBe('')
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
		const shareOutcomeDropdown = modalQueries.getByRole('button', { name: 'Share Outcome To Migrate' }) as HTMLButtonElement
		expect(shareOutcomeDropdown.disabled).toBe(false)
		expect(modalQueries.getByText('Target Child Universes')).not.toBeNull()
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
		expect(redeemSharesButton.title).toBe('')
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
		expect(mintButton.title).toBe('')
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
		expect(redeemButton.title).toBe('Loading wallet share balances.')
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

		expect(modalQueries.getByText('Select Scalar Target')).not.toBeNull()
		expect(modalQueries.getByText('Select at least one scalar target universe.')).not.toBeNull()
		expect(modalQueries.getByRole('button', { name: 'Add Target' })).not.toBeNull()

		await act(() => {
			fireEvent.input(slider, {
				target: { value: '7' },
			})
		})

		expect(modalQueries.getByText('7 / 10')).not.toBeNull()

		await act(() => {
			fireEvent.click(modalQueries.getByRole('button', { name: 'Add Target' }))
		})

		expect(modalQueries.queryByText('Select at least one scalar target universe.')).toBeNull()
		expect(modalQueries.getByRole('button', { name: 'Remove Target' })).not.toBeNull()
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
			expect(documentQueries.queryByText('Latest Trading Action')).toBeNull()
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
						maxRedeemableCompleteSets: 1n * 10n ** 18n,
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
