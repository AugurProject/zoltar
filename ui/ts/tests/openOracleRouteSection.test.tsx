/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { h } from 'preact'
import { zeroAddress } from 'viem'
import { OpenOracleSection } from '../components/OpenOracleSection.js'
import { getDefaultOpenOracleCreateFormState, getDefaultOpenOracleFormState } from '../lib/marketForm.js'
import { deriveOpenOracleDisputeSubmissionDetails, deriveOpenOracleInitialReportSubmissionDetails } from '../lib/openOracle.js'
import type { AccountState } from '../types/app.js'
import type { OpenOracleSectionProps } from '../types/components.js'
import type { OpenOracleReportDetails } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled } from './testUtils/transactionActionButton.js'

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
		callbackSelector: '0x00000000',
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
		feeToken: false,
		initialReporter: zeroAddress,
		isDistributed: false,
		keepFee: false,
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
		expect(documentQueries.getByRole('heading', { name: 'Selected Report Actions' })).not.toBeNull()
		expect(documentQueries.queryByText(/^Blocked:/)).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Dispute & Swap', 'This report is not ready to dispute yet.')
	})

	test('disables create when the wallet lacks enough ETH for the attached value', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					accountState: createAccountState({ ethBalance: 1_000n * ETH }),
					openOracleCreateForm: {
						...getDefaultOpenOracleCreateFormState(),
						ethValue: (1_100n * ETH).toString(),
						settlerReward: (1_000n * ETH).toString(),
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Create Open Oracle Game', 'Need 100 more ETH in this wallet to create the selected Open Oracle game.')
	})
})
