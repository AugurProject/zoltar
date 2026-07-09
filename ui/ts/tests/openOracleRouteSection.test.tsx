/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from './testUtils/queries'
import { h } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { OpenOracleSection } from '../components/OpenOracleSection.js'
import { ChainBlockNumberContext, ChainTimestampContext } from '../lib/chainTimestamp.js'
import { getDefaultOpenOracleCreateFormState, getDefaultOpenOracleFormState } from '../lib/marketForm.js'
import { deriveOpenOracleDisputeSubmissionDetails, deriveOpenOracleInitialReportSubmissionDetails } from '../lib/openOracle.js'
import type { AccountState } from '../types/app.js'
import type { OpenOracleSectionProps } from '../types/components.js'
import type { OpenOracleReportDetails } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from './testUtils/transactionActionButton.js'
import { UI_STRINGS } from '../lib/uiStrings.js'

const ETH = 10n ** 18n

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalance: 0n,
		wethBalance: 0n,
		...overrides,
	}
}

function createOpenOracleSectionProps(overrides: Partial<OpenOracleSectionProps> = {}): OpenOracleSectionProps {
	const openOracleCreateForm = overrides.openOracleCreateForm ?? getDefaultOpenOracleCreateFormState()
	const openOracleForm = overrides.openOracleForm ?? getDefaultOpenOracleFormState()
	const openOracleInitialReportState = overrides.openOracleInitialReportState ?? {
		defaultPrice: undefined,
		defaultPriceError: undefined,
		defaultPriceSource: undefined,
		defaultPriceSourceUrl: undefined,
		ethBalance: undefined,
		ethBalanceError: undefined,
		quoteAttemptedSources: undefined,
		quoteFailureKind: undefined,
		quoteFailureReason: undefined,
		quoteLoading: false,
		token1Approval: { error: undefined, loading: false, value: 0n },
		token1Balance: undefined,
		token1BalanceError: undefined,
		token1Decimals: undefined,
		token2Approval: { error: undefined, loading: false, value: 0n },
		token2Balance: undefined,
		token2BalanceError: undefined,
		token2Decimals: undefined,
		tokenAccessLoadingInitial: false,
		tokenAccessRefreshing: false,
	}
	const openOracleReportDetails = overrides.openOracleReportDetails
	const openOracleInitialReportSubmission =
		overrides.openOracleInitialReportSubmission ??
		(openOracleReportDetails === undefined
			? undefined
			: deriveOpenOracleInitialReportSubmissionDetails({
					approvedToken1Amount: openOracleInitialReportState.token1Approval.value,
					approvedToken2Amount: openOracleInitialReportState.token2Approval.value,
					defaultPrice: openOracleInitialReportState.defaultPrice,
					defaultPriceError: openOracleInitialReportState.defaultPriceError,
					defaultPriceSource: openOracleInitialReportState.defaultPriceSource,
					defaultPriceSourceUrl: openOracleInitialReportState.defaultPriceSourceUrl,
					priceInput: openOracleForm.price,
					quoteAttemptedSources: openOracleInitialReportState.quoteAttemptedSources,
					quoteFailureReason: openOracleInitialReportState.quoteFailureReason,
					reportDetails: openOracleReportDetails,
					token1AllowanceError: openOracleInitialReportState.token1Approval.error,
					token1Balance: openOracleInitialReportState.token1Balance,
					token1BalanceError: openOracleInitialReportState.token1BalanceError,
					token1Decimals: openOracleInitialReportState.token1Decimals ?? openOracleReportDetails.token1Decimals,
					token2AllowanceError: openOracleInitialReportState.token2Approval.error,
					token2Balance: openOracleInitialReportState.token2Balance,
					token2BalanceError: openOracleInitialReportState.token2BalanceError,
					token2Decimals: openOracleInitialReportState.token2Decimals ?? openOracleReportDetails.token2Decimals,
					walletEthBalance: openOracleInitialReportState.ethBalance,
				}))
	const openOracleDisputeSubmission =
		overrides.openOracleDisputeSubmission ??
		(openOracleReportDetails === undefined
			? undefined
			: deriveOpenOracleDisputeSubmissionDetails({
					approvedToken1Amount: openOracleInitialReportState.token1Approval.value,
					approvedToken2Amount: openOracleInitialReportState.token2Approval.value,
					disputeNewAmount1Input: openOracleForm.disputeNewAmount1,
					disputeNewAmount2Input: openOracleForm.disputeNewAmount2,
					disputeTokenToSwap: openOracleForm.disputeTokenToSwap,
					reportDetails: openOracleReportDetails,
					token1AllowanceError: openOracleInitialReportState.token1Approval.error,
					token1Balance: openOracleInitialReportState.token1Balance,
					token1BalanceError: openOracleInitialReportState.token1BalanceError,
					token1Decimals: openOracleInitialReportState.token1Decimals ?? openOracleReportDetails.token1Decimals,
					token2AllowanceError: openOracleInitialReportState.token2Approval.error,
					token2Balance: openOracleInitialReportState.token2Balance,
					token2BalanceError: openOracleInitialReportState.token2BalanceError,
					token2Decimals: openOracleInitialReportState.token2Decimals ?? openOracleReportDetails.token2Decimals,
				}))

	return {
		activeView: 'create',
		accountState: createAccountState(),
		loadingOpenOracleCreate: false,
		loadingOracleReport: false,
		onActiveViewChange: () => undefined,
		onApproveToken1: () => undefined,
		onApproveToken2: () => undefined,
		onCreateOpenOracleGame: () => undefined,
		onDisputeReport: () => undefined,
		onLoadOracleReport: () => undefined,
		onOpenOracleCreateFormChange: () => undefined,
		onOpenOracleFormChange: () => undefined,
		onRefreshPrice: () => undefined,
		onSettleReport: () => undefined,
		onSubmitInitialReport: () => undefined,
		onWrapWethForInitialReport: () => undefined,
		openOracleActiveAction: undefined,
		openOracleCreateForm,
		openOracleError: undefined,
		openOracleForm,
		openOracleDisputeSubmission,
		openOracleInitialReportSubmission,
		openOracleInitialReportState,
		openOracleReportDetails,
		openOracleResult: undefined,
		...overrides,
	}
}

