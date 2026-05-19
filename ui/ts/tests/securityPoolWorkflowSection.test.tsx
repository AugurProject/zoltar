/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { zeroAddress } from 'viem'
import { SecurityPoolWorkflowSection } from '../components/SecurityPoolWorkflowSection.js'
import type { AccountState } from '../types/app.js'
import type { ListedSecurityPool, MarketDetails, OracleManagerDetails, SecurityPoolVaultSummary, SecurityVaultDetails } from '../types/contracts.js'
import type { ForkAuctionRouteContentProps, ReportingRouteContentProps, SecurityPoolWorkflowRouteContentProps, SecurityVaultRouteContentProps, TradingRouteContentProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled } from './testUtils/transactionActionButton.js'

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalance: 0n,
		wethBalance: 0n,
		...overrides,
	}
}

function createTradingProps(overrides: Partial<TradingRouteContentProps> = {}): TradingRouteContentProps {
	return {
		accountState: createAccountState(),
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
		selectedPool: undefined,
		tradingActiveAction: undefined,
		tradingDetails: undefined,
		tradingError: undefined,
		tradingForkUniverse: undefined,
		tradingForm: {
			completeSetAmount: '',
			redeemAmount: '',
			securityPoolAddress: '',
			selectedShareOutcome: 'yes',
			targetOutcomeIndexes: '',
		},
		tradingResult: undefined,
		...overrides,
	}
}

function createReportingProps(overrides: Partial<ReportingRouteContentProps> = {}): ReportingRouteContentProps {
	return {
		accountState: createAccountState(),
		loadingReportingDetails: false,
		onLoadReporting: () => undefined,
		onReportOutcome: () => undefined,
		onReportingFormChange: () => undefined,
		onWithdrawEscalation: () => undefined,
		reportingActiveAction: undefined,
		reportingDetails: undefined,
		reportingError: undefined,
		reportingForm: {
			reportAmount: '',
			securityPoolAddress: '',
			selectedOutcome: 'yes',
			withdrawDepositIndexes: '',
		},
		reportingResult: undefined,
		...overrides,
	}
}

function createSecurityVaultProps(overrides: Partial<SecurityVaultRouteContentProps> = {}): SecurityVaultRouteContentProps {
	return {
		accountState: createAccountState(),
		loadingSecurityVault: false,
		onApproveRep: () => undefined,
		onDepositRep: () => undefined,
		onLoadSecurityVault: () => undefined,
		onRedeemFees: () => undefined,
		onSetSecurityBondAllowance: () => undefined,
		onSecurityVaultFormChange: () => undefined,
		onWithdrawRep: () => undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		securityPoolVaults: undefined,
		securityVaultActiveAction: undefined,
		securityVaultDetails: undefined,
		securityVaultError: undefined,
		securityVaultForm: {
			depositAmount: '',
			repWithdrawAmount: '',
			securityBondAllowanceAmount: '',
			securityPoolAddress: '',
			selectedVaultAddress: '',
		},
		securityVaultMissing: false,
		securityVaultRepApproval: {
			error: undefined,
			loading: false,
			value: 0n,
		},
		securityVaultRepBalance: undefined,
		securityVaultResult: undefined,
		selectedPoolSecurityMultiplier: undefined,
		...overrides,
	}
}

function createSecurityVaultDetails(overrides: Partial<SecurityVaultDetails> = {}): SecurityVaultDetails {
	return {
		currentRetentionRate: 10n,
		lockedRepInEscalationGame: 0n,
		managerAddress: zeroAddress,
		poolOwnershipDenominator: 1n,
		repDepositShare: 5n * 10n ** 18n,
		repToken: zeroAddress,
		securityBondAllowance: 2n * 10n ** 18n,
		securityPoolAddress: zeroAddress,
		totalSecurityBondAllowance: 3n * 10n ** 18n,
		unpaidEthFees: 1n * 10n ** 18n,
		universeId: 1n,
		vaultAddress: zeroAddress,
		...overrides,
	}
}

