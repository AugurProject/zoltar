/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fireEvent, within } from '../../testUtils/queries'
import { h } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { OpenOracleSection } from '../../../features/open-oracle/components/OpenOracleSection.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import { ChainBlockNumberContext, ChainTimestampContext } from '../../../lib/chainTimestamp.js'
import { getDefaultOpenOracleCreateFormState, getDefaultOpenOracleFormState } from '../../../features/markets/lib/marketForm.js'
import { deriveOpenOracleDisputeSubmissionDetails } from '../../../features/open-oracle/lib/openOracle.js'
import type { AccountState } from '../../../types/app.js'
import type { OpenOracleSectionProps } from '../../../features/types.js'
import type { OpenOracleReportDetails } from '../../../types/contracts.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '../../testUtils/transactionActionButton.js'

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
	const openOracleTokenAccessState = overrides.openOracleTokenAccessState ?? {
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
	const openOracleDisputeSubmission =
		overrides.openOracleDisputeSubmission ??
		(openOracleReportDetails === undefined
			? undefined
			: deriveOpenOracleDisputeSubmissionDetails({
					approvedToken1Amount: openOracleTokenAccessState.token1Approval.value,
					approvedToken2Amount: openOracleTokenAccessState.token2Approval.value,
					disputeNewAmount1Input: openOracleForm.disputeNewAmount1,
					disputeNewAmount2Input: openOracleForm.disputeNewAmount2,
					disputeTokenToSwap: openOracleForm.disputeTokenToSwap,
					reportDetails: openOracleReportDetails,
					token1AllowanceError: openOracleTokenAccessState.token1Approval.error,
					token1Balance: openOracleTokenAccessState.token1Balance,
					token1BalanceError: openOracleTokenAccessState.token1BalanceError,
					token1Decimals: openOracleTokenAccessState.token1Decimals ?? openOracleReportDetails.token1Decimals,
					token2AllowanceError: openOracleTokenAccessState.token2Approval.error,
					token2Balance: openOracleTokenAccessState.token2Balance,
					token2BalanceError: openOracleTokenAccessState.token2BalanceError,
					token2Decimals: openOracleTokenAccessState.token2Decimals ?? openOracleReportDetails.token2Decimals,
				}))

	return {
		activeView: 'create',
		accountState: createAccountState(),
		environmentReady: true,
		environmentRefreshKey: 0,
		loadingOpenOracleCreate: false,
		onActiveViewChange: () => undefined,
		onApproveToken1: () => undefined,
		onApproveToken2: () => undefined,
		onCancelOpenOracleWithdrawalBalanceCheck: () => undefined,
		onCreateOpenOracleGame: () => undefined,
		onDisputeReport: () => undefined,
		onLoadOracleReport: () => undefined,
		onOpenOracleCreateFormChange: () => undefined,
		onOpenOracleFormChange: () => undefined,
		onSettleReport: () => undefined,
		onWithdrawOpenOracleBalance: () => undefined,
		openOracleActiveAction: undefined,
		openOracleActiveWithdrawalBalance: undefined,
		openOracleCreateForm,
		openOracleError: undefined,
		openOracleForm,
		openOracleDisputeSubmission,
		openOracleReportLookupState: 'unknown',
		openOracleTokenAccessState,
		openOracleReportDetails,
		openOracleResult: undefined,
		openOracleWithdrawalBalanceChecking: false,
		openOracleWithdrawalReviewMessage: undefined,
		openOracleWithdrawableBalances: undefined,
		openOracleWithdrawableBalancesError: undefined,
		openOracleWithdrawableBalancesLoading: false,
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

	test('keeps standalone create disabled off mainnet and explains recovery', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					accountState: createAccountState({ chainId: '0xaa36a7' }),
					openOracleCreateForm: {
						disputeDelay: '3600',
						escalationHalt: '0.5',
						ethValue: '1',
						exactToken1Report: '1',
						initialToken2Amount: '1',
						feePercentage: '0',
						multiplier: '2',
						protocolFee: '0',
						settlementTime: '7200',
						settlerReward: '0.1',
						token1Address: '0x2000000000000000000000000000000000000000',
						token2Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Create Standalone Oracle Report')
		expect(document.body.textContent?.includes('Switch to Ethereum mainnet')).toBe(true)
	})

	test('keeps the standalone safety warning without redundant workflow guidance', async () => {
		const renderedComponent = await renderIntoDocument(h(OpenOracleSection, createOpenOracleSectionProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Standalone only. Start pool-managed requests from a security pool.')).not.toBeNull()
		expect(documentQueries.getByRole('textbox', { name: 'Base Token Address' })).not.toBeNull()
		expect(documentQueries.getByRole('textbox', { name: 'Quote Token Address' })).not.toBeNull()
		expect(document.body.textContent?.includes('Standalone operator workflow')).toBe(false)
		expect(document.body.textContent?.match(/pool-managed/gi) ?? []).toHaveLength(1)
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
		expect(document.body.querySelector('.open-oracle-report-stack')).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Dispute & Swap', 'This report is not ready to dispute.')
	})

	test('keeps blank and unsubmitted report lookups quiet', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					activeView: 'selected-report',
					openOracleForm: getDefaultOpenOracleFormState(),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Not checked')).toBeNull()
		expect(document.body.textContent?.includes('Refresh reports')).toBe(false)

		await cleanupRenderedComponent()
		cleanupRenderedComponent = undefined
		const unsubmittedRenderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					activeView: 'selected-report',
					openOracleForm: { ...getDefaultOpenOracleFormState(), reportId: '999' },
				}),
			),
		)
		cleanupRenderedComponent = unsubmittedRenderedComponent.cleanup

		expect(within(document.body).queryByText('No report matches this ID. Try another report ID.')).toBeNull()

		await cleanupRenderedComponent()
		cleanupRenderedComponent = undefined
		const missingRenderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					activeView: 'selected-report',
					openOracleForm: { ...getDefaultOpenOracleFormState(), reportId: '999' },
					openOracleReportLookupState: 'missing',
				}),
			),
		)
		cleanupRenderedComponent = missingRenderedComponent.cleanup

		expect(within(document.body).getByText('No report matches this ID. Try another report ID.')).not.toBeNull()
	})

	test('does not let an older pending lookup block a replacement report ID', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					activeView: 'selected-report',
					openOracleForm: { ...getDefaultOpenOracleFormState(), reportId: '2' },
					openOracleReportLookupState: 'unknown',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const openReportButton = within(document.body).getByRole('button', { name: 'Open report' })
		expect(openReportButton.hasAttribute('disabled')).toBe(false)
		expect(within(document.body).queryByText('Loading…')).toBeNull()
	})

	test('omits the empty report actions section for a settled report', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					activeView: 'selected-report',
					openOracleReportDetails: createOpenOracleReportDetails({
						currentReporter: '0x3000000000000000000000000000000000000000',
						isDistributed: true,
						reportTimestamp: 100n,
						settlementTimestamp: 161n,
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Report Actions' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Report Details' })).toBeNull()
		expect(document.body.querySelector('.sticky-object-context .badge')?.textContent).toBe('Settled')
		expect(document.body.querySelector('.lifecycle-stage-banner')).toBeNull()
		expect(documentQueries.queryByText('This report is already settled and no further write actions are available.')).toBeNull()
		expect(documentQueries.queryByText('This report is settled. No write actions are available.')).toBeNull()
		for (const disclosureTitle of ['Status', 'Settlement', 'Callback / Extra']) {
			const summary = documentQueries.getByText(disclosureTitle, { selector: 'summary' })
			const disclosure = summary.closest('details')
			if (!(disclosure instanceof HTMLElement)) throw new Error(`Expected ${disclosureTitle} disclosure`)
			expect(within(disclosure).getAllByText(disclosureTitle)).toHaveLength(1)
		}
	})

	test('keeps an action-stage banner when it adds timing context beyond status', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					activeView: 'selected-report',
					openOracleReportDetails: createOpenOracleReportDetails({
						currentReporter: '0x3000000000000000000000000000000000000000',
						currentTime: 120n,
						disputeDelay: 10n,
						reportTimestamp: 100n,
						settlementTime: 60n,
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.querySelector('.sticky-object-context .badge')?.textContent).toBe('Pending')
		expect(within(document.body).getByRole('heading', { name: 'Dispute Window Open' })).not.toBeNull()
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

		expectTransactionButtonDisabled(document.body, 'Create Standalone Oracle Report', 'Need 100 more ETH in this wallet to create the selected standalone Open Oracle report.')
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
						initialToken2Amount: '1',
						ethValue: '1',
						feePercentage: '1',
						multiplier: '100',
						protocolFee: '1',
						settlementTime: '60',
						settlerReward: '1',
						token1Address: '0x2000000000000000000000000000000000000000',
						token2Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Create Standalone Oracle Report')
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
						initialToken2Amount: '1',
						ethValue: '1',
						feePercentage: '1',
						multiplier: '100',
						protocolFee: '1',
						settlementTime: '60',
						settlerReward: '1',
						token1Address: '0x2000000000000000000000000000000000000000',
						token2Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Create Standalone Oracle Report')
	})

	test('describes advanced create fields with user-facing units and input modes', async () => {
		const renderedComponent = await renderIntoDocument(h(OpenOracleSection, createOpenOracleSectionProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const exactToken1ReportInput = documentQueries.getByLabelText('Base Token Amount')
		const initialToken2AmountInput = documentQueries.getByLabelText('Quote Token Amount')
		const settlerRewardInput = documentQueries.getByLabelText('Settler Reward')
		const ethValueInput = documentQueries.getByLabelText('ETH Value To Send')
		const baseTokenAddressInput = documentQueries.getByLabelText('Base Token Address')
		const quoteTokenAddressInput = documentQueries.getByLabelText('Quote Token Address')
		const feePercentageInput = documentQueries.getByLabelText('Dispute Fee (%)')
		const settlementTimeInput = documentQueries.getByLabelText('Settlement Delay (seconds)')
		const escalationHaltInput = documentQueries.getByLabelText('Escalation Halt')
		const disputeDelayInput = documentQueries.getByLabelText('Dispute Delay (seconds)')
		const protocolFeeInput = documentQueries.getByLabelText('Protocol Fee (%)')

		expect(exactToken1ReportInput.getAttribute('aria-describedby')).toBe('open-oracle-exact-token1-report-help')
		expect(initialToken2AmountInput.getAttribute('aria-describedby')).toBe('open-oracle-initial-token2-amount-help')
		expect(settlerRewardInput.getAttribute('aria-describedby')).toBe('open-oracle-settler-reward-help')
		expect(ethValueInput.getAttribute('aria-describedby')).toBe('open-oracle-eth-value-help')
		expect(baseTokenAddressInput.hasAttribute('aria-describedby')).toBe(false)
		expect(quoteTokenAddressInput.hasAttribute('aria-describedby')).toBe(false)
		expect(feePercentageInput.hasAttribute('aria-describedby')).toBe(false)
		expect(settlementTimeInput.hasAttribute('aria-describedby')).toBe(false)
		expect(escalationHaltInput.getAttribute('aria-describedby')).toBe('open-oracle-escalation-halt-help')
		expect(disputeDelayInput.hasAttribute('aria-describedby')).toBe(false)
		expect(protocolFeeInput.hasAttribute('aria-describedby')).toBe(false)
		expect(exactToken1ReportInput.getAttribute('inputmode')).toBe('decimal')
		expect(initialToken2AmountInput.getAttribute('inputmode')).toBe('decimal')
		expect(settlerRewardInput.getAttribute('inputmode')).toBe('decimal')
		expect(ethValueInput.getAttribute('inputmode')).toBe('decimal')
		expect(feePercentageInput.getAttribute('inputmode')).toBe('decimal')
		expect(settlementTimeInput.getAttribute('inputmode')).toBe('numeric')
		expect(escalationHaltInput.getAttribute('inputmode')).toBe('decimal')
		expect(disputeDelayInput.getAttribute('inputmode')).toBe('numeric')
		expect(protocolFeeInput.getAttribute('inputmode')).toBe('decimal')
		expect(documentQueries.getByText('Base-token amount to report.')).not.toBeNull()
		expect(documentQueries.getByText('Quote-token amount to report.')).not.toBeNull()
		expect(documentQueries.getByText('ETH paid to the settler.')).not.toBeNull()
		expect(documentQueries.getByText('ETH funding, including the settler reward.')).not.toBeNull()
		expect(documentQueries.queryByText('Fee charged during dispute economics, entered as a percentage.')).toBeNull()
		expect(documentQueries.queryByText('Delay in seconds after the initial report before settlement can begin.')).toBeNull()
		expect(documentQueries.getByText('Base-token amount that ends escalation.')).not.toBeNull()
		expect(documentQueries.getByText('Parameter Details')).not.toBeNull()
		expect(documentQueries.queryByText('Delay in seconds after the initial report before disputes can begin.')).toBeNull()
		expect(documentQueries.queryByText('Protocol fee charged during disputes, entered as a percentage.')).toBeNull()
	})

	test('uses the exact shared live settlement timestamp to switch a selected report into settle mode', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={160n}>
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

	test('uses the exact shared live settlement block to switch a selected report into settle mode', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainBlockNumberContext.Provider value={160n}>
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

	test('shows independent credited-balance withdrawals after settlement', async () => {
		const withdrawnBalances: string[] = []
		const reportDetails = createOpenOracleReportDetails({
			currentReporter: '0x3000000000000000000000000000000000000000',
			isDistributed: true,
			reportTimestamp: 100n,
			settlementTimestamp: 160n,
		})
		const renderedComponent = await renderIntoDocument(
			<OpenOracleSection
				{...createOpenOracleSectionProps({
					activeView: 'selected-report',
					onWithdrawOpenOracleBalance: balance => withdrawnBalances.push(balance),
					openOracleReportDetails: reportDetails,
					openOracleWithdrawableBalances: { eth: 7n * ETH, token1: 100n * ETH, token2: 0n },
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Your Oracle Balances')).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Report Actions' })).toBeNull()
		fireEvent.click(documentQueries.getByRole('button', { name: 'Withdraw ETH' }))
		expect(withdrawnBalances).toEqual([])
		expect(documentQueries.getByRole('dialog', { name: 'Withdraw ETH' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Transaction Review' })).not.toBeNull()
		expect(documentQueries.getByText('7 ETH')).not.toBeNull()
		fireEvent.click(documentQueries.getByRole('button', { name: 'Confirm Withdrawal' }))
		expect(documentQueries.queryByRole('button', { name: `Withdraw ${reportDetails.token2Symbol}` })).toBeNull()
		expect(withdrawnBalances).toEqual(['eth'])
	})

	test('shows pending copy only for the balance being withdrawn', async () => {
		const reportDetails = createOpenOracleReportDetails({
			currentReporter: '0x3000000000000000000000000000000000000000',
			isDistributed: true,
			reportTimestamp: 100n,
			settlementTimestamp: 160n,
		})
		const renderedComponent = await renderIntoDocument(
			<OpenOracleSection
				{...createOpenOracleSectionProps({
					activeView: 'selected-report',
					openOracleActiveAction: 'withdrawBalance',
					openOracleActiveWithdrawalBalance: 'eth',
					openOracleReportDetails: reportDetails,
					openOracleWithdrawableBalances: { eth: 7n, token1: 100n, token2: 0n },
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('button', { name: 'Withdrawing ETH…' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: `Withdraw ${reportDetails.token1Symbol}` })).not.toBeNull()
		expectTransactionButtonDisabled(document.body, `Withdraw ${reportDetails.token1Symbol}`)
	})

	test('shows changed-balance recovery inside the withdrawal review', async () => {
		const reportDetails = createOpenOracleReportDetails({
			currentReporter: '0x3000000000000000000000000000000000000000',
			isDistributed: true,
			reportTimestamp: 100n,
			settlementTimestamp: 160n,
		})
		const renderedComponent = await renderIntoDocument(
			<OpenOracleSection
				{...createOpenOracleSectionProps({
					activeView: 'selected-report',
					openOracleReportDetails: reportDetails,
					openOracleWithdrawalReviewMessage: {
						balance: 'token1',
						message: 'Your withdrawable REPv2 balance changed. Review the updated amount and confirm again',
					},
					openOracleWithdrawableBalances: { eth: 0n, token1: 125n * ETH, token2: 0n },
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Withdraw REPv2' }))

		const dialog = documentQueries.getByRole('dialog', { name: 'Withdraw REPv2' })
		const dialogQueries = within(dialog)
		expect(dialogQueries.getByText('125 REPv2')).not.toBeNull()
		expect(dialogQueries.getByRole('alert').textContent).toContain('Your withdrawable REPv2 balance changed. Review the updated amount and confirm again')
		expectTransactionButtonEnabled(dialog, 'Confirm Withdrawal')
	})

	test('cancels an in-progress withdrawal balance check when its review closes', async () => {
		const cancelWithdrawalBalanceCheck = mock(() => undefined)
		const reportDetails = createOpenOracleReportDetails({
			currentReporter: '0x3000000000000000000000000000000000000000',
			isDistributed: true,
			reportTimestamp: 100n,
			settlementTimestamp: 160n,
		})
		const renderedComponent = await renderIntoDocument(
			<OpenOracleSection
				{...createOpenOracleSectionProps({
					activeView: 'selected-report',
					onCancelOpenOracleWithdrawalBalanceCheck: cancelWithdrawalBalanceCheck,
					openOracleReportDetails: reportDetails,
					openOracleWithdrawableBalances: { eth: 7n * ETH, token1: 0n, token2: 0n },
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Withdraw ETH' }))
		const dialog = documentQueries.getByRole('dialog', { name: 'Withdraw ETH' })
		fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

		expect(cancelWithdrawalBalanceCheck).toHaveBeenCalledTimes(1)
		expect(documentQueries.queryByRole('dialog', { name: 'Withdraw ETH' })).toBeNull()
	})

	test('shows a terminal balance-load error without stale loading copy', async () => {
		const renderedComponent = await renderIntoDocument(
			<OpenOracleSection
				{...createOpenOracleSectionProps({
					activeView: 'selected-report',
					openOracleReportDetails: createOpenOracleReportDetails({
						currentReporter: '0x3000000000000000000000000000000000000000',
						initialReporter: '0x3000000000000000000000000000000000000000',
						isDistributed: true,
						reportTimestamp: 100n,
						settlementTimestamp: 160n,
					}),
					openOracleWithdrawableBalancesError: 'Failed to load Open Oracle balances',
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Failed to load Open Oracle balances')).not.toBeNull()
		expect(documentQueries.queryByText(openOracleCopy.loadingOracleBalances)).toBeNull()
	})
})