function createOpenOracleReportDetails(overrides: Partial<OpenOracleReportDetails> = {}): OpenOracleReportDetails {
	return {
		callbackContract: zeroAddress,
		callbackGasLimit: 0,
		currentBlockNumber: 0n,
		currentAmount1: 0n,
		currentAmount2: 0n,
		currentReporter: zeroAddress,
		currentTime: 0n,
		disputeDelay: 3600n,
		disputeOccurred: false,
		escalationHalt: 5n * 10n ** 17n,
		exactToken1Report: 10n ** 18n,
		fee: 10n ** 15n,
		feePercentage: 1000000000000000n,
		initialReporter: zeroAddress,
		isDistributed: false,
		lastReportOppoTime: 0n,
		multiplier: 2n * 10n ** 18n,
		numReports: 0n,
		openOracleAddress: '0x1000000000000000000000000000000000000000',
		price: 0n,
		protocolFee: 0n,
		protocolFeeRecipient: zeroAddress,
		reportId: 7n,
		reportTimestamp: 0n,
		settlementTime: 86400n,
		settlementTimestamp: 0n,
		settlerReward: 10n ** 15n,
		stateHash: '0x1234000000000000000000000000000000000000000000000000000000000000',
		timeType: true,
		token1: '0x2000000000000000000000000000000000000000',
		token1Decimals: 18,
		token1Symbol: 'REPv2',
		token2: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
		token2Decimals: 18,
		token2Symbol: 'WETH',
		trackDisputes: false,
		...overrides,
	}
}