function createOracleManagerDetails(overrides: Partial<OracleManagerDetails> = {}): OracleManagerDetails {
	return {
		callbackStateHash: undefined,
		exactToken1Report: undefined,
		isPriceValid: true,
		lastPrice: 1n,
		lastSettlementTimestamp: 1n,
		managerAddress: zeroAddress,
		openOracleAddress: zeroAddress,
		pendingOperation: undefined,
		pendingOperationSlotId: 0n,
		pendingReportId: 0n,
		priceValidUntilTimestamp: 1000n,
		requestPriceEthCost: 1n,
		token1: zeroAddress,
		token2: zeroAddress,
		...overrides,
	}
}

function createSecurityPoolVaultSummary(overrides: Partial<SecurityPoolVaultSummary> = {}): SecurityPoolVaultSummary {
	return {
		lockedRepInEscalationGame: 1n * 10n ** 18n,
		repDepositShare: 5n * 10n ** 18n,
		securityBondAllowance: 2n * 10n ** 18n,
		unpaidEthFees: 1n * 10n ** 18n,
		vaultAddress: zeroAddress,
		...overrides,
	}
}

function createForkAuctionProps(overrides: Partial<ForkAuctionRouteContentProps> = {}): ForkAuctionRouteContentProps {
	return {
		accountState: createAccountState(),
		forkAuctionActiveAction: undefined,
		forkAuctionDetails: undefined,
		forkAuctionError: undefined,
		forkAuctionForm: {
			claimBidIndex: '',
			claimBidTick: '',
			depositIndexes: '',
			directForkQuestionId: '',
			directForkUniverseId: '',
			refundBidIndex: '',
			refundTick: '',
			repMigrationOutcomes: '',
			securityPoolAddress: '',
			selectedOutcome: 'yes',
			submitBidAmount: '',
			submitBidTick: '',
			vaultAddress: '',
			withdrawBidIndex: '',
			withdrawForAddress: '',
			withdrawTick: '',
		},
		forkAuctionResult: undefined,
		loadingForkAuctionDetails: false,
		onClaimAuctionProceeds: () => undefined,
		onCreateChildUniverse: () => undefined,
		onFinalizeTruthAuction: () => undefined,
		onForkAuctionFormChange: () => undefined,
		onForkUniverse: () => undefined,
		onForkWithOwnEscalation: () => undefined,
		onInitiateFork: () => undefined,
		onLoadForkAuction: () => undefined,
		onMigrateEscalationDeposits: () => undefined,
		onMigrateRepToZoltar: () => undefined,
		onMigrateVault: () => undefined,
		onRefundLosingBids: () => undefined,
		onStartTruthAuction: () => undefined,
		onSubmitBid: () => undefined,
		onWithdrawBids: () => undefined,
		...overrides,
	}
}

function createMarketDetails(overrides: Partial<MarketDetails> = {}): MarketDetails {
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
		...overrides,
	}
}

function createSelectedPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	return {
		completeSetCollateralAmount: 0n,
		currentRetentionRate: 10n,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		lastOraclePrice: undefined,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedRep: 0n,
		parent: zeroAddress,
		questionOutcome: 'yes',
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
}

function createSecurityPoolWorkflowProps(overrides: Partial<SecurityPoolWorkflowRouteContentProps> = {}): SecurityPoolWorkflowRouteContentProps {
	return {
		accountState: createAccountState(),
		activeUniverseId: 1n,
		checkedSecurityPoolAddress: undefined,
		closeLiquidationModal: () => undefined,
		forkAuction: createForkAuctionProps(),
		liquidationAmount: '',
		liquidationMaxAmount: undefined,
		liquidationManagerAddress: undefined,
		liquidationModalOpen: false,
		liquidationSecurityPoolAddress: undefined,
		liquidationTargetVault: '',
		loadingPoolOracleManager: false,
		loadingSecurityPools: false,
		onLiquidationAmountChange: () => undefined,
		onLoadPoolOracleManager: () => undefined,
		onOpenLiquidationModal: () => undefined,
		onQueueLiquidation: () => undefined,
		onExecutePendingPoolOperation: () => undefined,
		onRefreshSelectedPoolData: () => undefined,
		onRequestPoolPrice: () => undefined,
		onSelectedPoolViewChange: () => undefined,
		onSecurityPoolAddressChange: () => undefined,
		onViewPendingReport: () => undefined,
		poolOracleActiveAction: undefined,
		poolOracleManagerDetails: undefined,
		poolOracleManagerError: undefined,
		poolPriceOracleResult: undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		reporting: createReportingProps(),
		selectedPoolView: '',
		securityPoolAddress: '',
		securityPoolOverviewActiveAction: undefined,
		securityPoolOverviewResult: undefined,
		securityPools: [],
		securityVault: createSecurityVaultProps(),
		trading: createTradingProps(),
		...overrides,
	}
}

describe('SecurityPoolWorkflowSection', () => {
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

	test('keeps the workflow rail visible with disabled items before a pool loads', async () => {
		const renderedComponent = await renderIntoDocument(<SecurityPoolWorkflowSection {...createSecurityPoolWorkflowProps()} showHeader={false} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('tablist', { name: 'Selected pool views' })).not.toBeNull()

		for (const label of ['Vaults', 'Trading', 'Reporting', 'Fork', 'Staged Operations', 'Open Oracle']) {
			const button = documentQueries.getByRole('tab', { name: label }) as HTMLButtonElement
			expect(button.disabled).toBe(true)
			expect(button.title).toBe('Load a pool to open this workflow.')
		}

		expect(documentQueries.getByRole('heading', { name: 'Pool Workflows' })).not.toBeNull()
		expect(documentQueries.getByText('No pool selected.')).not.toBeNull()
		expect(documentQueries.queryByText('Paste a security pool address or browse pools.')).toBeNull()
		expect(documentQueries.queryByText('Locked')).toBeNull()
	})

	test('shows a pool not found card when the selected address does not resolve', async () => {
		const missingAddress = '0x00000000000000000000000000000000000000ab'
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: missingAddress,
					securityPoolAddress: missingAddress,
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Pool not found' })).not.toBeNull()
		expect(documentQueries.getByText('This security pool address was not found.')).not.toBeNull()
	})

	test('renders a vault workspace header and local mode switch for a loaded pool', async () => {
		const poolVault = createSecurityPoolVaultSummary()
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					securityPoolAddress: zeroAddress,
					securityPools: [
						createSelectedPool({
							vaultCount: 1n,
							vaults: [poolVault],
						}),
					],
					securityVault: createSecurityVaultProps({
						selectedPoolSecurityMultiplier: 2n,
						securityVaultDetails: createSecurityVaultDetails({ vaultAddress: poolVault.vaultAddress }),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: zeroAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Security pools' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Pool Summary' })).toBeNull()
		expect(documentQueries.queryByText('Action Readiness')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Open Oracle' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Selected Pool Summary' })).toBeNull()
		expect(documentQueries.queryByText('Workflow')).toBeNull()
		expect(documentQueries.getByText('Question description')).not.toBeNull()
		expect(documentQueries.getByText('Total REP Deposited')).not.toBeNull()
		expect(documentQueries.getByText('Open Oracle Price')).not.toBeNull()
		expect(documentQueries.queryByText('Oracle Expires In')).toBeNull()
		const selectedPoolContext = document.body.querySelector('.sticky-object-context.static')
		if (!(selectedPoolContext instanceof HTMLElement)) {
			throw new Error('Expected a non-sticky selected pool context card')
		}
		const lookupLabel = within(selectedPoolContext).getByText('Security Pool Address')
		const firstSummaryMetric = within(selectedPoolContext).getByText('Total REP Deposited')
		const lookupPosition = selectedPoolContext.textContent?.indexOf(lookupLabel.textContent ?? '') ?? -1
		const summaryPosition = selectedPoolContext.textContent?.indexOf(firstSummaryMetric.textContent ?? '') ?? -1
		expect(lookupPosition).toBeGreaterThanOrEqual(0)
		expect(summaryPosition).toBeGreaterThanOrEqual(0)
		expect(lookupPosition < summaryPosition).toBe(true)
		expect(documentQueries.getByRole('heading', { name: 'Vault Operations' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Vault Lookup' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Vault Summary' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Selected Vault' })).toBeNull()
		expect(documentQueries.getByText('Selected Vault Address')).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Vault Action Launchers' })).not.toBeNull()
		expect(documentQueries.getByRole('tab', { name: 'Staged Operations' })).not.toBeNull()
		expect(documentQueries.getByRole('tab', { name: 'Open Oracle' })).not.toBeNull()
		expect(documentQueries.getAllByRole('button', { name: 'Claim Fees' }).length).toBeGreaterThan(0)
		expect(documentQueries.getAllByText('Approved REP').length).toBeGreaterThan(0)
		expect(documentQueries.queryByText('Enter a deposit amount greater than zero.')).toBeNull()
		expect(documentQueries.queryByText('Fork Flow')).toBeNull()
		expect(documentQueries.queryByText(/^Blocked:/)).toBeNull()
		expect(documentQueries.queryByText('Oracle Status')).toBeNull()
		expect(documentQueries.queryByText('After market end')).toBeNull()
		expect(documentQueries.queryByText('Manager')).toBeNull()
		expect(documentQueries.queryByText('Truth Auction')).toBeNull()
		expect(documentQueries.getByText('Security Multiplier')).not.toBeNull()
		const directoryButton = documentQueries.getByRole('tab', { name: 'Directory' })
		expect(documentQueries.getByRole('tab', { name: 'Selected' })).not.toBeNull()

		await act(() => {
			fireEvent.click(directoryButton)
		})

		expect(documentQueries.getByRole('heading', { name: 'Vault Directory' })).not.toBeNull()
		expect(documentQueries.getAllByText('Locked REP').length).toBeGreaterThan(0)
	})

	test('auto-loads the selected vault when a routed pool opens in the vault view', async () => {
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					checkedSecurityPoolAddress: selectedPoolAddress,
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: selectedPoolAddress,
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(loadSecurityVaultCalls).toEqual([undefined])
	})

	test('does not auto-load the selected vault until the vault form has the selected pool address', async () => {
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					checkedSecurityPoolAddress: selectedPoolAddress,
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: '',
							selectedVaultAddress: selectedPoolAddress,
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(loadSecurityVaultCalls).toEqual([])
	})

	test('refreshes staged operations after queueing a vault withdrawal', async () => {
		const loadPoolOracleManagerCalls: string[] = []
		const selectedPoolAddress = zeroAddress
		const managerAddress = '0x00000000000000000000000000000000000000aa'
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					onLoadPoolOracleManager: managerAddressInput => {
						loadPoolOracleManagerCalls.push(managerAddressInput)
					},
					poolOracleManagerDetails: createOracleManagerDetails({ managerAddress }),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ managerAddress, securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultResult: {
							action: 'queueWithdrawRep',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000bb',
							stagedExecution: {
								errorMessage: undefined,
								operation: 'withdrawRep',
								operationId: 7n,
								success: true,
							},
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(loadPoolOracleManagerCalls).toEqual([managerAddress])
	})

	test('keeps the withdraw modal open and links to the queued staged operation', async () => {
		const selectedViews: string[] = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					onSelectedPoolViewChange: view => {
						selectedViews.push(view ?? '')
					},
					poolOracleManagerDetails: createOracleManagerDetails({
						pendingOperation: {
							amount: 5n * 10n ** 18n,
							initiatorVault: zeroAddress,
							operation: 'withdrawRep',
							operationId: 7n,
							targetVault: zeroAddress,
						},
						pendingOperationSlotId: 7n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails(),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
						securityVaultResult: {
							action: 'queueWithdrawRep',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000bb',
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)

		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
		})

		const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
		const dialogQueries = within(withdrawDialog)
		expect(dialogQueries.getByRole('heading', { name: 'REP Withdrawal Queued' })).not.toBeNull()
		expect(dialogQueries.getByText('#7')).not.toBeNull()

		await act(() => {
			fireEvent.click(dialogQueries.getByRole('button', { name: 'View In Staged Operations' }))
		})

		expect(selectedViews).toEqual(['staged-operations'])
		expect(dialogQueries.getByRole('heading', { name: 'Withdraw REP' })).not.toBeNull()
		expect(dialogQueries.getByRole('heading', { name: 'REP Withdrawal Queued' })).not.toBeNull()
	})

	test('shows immediate execution when a withdraw uses an already valid oracle price', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						pendingOperation: undefined,
						pendingOperationSlotId: 0n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails(),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
						securityVaultResult: {
							action: 'queueWithdrawRep',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000bb',
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
		})

		const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
		const dialogQueries = within(withdrawDialog)
		expect(dialogQueries.getByRole('heading', { name: 'REP Withdrawal Executed' })).not.toBeNull()
		expect(dialogQueries.queryByRole('button', { name: 'View In Staged Operations' })).toBeNull()
		expect(dialogQueries.getByText('A valid oracle price was already available, so the withdrawal executed immediately and no staged operation was created.')).not.toBeNull()
	})

	test('shows withdraw failure details when the staged execution event reports a rejection', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						pendingOperation: undefined,
						pendingOperationSlotId: 0n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails(),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '10000',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
						securityVaultResult: {
							action: 'queueWithdrawRep',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000be',
							stagedExecution: {
								errorMessage: 'Local Security Bond Allowance broken',
								operation: 'withdrawRep',
								operationId: 8n,
								success: false,
							},
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
		})

		const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
		const dialogQueries = within(withdrawDialog)
		expect(dialogQueries.getByRole('heading', { name: 'REP Withdrawal Failed' })).not.toBeNull()
		expect(dialogQueries.getByText('Local Security Bond Allowance broken')).not.toBeNull()
		expect(dialogQueries.queryByRole('button', { name: 'View In Staged Operations' })).toBeNull()
	})

	test('refreshes the selected pool and loaded vault after an immediate REP withdrawal execution', async () => {
		const refreshSelectedPoolCalls: Array<string | undefined> = []
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					onRefreshSelectedPoolData: securityPoolAddressInput => {
						refreshSelectedPoolCalls.push(securityPoolAddressInput)
					},
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						pendingOperation: undefined,
						pendingOperationSlotId: 0n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
						securityVaultResult: {
							action: 'queueWithdrawRep',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000dd',
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
		expect(loadSecurityVaultCalls).toEqual([undefined])
	})

	test('refreshes the selected pool and loaded vault after executing a staged operation', async () => {
		const refreshSelectedPoolCalls: Array<string | undefined> = []
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					onRefreshSelectedPoolData: securityPoolAddressInput => {
						refreshSelectedPoolCalls.push(securityPoolAddressInput)
					},
					poolPriceOracleResult: {
						action: 'executeStagedOperation',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000cc',
					},
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
		expect(loadSecurityVaultCalls).toEqual([undefined])
	})

	test('does not refresh the selected pool after a failed staged operation execution and shows the failure reason in staged operations', async () => {
		const refreshSelectedPoolCalls: Array<string | undefined> = []
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					onRefreshSelectedPoolData: securityPoolAddressInput => {
						refreshSelectedPoolCalls.push(securityPoolAddressInput)
					},
					poolPriceOracleResult: {
						action: 'executeStagedOperation',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000ce',
						stagedExecution: {
							errorMessage: 'Local Security Bond Allowance broken',
							operation: 'withdrawRep',
							operationId: 12n,
							success: false,
						},
					},
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'staged-operations',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(refreshSelectedPoolCalls).toEqual([])
		expect(loadSecurityVaultCalls).toEqual([])
		expect(within(document.body).getByText('Local Security Bond Allowance broken')).not.toBeNull()
	})

	test('keeps vault launcher buttons disabled until a selected vault is loaded', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					securityVault: createSecurityVaultProps({
						securityVaultForm: {
							depositAmount: '10',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '1',
							securityPoolAddress: zeroAddress,
							selectedVaultAddress: '',
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Deposit REP', 'Refresh the selected vault first.')
		expectTransactionButtonDisabled(document.body, 'Withdraw REP', 'Refresh the selected vault first.')
		expectTransactionButtonDisabled(document.body, 'Set Bond Allowance', 'Refresh the selected vault first.')
		expectTransactionButtonDisabled(document.body, 'Claim Fees', 'Refresh the selected vault first.')
	})

	test('caps REP withdrawals to the oracle-backed amount in the seeded security-pool shape', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						lastPrice: 3n * 10n ** 18n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							managerAddress: zeroAddress,
							securityPoolAddress: selectedPoolAddress,
							totalRepDeposit: 10_000n * 10n ** 18n,
							totalSecurityBondAllowance: 2_500n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails({
							repDepositShare: 10_000n * 10n ** 18n,
							securityBondAllowance: 2_500n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '10000',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
		})

		const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
		expectTransactionButtonDisabled(withdrawDialog as HTMLElement, 'Withdraw REP', 'Reduce the withdrawal to 2 500 REP or less.')
	})

	test('fills the set bond allowance input from the backed Max amount', async () => {
		const selectedPoolAddress = zeroAddress
		const formChanges: Array<{ securityBondAllowanceAmount?: string }> = []
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						lastPrice: 3n * 10n ** 18n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							managerAddress: zeroAddress,
							securityPoolAddress: selectedPoolAddress,
							totalRepDeposit: 9n * 10n ** 18n,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						onSecurityVaultFormChange: update => {
							formChanges.push(update)
						},
						securityVaultDetails: createSecurityVaultDetails({
							repDepositShare: 12n * 10n ** 18n,
							securityBondAllowance: 1n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Set Bond Allowance' })[0] as HTMLElement)
		})

		const allowanceDialog = documentQueries.getByRole('dialog', { name: 'Set Bond Allowance' })
		await act(() => {
			fireEvent.click(within(allowanceDialog).getByRole('button', { name: 'Security Bond Allowance Amount' }))
		})

		expect(formChanges.at(-1)).toEqual({ securityBondAllowanceAmount: '1.999999999999999999' })
	})

	test('hides the truth auction metric when the selected pool has no truth auction address', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					activeUniverseId: 1n,
					checkedSecurityPoolAddress: zeroAddress,
					securityPoolAddress: zeroAddress,
					securityPools: [
						createSelectedPool({
							systemState: 'poolForked',
							truthAuctionAddress: zeroAddress,
						}),
					],
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Truth Auction')).toBeNull()
	})

	test('shows disabled reporting actions before market end instead of a placeholder message', async () => {
		const futureMarket = createMarketDetails({ endTime: BigInt(Math.floor(Date.now() / 1000) + 3600) })
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool({ marketDetails: futureMarket })],
					selectedPoolView: 'reporting',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Reporting Context' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Report Outcome' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Withdraw Escalation Deposits' })).not.toBeNull()
		expect(documentQueries.queryByText('Reporting unlocks after the market end timestamp for the selected pool.')).toBeNull()
		expect(documentQueries.queryByText('Reporting opens after market end.')).toBeNull()

		const reportButton = documentQueries.getByRole('button', { name: 'Report / Contribute On Selected Side' }) as HTMLButtonElement
		expect(reportButton.disabled).toBe(true)
		expect(reportButton.title).toBe('Reporting opens after market end.')
	})

	test('renders staged operations management inside the staged operations tab instead of a standalone section', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					poolOracleManagerDetails: {
						callbackStateHash: undefined,
						exactToken1Report: undefined,
						isPriceValid: true,
						lastPrice: 2n * 10n ** 18n,
						lastSettlementTimestamp: 100n,
						managerAddress: zeroAddress,
						openOracleAddress: zeroAddress,
						pendingOperation: undefined,
						pendingOperationSlotId: 0n,
						pendingReportId: 0n,
						priceValidUntilTimestamp: 1000n,
						requestPriceEthCost: 1n,
						token1: zeroAddress,
						token2: zeroAddress,
					},
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'staged-operations',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('tab', { name: 'Staged Operations' }) as HTMLElement).getAttribute('aria-selected')).toBe('true')
		expect(documentQueries.getByRole('heading', { name: 'Staged Operations' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Pool Oracle & Pending Operations' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Staged Operations List' })).not.toBeNull()
		expect(documentQueries.getByText('No staged operations are currently queued for this pool.')).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Request New Price' })).toBeNull()
	})

	test('lists staged operations in the staged operations tab', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					poolOracleManagerDetails: {
						callbackStateHash: undefined,
						exactToken1Report: undefined,
						isPriceValid: true,
						lastPrice: 2n * 10n ** 18n,
						lastSettlementTimestamp: 100n,
						managerAddress: zeroAddress,
						openOracleAddress: zeroAddress,
						pendingOperation: {
							amount: 5n * 10n ** 18n,
							initiatorVault: zeroAddress,
							operation: 'withdrawRep',
							operationId: 7n,
							targetVault: zeroAddress,
						},
						pendingOperationSlotId: 7n,
						pendingReportId: 12n,
						priceValidUntilTimestamp: 1000n,
						requestPriceEthCost: 1n,
						token1: zeroAddress,
						token2: zeroAddress,
					},
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'staged-operations',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Withdraw REP')).not.toBeNull()
		expect(documentQueries.getByText('7')).not.toBeNull()
		expect(documentQueries.queryByText('Pending Price Request')).toBeNull()
	})

	test('renders price oracle details and request controls in the price oracle tab', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					poolOracleManagerDetails: {
						callbackStateHash: undefined,
						exactToken1Report: undefined,
						isPriceValid: true,
						lastPrice: 2n * 10n ** 18n,
						lastSettlementTimestamp: 100n,
						managerAddress: zeroAddress,
						openOracleAddress: zeroAddress,
						pendingOperation: undefined,
						pendingOperationSlotId: 0n,
						pendingReportId: 12n,
						priceValidUntilTimestamp: 1000n,
						requestPriceEthCost: 1n,
						token1: zeroAddress,
						token2: zeroAddress,
					},
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'price-oracle',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('tab', { name: 'Open Oracle' }) as HTMLElement).getAttribute('aria-selected')).toBe('true')
		const priceOracleSection = documentQueries.getByRole('heading', { name: 'Open Oracle' }).closest('section')
		if (!(priceOracleSection instanceof HTMLElement)) {
			throw new Error('Expected the Open Oracle section to render')
		}
		const sectionQueries = within(priceOracleSection)
		expect(sectionQueries.getByRole('heading', { name: 'Open Oracle' })).not.toBeNull()
		expect(sectionQueries.getByText('Open Oracle Price')).not.toBeNull()
		expect(sectionQueries.queryByText('Price Window')).toBeNull()
		expect(sectionQueries.queryByText('Last Settlement')).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Request New Price' })).not.toBeNull()
		expect(sectionQueries.getByText('Pending Request')).not.toBeNull()
		expect(sectionQueries.getByRole('button', { name: /Report #\s*12/ })).not.toBeNull()
	})

	test('uses the lifted selected pool view state and reports tab changes through the shared setter', async () => {
		const selectedViews: string[] = []
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					onSelectedPoolViewChange: view => {
						selectedViews.push(view ?? '')
					},
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'reporting',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('tab', { name: 'Reporting' }) as HTMLElement).getAttribute('aria-selected')).toBe('true')

		await act(() => {
			fireEvent.click(documentQueries.getByRole('tab', { name: 'Staged Operations' }))
		})

		expect(selectedViews).toEqual(['staged-operations'])
	})

	test('retries reporting autoload on rerender until matching details are available', async () => {
		let reportingLoadCalls = 0
		const baseProps = createSecurityPoolWorkflowProps({
			checkedSecurityPoolAddress: zeroAddress,
			reporting: createReportingProps({
				onLoadReporting: () => {
					reportingLoadCalls += 1
				},
			}),
			securityPoolAddress: zeroAddress,
			securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 0n }) })],
			selectedPoolView: 'reporting',
		})

		const renderedComponent = await renderIntoDocument(<SecurityPoolWorkflowSection {...baseProps} showHeader={false} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(reportingLoadCalls).toBe(1)

		await act(async () => {
			render(
				<SecurityPoolWorkflowSection
					{...baseProps}
					reporting={createReportingProps({
						onLoadReporting: () => {
							reportingLoadCalls += 1
						},
					})}
					showHeader={false}
				/>,
				renderedComponent.container,
			)
		})

		expect(reportingLoadCalls).toBe(2)
	})

	test('retries fork autoload on rerender until matching details are available', async () => {
		let forkLoadCalls = 0
		const baseProps = createSecurityPoolWorkflowProps({
			checkedSecurityPoolAddress: zeroAddress,
			forkAuction: createForkAuctionProps({
				onLoadForkAuction: () => {
					forkLoadCalls += 1
				},
			}),
			securityPoolAddress: zeroAddress,
			securityPools: [createSelectedPool()],
			selectedPoolView: 'fork',
		})

		const renderedComponent = await renderIntoDocument(<SecurityPoolWorkflowSection {...baseProps} showHeader={false} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(forkLoadCalls).toBe(1)

		await act(async () => {
			render(
				<SecurityPoolWorkflowSection
					{...baseProps}
					forkAuction={createForkAuctionProps({
						onLoadForkAuction: () => {
							forkLoadCalls += 1
						},
					})}
					showHeader={false}
				/>,
				renderedComponent.container,
			)
		})

		expect(forkLoadCalls).toBe(2)
	})
})