describe('OpenOracleSection route create view', () => {
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

	test('renders create-success handoff actions in create view', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					openOracleResult: {
						action: 'createReportInstance',
						hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('button', { name: 'Return to Browse' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Create Another' })).not.toBeNull()
		expect(document.body.querySelector('.workflow-transaction-status')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Latest Oracle Action' })).toBeNull()
	})

	test('renders selected report actions without readiness cards or visible blocker copy', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					activeView: 'selected-report',
					openOracleReportDetails: createOpenOracleReportDetails({
						currentReporter: '0x3000000000000000000000000000000000000000',
						currentTime: 100n,
						disputeDelay: 10n,
						reportTimestamp: 100n,
						settlementTime: 60n,
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Available')).toBeNull()
		expect(documentQueries.queryByText('Blocked')).toBeNull()
		expect(documentQueries.queryByText('Action Readiness')).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Report Actions' })).not.toBeNull()
		expect(documentQueries.queryByText(/^Blocked:/)).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Dispute & Swap', 'This report is not ready to dispute.')
	})

	test('disables create when the wallet lacks enough ETH for the attached value', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					accountState: createAccountState({ ethBalance: 1_000n * ETH }),
					openOracleCreateForm: {
						...getDefaultOpenOracleCreateFormState(),
						ethValue: '1100',
						settlerReward: '1000',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Create Standalone Oracle Game', 'Need 100 more ETH in this wallet to create the selected standalone Open Oracle game.')
	})

	test('formats browse description with the shared page size', () => {
		expect(UI_STRINGS.openOracleSection.browseReportsDescription('10')).toContain('10 reports')
	})

	test('does not disable create before token decimals are loaded for large but valid token1 amounts', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					accountState: createAccountState({ ethBalance: 2_000n * ETH }),
					openOracleCreateForm: {
						...getDefaultOpenOracleCreateFormState(),
						disputeDelay: '10',
						exactToken1Report: '1000000000',
						ethValue: '1',
						feePercentage: '1',
						multiplier: '100',
						protocolFee: '1',
						settlementTime: '60',
						settlerReward: '0.1',
						token1Address: '0x2000000000000000000000000000000000000000',
						token2Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Create Standalone Oracle Game')
	})

	test('does not disable create before token decimals are loaded for high-decimal token1 amounts', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					accountState: createAccountState({ ethBalance: 2_000n * ETH }),
					openOracleCreateForm: {
						...getDefaultOpenOracleCreateFormState(),
						disputeDelay: '10',
						escalationHalt: '0.000000000000000000000000000000000001',
						exactToken1Report: '0.000000000000000000000000000000000001',
						ethValue: '1',
						feePercentage: '1',
						multiplier: '100',
						protocolFee: '1',
						settlementTime: '60',
						settlerReward: '0.1',
						token1Address: '0x2000000000000000000000000000000000000000',
						token2Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Create Standalone Oracle Game')
	})

	test('describes advanced create fields with user-facing units and input modes', async () => {
		const renderedComponent = await renderIntoDocument(h(OpenOracleSection, createOpenOracleSectionProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const exactToken1ReportInput = documentQueries.getByLabelText('Exact Token1 Report')
		const settlerRewardInput = documentQueries.getByLabelText('Settler Reward')
		const ethValueInput = documentQueries.getByLabelText('ETH Value To Send')
		const feePercentageInput = documentQueries.getByLabelText('Fee Percentage')
		const settlementTimeInput = documentQueries.getByLabelText('Settlement Time')
		const escalationHaltInput = documentQueries.getByLabelText('Escalation Halt')
		const disputeDelayInput = documentQueries.getByLabelText('Dispute Delay')
		const protocolFeeInput = documentQueries.getByLabelText('Protocol Fee')

		expect(exactToken1ReportInput.getAttribute('aria-describedby')).toBe('open-oracle-exact-token1-report-help')
		expect(settlerRewardInput.getAttribute('aria-describedby')).toBe('open-oracle-settler-reward-help')
		expect(ethValueInput.getAttribute('aria-describedby')).toBe('open-oracle-eth-value-help')
		expect(feePercentageInput.getAttribute('aria-describedby')).toBe('open-oracle-fee-percentage-help')
		expect(settlementTimeInput.getAttribute('aria-describedby')).toBe('open-oracle-settlement-time-help')
		expect(escalationHaltInput.getAttribute('aria-describedby')).toBe('open-oracle-escalation-halt-help')
		expect(disputeDelayInput.getAttribute('aria-describedby')).toBe('open-oracle-dispute-delay-help')
		expect(protocolFeeInput.getAttribute('aria-describedby')).toBe('open-oracle-protocol-fee-help')
		expect(exactToken1ReportInput.getAttribute('inputmode')).toBe('decimal')
		expect(settlerRewardInput.getAttribute('inputmode')).toBe('decimal')
		expect(ethValueInput.getAttribute('inputmode')).toBe('decimal')
		expect(feePercentageInput.getAttribute('inputmode')).toBe('decimal')
		expect(settlementTimeInput.getAttribute('inputmode')).toBe('numeric')
		expect(escalationHaltInput.getAttribute('inputmode')).toBe('decimal')
		expect(disputeDelayInput.getAttribute('inputmode')).toBe('numeric')
		expect(protocolFeeInput.getAttribute('inputmode')).toBe('decimal')
		expect(documentQueries.getByText('Token1 amount to report, entered as a decimal value for the token1 address.')).not.toBeNull()
		expect(documentQueries.getByText('ETH paid to the account that settles the report.')).not.toBeNull()
		expect(documentQueries.getByText('ETH sent with creation; must cover required funding and the settler reward.')).not.toBeNull()
		expect(documentQueries.getByText('Fee charged during dispute economics, entered as a percentage.')).not.toBeNull()
		expect(documentQueries.getByText('Delay in seconds after the initial report before settlement can begin.')).not.toBeNull()
		expect(documentQueries.getByText('Token1 amount where dispute escalation stops, entered as a decimal value for the token1 address.')).not.toBeNull()
		expect(documentQueries.getByText('Delay in seconds after the initial report before disputes can begin.')).not.toBeNull()
		expect(documentQueries.getByText('Protocol fee charged during disputes, entered as a percentage.')).not.toBeNull()
	})

	test('uses the shared live chain timestamp to switch a selected report into settle mode', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={161n}>
				<OpenOracleSection
					{...createOpenOracleSectionProps({
						activeView: 'selected-report',
						openOracleReportDetails: createOpenOracleReportDetails({
							currentBlockNumber: 100n,
							currentReporter: '0x3000000000000000000000000000000000000000',
							currentTime: 100n,
							disputeDelay: 10n,
							reportTimestamp: 100n,
							settlementTime: 60n,
							timeType: true,
						}),
					})}
				/>
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: 'Dispute & Swap' })).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Settle Report' })).not.toBeNull()
	})

	test('uses the shared live block number to switch a selected report into settle mode', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainBlockNumberContext.Provider value={161n}>
				<OpenOracleSection
					{...createOpenOracleSectionProps({
						activeView: 'selected-report',
						openOracleReportDetails: createOpenOracleReportDetails({
							currentBlockNumber: 100n,
							currentReporter: '0x3000000000000000000000000000000000000000',
							currentTime: 100n,
							disputeDelay: 10n,
							reportTimestamp: 100n,
							settlementTime: 60n,
							timeType: false,
						}),
					})}
				/>
			</ChainBlockNumberContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: 'Dispute & Swap' })).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Settle Report' })).not.toBeNull()
	})
})
