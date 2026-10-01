import { ReportingOracleBlocker } from '@zoltar/ui-statoblast-shared/features/reporting/components/ReportingOracleBlocker.js'
import { createOracleManagerDetails } from '../security-pools/workflow/builders.js'
/// <reference types="bun-types" />

import { signal } from '@preact/signals'
import { GlobalTransactionPresentationProvider } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import type { GlobalTransactionPresentation } from '@zoltar/ui-core-shared/types/components.js'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createWalletActions, expectWalletFixDescribesAction } from '@zoltar/ui-core-shared/tests/testUtils/walletActions.js'
import { WalletActionsProvider } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import type { OpenOracleActionResult, OpenOracleReportDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { ChainBlockNumberContext, ChainTimestampContext } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import * as openOracleCopy from '@zoltar/ui-statoblast-shared/copy/openOracle.js'
import { OpenOracleSection } from '@zoltar/ui-statoblast-shared/features/open-oracle/components/OpenOracleSection.js'
import { getDefaultOpenOracleCreateFormState, getDefaultOpenOracleFormState } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/formDefaults.js'
import { deriveOpenOracleDisputeSubmissionDetails } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/openOracleDispute.js'
import type { AccountState } from '@zoltar/ui-zoltar-shared/types/app.js'
import type { OpenOracleCreateFormState } from '@zoltar/ui-statoblast-shared/types/app.js'
import { describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'

const ATTO_ETH_PER_ETH = 10n ** 18n

function getDescriptionTexts(element: Element) {
	return (element.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent)
}

function expectPoliteFieldError(message: string) {
	const error = within(document.body).getByText(message, { selector: 'p.field-error' })
	expect(error.getAttribute('role')).toBeNull()
	expect(error.parentElement?.getAttribute('aria-live')).toBe('polite')
	return error
}

type OpenOracleSectionTestProps = Parameters<typeof OpenOracleSection>[0]
type LoadOpenOracleCreateTokenMetadata = NonNullable<OpenOracleSectionTestProps['loadCreateTokenMetadata']>

const TEST_TOKEN_SYMBOLS = { Base: 'REP', Quote: 'WETH' } as const
const loadTestTokenMetadata: LoadOpenOracleCreateTokenMetadata = async (_address, label) => ({ decimals: 18, status: 'success', symbol: TEST_TOKEN_SYMBOLS[label] })

/** Lets the create form's token metadata reads resolve and render. */
async function flushTokenMetadata() {
	await act(async () => {
		await new Promise(resolve => setTimeout(resolve, 0))
	})
}

function createOpenOracleSectionProps(overrides: Partial<OpenOracleSectionTestProps> = {}): OpenOracleSectionTestProps {
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
		loadCreateTokenMetadata: loadTestTokenMetadata,
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
		settlerRewardAttoEth: 10n ** 15n,
		stateHash: '0x1234000000000000000000000000000000000000000000000000000000000000',
		timeType: true,
		token1: '0x2000000000000000000000000000000000000000',
		token1Decimals: 18,
		token1Symbol: 'REPv2',
		token2: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
		token2Decimals: 18,
		token2Symbol: 'WETH',
		trackDisputes: false,
		feesOnlyAtHalt: false,
		flexibleEscalation: false,
		...overrides,
	}
}

function InteractiveOpenOracleCreateSection({ initialForm }: { initialForm: OpenOracleCreateFormState }) {
	const [form, setForm] = useState(initialForm)
	return (
		<OpenOracleSection
			{...createOpenOracleSectionProps({
				accountState: createAccountState({ ethBalanceAttoEth: 2_000n * ATTO_ETH_PER_ETH }),
				onOpenOracleCreateFormChange: update => setForm(current => ({ ...current, ...update })),
				openOracleCreateForm: form,
			})}
		/>
	)
}

describe('OpenOracleSection route create view', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
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
		expect(documentQueries.getByRole('heading', { name: 'Report created' })).not.toBeNull()
		expect(documentQueries.getByText(openOracleCopy.reportCreatedWithoutIdDetail)).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Return to browse' }).className).toBe('primary')
		expect(documentQueries.getByRole('button', { name: 'Create another' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Standalone report settings' })).toBeNull()
		expect(document.body.querySelector('.workflow-transaction-status')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Latest Oracle Action' })).toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Create another' }))
		})
		expect(documentQueries.getByRole('heading', { name: 'Standalone report settings' })).not.toBeNull()
	})

	test('links a created report by the ID read from its receipt', async () => {
		const formChanges: Array<Record<string, unknown>> = []
		const viewChanges: string[] = []
		const loadedReportIds: Array<string | undefined> = []
		const createdResult: OpenOracleActionResult = {
			action: 'createReportInstance',
			hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
			reportId: 12n,
		}
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					onActiveViewChange: view => viewChanges.push(view),
					onLoadOracleReport: reportId => loadedReportIds.push(reportId),
					onOpenOracleFormChange: update => formChanges.push(update),
					openOracleResult: createdResult,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Report #12 is live. Open it to track disputes and settlement.')).not.toBeNull()
		const openReportButton = documentQueries.getByRole('button', { name: 'Open report #12' })
		expect(openReportButton.className).toBe('primary')
		expect(documentQueries.getByRole('button', { name: 'Return to browse' }).className).toBe('secondary')
		await act(async () => {
			fireEvent.click(openReportButton)
			await Promise.resolve()
		})
		expect(formChanges).toEqual([{ reportId: '12' }])
		expect(viewChanges).toEqual(['selected-report'])
		expect(loadedReportIds).toEqual(['12'])
	})

	test('keeps standalone create disabled off Sepolia and explains recovery', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					accountState: createAccountState({ chainId: '0x1' }),
					openOracleCreateForm: {
						disputeDelay: '3600',
						escalationHalt: '0.5',
						exactToken1Report: '1',
						initialToken2Amount: '1',
						feePercentage: '0',
						multiplier: '2',
						protocolFee: '0',
						settlementTime: '7200',
						settlerRewardEthAmount: '0.1',
						token1Address: '0x2000000000000000000000000000000000000000',
						token2Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Create standalone oracle report')
		expect(document.body.textContent?.includes('Switch to Sepolia')).toBe(true)
	})

	test('keeps the standalone safety warning without redundant workflow guidance', async () => {
		const renderedComponent = await renderIntoDocument(h(OpenOracleSection, createOpenOracleSectionProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Standalone only. Start pool-managed requests from a security pool.')).not.toBeNull()
		expect(documentQueries.getByRole('textbox', { name: 'Base token address' })).not.toBeNull()
		expect(documentQueries.getByRole('textbox', { name: 'Quote token address' })).not.toBeNull()
		expect(document.body.textContent?.includes('Standalone operator workflow')).toBe(false)
		expect(document.body.textContent?.match(/pool-managed/gi) ?? []).toHaveLength(1)
	})

	test('reviews lifecycle delays in human-readable and exact protocol units', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					openOracleCreateForm: {
						...getDefaultOpenOracleCreateFormState(),
						disputeDelay: '3600',
						exactToken1Report: '1',
						initialToken2Amount: '1',
						settlementTime: '86400',
						token1Address: '0x2000000000000000000000000000000000000000',
						token2Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect((documentQueries.getByLabelText('Settlement delay (seconds)') as HTMLInputElement).value).toBe('86400')
		expect((documentQueries.getByLabelText('Dispute delay (seconds)') as HTMLInputElement).value).toBe('3600')
	})

	test('associates unreadable token contract preflight with the affected address field', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					openOracleCreateFieldErrors: {
						token1Address: 'Base token address is not a readable ERC-20 contract.',
					},
					openOracleCreateForm: {
						...getDefaultOpenOracleCreateFormState(),
						disputeDelay: '0',
						exactToken1Report: '1',
						initialToken2Amount: '1',
						settlementTime: '1',
						token1Address: '0x2000000000000000000000000000000000000000',
						token2Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const baseTokenAddressInput = within(document.body).getByLabelText('Base token address')
		expect(baseTokenAddressInput.getAttribute('aria-invalid')).toBe('true')
		expect(baseTokenAddressInput.getAttribute('aria-describedby')).toBe('open-oracle-token1-address-error')
		expectPoliteFieldError('Base token address is not a readable ERC-20 contract.')
		expectTransactionButtonDisabled(document.body, 'Create standalone oracle report', 'Base token address is not a readable ERC-20 contract.')
	})

	test('explains the first invalid field before the default create form is touched', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					accountState: createAccountState({ ethBalanceAttoEth: 2_000n * ATTO_ETH_PER_ETH }),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const baseTokenAddressInput = within(document.body).getByLabelText('Base token address')
		expect(baseTokenAddressInput.hasAttribute('aria-invalid')).toBe(false)
		expect(baseTokenAddressInput.hasAttribute('aria-describedby')).toBe(false)
		expectTransactionButtonDisabled(document.body, 'Create standalone oracle report', 'Enter a valid base token address.')
		expect(document.body.textContent?.includes('Review the highlighted report fields.')).toBe(false)
	})

	test('explains untouched zero amounts after valid token addresses are entered', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					accountState: createAccountState({ ethBalanceAttoEth: 2_000n * ATTO_ETH_PER_ETH }),
					openOracleCreateForm: {
						...getDefaultOpenOracleCreateFormState(),
						token1Address: '0x2000000000000000000000000000000000000000',
						token2Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		expectTransactionButtonDisabled(document.body, 'Create standalone oracle report', openOracleCopy.readingTokenMetadata)
		await flushTokenMetadata()

		const baseTokenAmountInput = within(document.body).getByLabelText('Base token amount')
		expect(baseTokenAmountInput.hasAttribute('aria-invalid')).toBe(false)
		// Once the token is read, its symbol labels the amount.
		expect(getDescriptionTexts(baseTokenAmountInput)).toEqual([openOracleCopy.initialToken1AmountHelpText, 'REP'])
		expect(within(document.body).getByText('REP · 18 decimals')).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Create standalone oracle report', 'Base token amount must be greater than zero.')
		expect(document.body.textContent?.includes('Review the highlighted report fields.')).toBe(false)
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
		expect(documentQueries.getByRole('heading', { name: 'Report actions' })).not.toBeNull()
		expect(documentQueries.queryByText(/^Blocked:/)).toBeNull()
		expect(document.body.querySelector('.open-oracle-report-stack')).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Dispute & swap', 'This report is not ready to dispute.')
	})

	test('associates an invalid dispute amount with the affected field', async () => {
		const tokenUnits = 10n ** 18n
		const openOracleReportDetails = createOpenOracleReportDetails({
			currentAmount1: 10n * tokenUnits,
			currentAmount2: 5n * tokenUnits,
			currentReporter: '0x3000000000000000000000000000000000000000',
			currentTime: 200n,
			disputeDelay: 10n,
			escalationHalt: 20n * tokenUnits,
			multiplier: 20_000n,
			reportTimestamp: 100n,
			settlementTime: 200n,
		})
		const renderedComponent = await renderIntoDocument(
			<OpenOracleSection
				{...createOpenOracleSectionProps({
					activeView: 'selected-report',
					openOracleForm: {
						...getDefaultOpenOracleFormState(),
						disputeNewAmount2: 'not-a-number',
						reportId: openOracleReportDetails.reportId.toString(),
					},
					openOracleReportDetails,
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Dispute & swap' }))
		const dialog = documentQueries.getByRole('dialog', { name: 'Dispute & swap' })
		const dialogQueries = within(dialog)
		// Without flexible escalation the report fixes the base amount, so it is shown rather than entered.
		expect(dialog.querySelector('input[aria-label="New REPv2 amount"]')).toBeNull()
		expect(dialog.textContent).toContain('New REPv2 amount20 REPv2')
		const quoteTokenAmountInput = dialogQueries.getByLabelText('New WETH amount')
		expect(quoteTokenAmountInput.hasAttribute('aria-invalid')).toBe(false)
		expect(document.getElementById('open-oracle-dispute-new-amount-2-error-7')).toBeNull()
		expect(dialog.textContent?.split('Enter a valid new WETH amount greater than zero.')).toHaveLength(2)
		await act(() => {
			quoteTokenAmountInput.dispatchEvent(new Event('blur'))
		})
		expect(quoteTokenAmountInput.getAttribute('aria-invalid')).toBe('true')
		expect(quoteTokenAmountInput.getAttribute('aria-describedby')?.split(' ')[0]).toBe('open-oracle-dispute-new-amount-2-error-7')
		expect(expectPoliteFieldError('Enter a valid new WETH amount greater than zero.').id).toBe('open-oracle-dispute-new-amount-2-error-7')
		expect(dialog.textContent?.split('Enter a valid new WETH amount greater than zero.')).toHaveLength(2)
		expect(dialogQueries.getByRole('button', { name: 'Dispute & swap' }).getAttribute('aria-describedby')).toBe('open-oracle-dispute-new-amount-2-error-7')
		await act(() => {
			fireEvent.input(quoteTokenAmountInput, { target: { value: 'still-not-a-number' } })
		})
		expect(quoteTokenAmountInput.hasAttribute('aria-invalid')).toBe(false)
		expect(document.getElementById('open-oracle-dispute-new-amount-2-error-7')).toBeNull()
	})

	test('previews what a dispute pays, charges, and credits before submitting', async () => {
		const tokenUnits = 10n ** 18n
		const openOracleReportDetails = createOpenOracleReportDetails({
			currentAmount1: 10n * tokenUnits,
			currentAmount2: 5n * tokenUnits,
			currentReporter: '0x3000000000000000000000000000000000000000',
			currentTime: 200n,
			disputeDelay: 10n,
			escalationHalt: 20n * tokenUnits,
			feePercentage: 1_000_000n,
			multiplier: 20_000n,
			reportTimestamp: 100n,
			settlementTime: 200n,
		})
		const renderedComponent = await renderIntoDocument(
			<OpenOracleSection
				{...createOpenOracleSectionProps({
					activeView: 'selected-report',
					openOracleForm: { ...getDefaultOpenOracleFormState(), disputeNewAmount2: '3', reportId: openOracleReportDetails.reportId.toString() },
					openOracleReportDetails,
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Dispute & swap' }))
		const dialog = documentQueries.getByRole('dialog', { name: 'Dispute & swap' })
		// There is no swap-token selector: the lower proposed price swaps out the base token.
		expect(dialog.querySelector('select')).toBeNull()
		expect(dialog.textContent).toContain('Token to swap outREPv2')
		expect(dialog.textContent).toContain('Proposed price0.15 WETH per REPv2')
		// 20 new + 10 bought out + 1 fee (10% of 10) REPv2; the 3 WETH posted comes from the 5 WETH bought out.
		expect(dialog.textContent).toContain('You pay31 REPv2 + 0 WETH')
		expect(dialog.textContent).toContain('Dispute fee (to current reporter)1 REPv2')
		expect(dialog.textContent).toContain('Credited to your oracle balance2 WETH')
		expect(dialog.textContent).toContain('Your new report20 REPv2 + 3 WETH')
	})

	test('hides a revealed dispute amount error when another report is selected', async () => {
		const tokenUnits = 10n ** 18n
		const createDisputedReport = (reportId: bigint) =>
			createOpenOracleReportDetails({
				currentAmount1: 10n * tokenUnits,
				currentAmount2: 5n * tokenUnits,
				currentReporter: '0x3000000000000000000000000000000000000000',
				currentTime: 200n,
				disputeDelay: 10n,
				escalationHalt: 20n * tokenUnits,
				multiplier: 20_000n,
				reportId,
				reportTimestamp: 100n,
				settlementTime: 200n,
			})
		const renderReport = (openOracleReportDetails: OpenOracleReportDetails) => (
			<OpenOracleSection
				{...createOpenOracleSectionProps({
					activeView: 'selected-report',
					openOracleForm: { ...getDefaultOpenOracleFormState(), disputeNewAmount2: 'not-a-number', reportId: openOracleReportDetails.reportId.toString() },
					openOracleReportDetails,
				})}
			/>
		)
		const renderedComponent = await renderIntoDocument(renderReport(createDisputedReport(7n)))
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Dispute & swap' }))
		const firstInput = within(documentQueries.getByRole('dialog', { name: 'Dispute & swap' })).getByLabelText('New WETH amount')
		await act(() => {
			firstInput.dispatchEvent(new Event('blur'))
		})
		expect(document.getElementById('open-oracle-dispute-new-amount-2-error-7')).not.toBeNull()

		await act(() => {
			render(renderReport(createDisputedReport(8n)), renderedComponent.container)
		})
		const nextInput = within(documentQueries.getByRole('dialog', { name: 'Dispute & swap' })).getByLabelText('New WETH amount')
		expect(nextInput.hasAttribute('aria-invalid')).toBe(false)
		expect(document.getElementById('open-oracle-dispute-new-amount-2-error-8')).toBeNull()
	})

	test('keeps the loaded report while a different report ID is typed and opens it only on submit', async () => {
		const formChanges: Array<Record<string, unknown>> = []
		const loadedReportIds: Array<string | undefined> = []
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					activeView: 'selected-report',
					onLoadOracleReport: reportId => loadedReportIds.push(reportId),
					onOpenOracleFormChange: update => formChanges.push(update),
					openOracleForm: { ...getDefaultOpenOracleFormState(), reportId: '7' },
					openOracleReportDetails: createOpenOracleReportDetails({ currentReporter: '0x3000000000000000000000000000000000000000', currentTime: 120n, disputeDelay: 10n, reportTimestamp: 100n, settlementTime: 60n }),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		const reportIdInput = documentQueries.getByLabelText('Report ID')
		expect(documentQueries.getByRole('button', { name: 'Refresh report' })).not.toBeNull()

		await act(() => {
			fireEvent.input(reportIdInput, { target: { value: '8' } })
		})
		// Typing is only a lookup draft: the loaded report stays on screen and nothing is reloaded yet.
		expect(formChanges).toEqual([])
		expect(loadedReportIds).toEqual([])
		expect(documentQueries.getByRole('heading', { name: 'Report #7' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Open report' })).not.toBeNull()

		await act(() => {
			fireEvent.input(reportIdInput, { target: { value: '7' } })
		})
		expect(documentQueries.getByRole('button', { name: 'Refresh report' })).not.toBeNull()

		await act(() => {
			fireEvent.input(reportIdInput, { target: { value: ' 8 ' } })
		})
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Open report' }))
		})
		expect(loadedReportIds).toEqual(['8'])
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
		expect(documentQueries.queryByRole('heading', { name: 'Report actions' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Report details' })).toBeNull()
		expect(document.body.querySelector('.sticky-object-context .badge')?.textContent).toBe('Settled')
		expect(document.body.querySelector('.lifecycle-stage-banner')).toBeNull()
		expect(documentQueries.queryByText('This report is already settled and no further write actions are available.')).toBeNull()
		expect(documentQueries.queryByText('This report is settled. No write actions are available.')).toBeNull()
		for (const disclosureTitle of ['Status', 'Settlement', 'Callback / extra']) {
			const summary = documentQueries.getByText(disclosureTitle, { selector: 'summary' })
			const disclosure = summary.closest('details')
			if (!(disclosure instanceof HTMLElement)) throw new Error(`Expected ${disclosureTitle} disclosure`)
			expect(within(disclosure).getAllByText(disclosureTitle)).toHaveLength(1)
		}
	})

	test('shows the live lifecycle stage in the status badge instead of a pending status', async () => {
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

		// The badge already names the stage, so a banner repeating it without extra timing context is omitted.
		expect(document.body.querySelector('.sticky-object-context .badge')?.textContent).toBe('Dispute window open')
		expect(within(document.body).queryByRole('heading', { name: 'Dispute window open' })).toBeNull()
	})

	test('reads a report past its settlement time as ready to settle, and a dispute as a caution', async () => {
		const renderReport = (overrides: Partial<OpenOracleReportDetails>) =>
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					activeView: 'selected-report',
					openOracleReportDetails: createOpenOracleReportDetails({ currentReporter: '0x3000000000000000000000000000000000000000', disputeDelay: 10n, reportTimestamp: 100n, settlementTime: 60n, ...overrides }),
				}),
			)
		const renderedComponent = await renderIntoDocument(renderReport({ currentTime: 200n }))
		cleanupRenderedComponent = renderedComponent.cleanup
		const badge = () => document.body.querySelector('.sticky-object-context .badge')
		expect(badge()?.textContent).toBe('Ready to settle')
		expect(badge()?.classList.contains('ok')).toBe(true)

		await act(() => {
			render(renderReport({ currentTime: 120n, disputeOccurred: true }), renderedComponent.container)
		})
		expect(badge()?.textContent).toBe('Disputed')
		expect(badge()?.classList.contains('warning')).toBe(true)
		expect(badge()?.classList.contains('danger')).toBe(false)
		expect(within(document.body).getByRole('heading', { name: 'Dispute window open' })).not.toBeNull()

		await act(() => {
			render(renderReport({ currentTime: 105n }), renderedComponent.container)
		})
		expect(badge()?.textContent).toBe('Waiting for dispute window')
		// The banner adds when disputes open, so it stays beside the matching badge.
		expect(within(document.body).getByRole('heading', { name: 'Waiting for dispute window' })).not.toBeNull()
	})
	test('disables create when the wallet lacks enough ETH for the attached value', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					accountState: createAccountState({ ethBalanceAttoEth: 1_000n * ATTO_ETH_PER_ETH }),
					openOracleCreateForm: {
						...getDefaultOpenOracleCreateFormState(),
						exactToken1Report: '1',
						initialToken2Amount: '1',
						settlerRewardEthAmount: '1100',
						token1Address: '0x2000000000000000000000000000000000000000',
						token2Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Create standalone oracle report', 'Need 100\u00a0more\u00a0ETH in this wallet to create the selected standalone Open Oracle report.')
	})

	test('enables create for large token1 amounts that fit the loaded token decimals', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					accountState: createAccountState({ ethBalanceAttoEth: 2_000n * ATTO_ETH_PER_ETH }),
					openOracleCreateForm: {
						...getDefaultOpenOracleCreateFormState(),
						disputeDelay: '10',
						exactToken1Report: '1000000000',
						initialToken2Amount: '1',
						feePercentage: '1',
						multiplier: '1',
						protocolFee: '1',
						settlementTime: '60',
						settlerRewardEthAmount: '1',
						token1Address: '0x2000000000000000000000000000000000000000',
						token2Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		// Create waits for the token reads so precision errors are known before submitting.
		expectTransactionButtonDisabled(document.body, 'Create standalone oracle report', openOracleCopy.readingTokenMetadata)
		await flushTokenMetadata()

		expectTransactionButtonEnabled(document.body, 'Create standalone oracle report')
	})

	test('validates high-precision token1 amounts inline against the loaded token decimals', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					accountState: createAccountState({ ethBalanceAttoEth: 2_000n * ATTO_ETH_PER_ETH }),
					openOracleCreateForm: {
						...getDefaultOpenOracleCreateFormState(),
						disputeDelay: '10',
						escalationHalt: '0.000000000000000000000000000000000001',
						exactToken1Report: '0.000000000000000000000000000000000001',
						initialToken2Amount: '1',
						feePercentage: '1',
						multiplier: '1',
						protocolFee: '1',
						settlementTime: '60',
						settlerRewardEthAmount: '1',
						token1Address: '0x2000000000000000000000000000000000000000',
						token2Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		await flushTokenMetadata()

		// An 18-decimal base token cannot represent 36 decimal places, so the amount is invalid before submitting.
		expectTransactionButtonDisabled(document.body, 'Create standalone oracle report', 'Enter a valid base token amount.')
	})

	test('accepts high-precision token1 amounts once a high-decimal token is read', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					accountState: createAccountState({ ethBalanceAttoEth: 2_000n * ATTO_ETH_PER_ETH }),
					loadCreateTokenMetadata: async (_address, label) => ({ decimals: label === 'Base' ? 36 : 18, status: 'success', symbol: TEST_TOKEN_SYMBOLS[label] }),
					openOracleCreateForm: {
						...getDefaultOpenOracleCreateFormState(),
						disputeDelay: '10',
						escalationHalt: '0.000000000000000000000000000000000001',
						exactToken1Report: '0.000000000000000000000000000000000001',
						initialToken2Amount: '1',
						feePercentage: '1',
						protocolFee: '1',
						settlementTime: '60',
						settlerRewardEthAmount: '1',
						token1Address: '0x2000000000000000000000000000000000000000',
						token2Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		await flushTokenMetadata()

		expectTransactionButtonEnabled(document.body, 'Create standalone oracle report')
	})

	test('uses valid timing defaults for every lifecycle parameter', async () => {
		const defaultForm = getDefaultOpenOracleCreateFormState()
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					accountState: createAccountState({ ethBalanceAttoEth: 2_000n * ATTO_ETH_PER_ETH }),
					openOracleCreateForm: {
						...defaultForm,
						escalationHalt: '25',
						exactToken1Report: '100',
						initialToken2Amount: '300',
						feePercentage: '2',
						protocolFee: '0.5',
						settlerRewardEthAmount: '1',
						token1Address: '0x2000000000000000000000000000000000000000',
						token2Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		await flushTokenMetadata()

		const documentQueries = within(document.body)
		expectTransactionButtonEnabled(document.body, 'Create standalone oracle report')
		expect(documentQueries.queryByRole('heading', { name: 'Transaction review' })).toBeNull()
		for (const label of ['Settlement delay (seconds)', 'Dispute delay (seconds)', 'Dispute fee (%)', 'Multiplier', 'Escalation halt', 'Protocol fee (%)']) {
			expect(documentQueries.getByLabelText(label)).not.toBeNull()
		}
		expect((documentQueries.getByLabelText('Settlement delay (seconds)') as HTMLInputElement).value).toBe(defaultForm.settlementTime)
		expect((documentQueries.getByLabelText('Dispute delay (seconds)') as HTMLInputElement).value).toBe(defaultForm.disputeDelay)
		expect((documentQueries.getByLabelText('Settler reward') as HTMLInputElement).value).toBe('1')
	})

	test('describes advanced create fields with user-facing units and input modes', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				OpenOracleSection,
				createOpenOracleSectionProps({
					accountState: createAccountState({ ethBalanceAttoEth: 2_000n * ATTO_ETH_PER_ETH }),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const exactToken1ReportInput = documentQueries.getByLabelText('Base token amount')
		const initialToken2AmountInput = documentQueries.getByLabelText('Quote token amount')
		const settlerRewardInput = documentQueries.getByLabelText('Settler reward')
		const multiplierInput = documentQueries.getByLabelText('Multiplier')
		const baseTokenAddressInput = documentQueries.getByLabelText('Base token address')
		const quoteTokenAddressInput = documentQueries.getByLabelText('Quote token address')
		const feePercentageInput = documentQueries.getByLabelText('Dispute fee (%)')
		const settlementTimeInput = documentQueries.getByLabelText('Settlement delay (seconds)')
		const escalationHaltInput = documentQueries.getByLabelText('Escalation halt')
		const disputeDelayInput = documentQueries.getByLabelText('Dispute delay (seconds)')
		const protocolFeeInput = documentQueries.getByLabelText('Protocol fee (%)')

		expect(getDescriptionTexts(exactToken1ReportInput)).toEqual([openOracleCopy.initialToken1AmountHelpText])
		expect(getDescriptionTexts(initialToken2AmountInput)).toEqual([openOracleCopy.initialToken2AmountHelpText])
		// The ETH sent is derived from the settler reward, so it is shown read-only instead of asked for twice.
		expect(document.body.querySelector('input[aria-label="ETH value to send"]')).toBeNull()
		expect(getDescriptionTexts(settlerRewardInput)).toEqual([openOracleCopy.formatEthSentHint('0'), 'ETH'])
		expect(getDescriptionTexts(multiplierInput)).toEqual([openOracleCopy.escalationMultiplierHelpText, '×'])
		expect((multiplierInput as HTMLInputElement).value).toBe('1')
		expect(multiplierInput.getAttribute('inputmode')).toBe('decimal')
		expect(baseTokenAddressInput.hasAttribute('aria-describedby')).toBe(false)
		expect(quoteTokenAddressInput.hasAttribute('aria-describedby')).toBe(false)
		expect(feePercentageInput.hasAttribute('aria-describedby')).toBe(false)
		// Seconds inputs explain the typed duration in human units.
		expect(getDescriptionTexts(settlementTimeInput)).toEqual(['86400 seconds = 1d 0h 0m'])
		expect(getDescriptionTexts(escalationHaltInput)).toEqual([openOracleCopy.disputeEscalationStopAmountHelpText])
		expect(getDescriptionTexts(disputeDelayInput)).toEqual(['3600 seconds = 1h 0m'])
		expect(protocolFeeInput.hasAttribute('aria-describedby')).toBe(false)
		expect(exactToken1ReportInput.getAttribute('inputmode')).toBe('decimal')
		expect(initialToken2AmountInput.getAttribute('inputmode')).toBe('decimal')
		expect(settlerRewardInput.getAttribute('inputmode')).toBe('decimal')
		expect(feePercentageInput.getAttribute('inputmode')).toBe('decimal')
		expect(settlementTimeInput.getAttribute('inputmode')).toBe('numeric')
		expect(escalationHaltInput.getAttribute('inputmode')).toBe('decimal')
		expect(disputeDelayInput.getAttribute('inputmode')).toBe('numeric')
		expect(protocolFeeInput.getAttribute('inputmode')).toBe('decimal')
		expect(document.getElementById('open-oracle-token1-address-error')).toBeNull()
		expect(document.getElementById('open-oracle-token2-address-error')).toBeNull()
		await act(() => {
			baseTokenAddressInput.dispatchEvent(new Event('blur'))
			quoteTokenAddressInput.dispatchEvent(new Event('blur'))
		})
		expect(baseTokenAddressInput.getAttribute('aria-invalid')).toBe('true')
		expect(quoteTokenAddressInput.getAttribute('aria-invalid')).toBe('true')
		expect(baseTokenAddressInput.getAttribute('aria-describedby')).toBe('open-oracle-token1-address-error')
		expect(quoteTokenAddressInput.getAttribute('aria-describedby')).toBe('open-oracle-token2-address-error')
		expectPoliteFieldError('Enter a valid base token address.')
		expectPoliteFieldError('Enter a valid quote token address.')
		expect(document.body.textContent?.split('Enter a valid base token address.')).toHaveLength(2)
		expect(document.body.textContent?.split('Enter a valid quote token address.')).toHaveLength(2)
		expect(documentQueries.getByRole('button', { name: 'Create standalone oracle report' }).getAttribute('aria-describedby')).toBe('open-oracle-token1-address-error')
		expect(documentQueries.getByText('Base-token amount to report.')).not.toBeNull()
		expect(documentQueries.getByText('Quote-token amount to report.')).not.toBeNull()
		expect(documentQueries.getByText(openOracleCopy.formatEthSentHint('0'))).not.toBeNull()
		expect(documentQueries.queryByText('Fee charged during dispute economics, entered as a percentage.')).toBeNull()
		expect(documentQueries.queryByText('Delay in seconds after the initial report before settlement can begin.')).toBeNull()
		expect(documentQueries.getByText('Base-token amount that ends escalation.')).not.toBeNull()
		expect(documentQueries.getByText('Parameter details')).not.toBeNull()
		expect(documentQueries.queryByText('Delay in seconds after the initial report before disputes can begin.')).toBeNull()
		expect(documentQueries.queryByText('Protocol fee charged during disputes, entered as a percentage.')).toBeNull()
	})

	test('associates progressive amount, timing, and cross-field create errors with their inputs', async () => {
		const renderedComponent = await renderIntoDocument(
			<InteractiveOpenOracleCreateSection
				initialForm={{
					...getDefaultOpenOracleCreateFormState(),
					exactToken1Report: '1',
					initialToken2Amount: '1',
					settlementTime: '20',
					disputeDelay: '10',
					token1Address: '0x2000000000000000000000000000000000000000',
					token2Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		await flushTokenMetadata()
		const documentQueries = within(document.body)
		const baseTokenAmountInput = documentQueries.getByLabelText('Base token amount')
		const settlementTimeInput = documentQueries.getByLabelText('Settlement delay (seconds)')
		const feePercentageInput = documentQueries.getByLabelText('Dispute fee (%)')
		const protocolFeeInput = documentQueries.getByLabelText('Protocol fee (%)')

		await act(() => {
			fireEvent.input(baseTokenAmountInput, { target: { value: '.' } })
		})
		expect(baseTokenAmountInput.hasAttribute('aria-invalid')).toBe(false)
		expect(document.getElementById('open-oracle-exact-token1-report-error')).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Create standalone oracle report', 'Enter a valid base token amount.')
		await act(() => {
			baseTokenAmountInput.dispatchEvent(new Event('blur'))
		})
		expect(baseTokenAmountInput.getAttribute('aria-invalid')).toBe('true')
		expect(baseTokenAmountInput.getAttribute('aria-describedby')?.split(' ')[0]).toBe('open-oracle-exact-token1-report-error')
		expect(getDescriptionTexts(baseTokenAmountInput)).toEqual(['Enter a valid base token amount.', openOracleCopy.initialToken1AmountHelpText, 'REP'])
		expectPoliteFieldError('Enter a valid base token amount.')
		await act(() => {
			fireEvent.input(baseTokenAmountInput, { target: { value: '..' } })
		})
		// Editing hides the error again so the live region stays quiet while typing.
		expect(baseTokenAmountInput.hasAttribute('aria-invalid')).toBe(false)
		expect(document.getElementById('open-oracle-exact-token1-report-error')).toBeNull()
		await act(() => {
			baseTokenAmountInput.dispatchEvent(new Event('blur'))
		})
		expectPoliteFieldError('Enter a valid base token amount.')

		await act(() => {
			fireEvent.input(baseTokenAmountInput, { target: { value: '1' } })
			fireEvent.input(settlementTimeInput, { target: { value: '9' } })
			settlementTimeInput.dispatchEvent(new Event('blur'))
		})
		expect(baseTokenAmountInput.hasAttribute('aria-invalid')).toBe(false)
		expect(getDescriptionTexts(baseTokenAmountInput)).toEqual([openOracleCopy.initialToken1AmountHelpText, 'REP'])
		expect(settlementTimeInput.getAttribute('aria-invalid')).toBe('true')
		expect(settlementTimeInput.getAttribute('aria-describedby')?.split(' ')[0]).toBe('open-oracle-settlement-time-error')
		expectPoliteFieldError('Settlement time must be greater than dispute delay.')

		await act(() => {
			fireEvent.input(settlementTimeInput, { target: { value: '20' } })
			fireEvent.input(feePercentageInput, { target: { value: '60' } })
			fireEvent.input(protocolFeeInput, { target: { value: '50.00001' } })
			protocolFeeInput.dispatchEvent(new Event('blur'))
		})
		expect(settlementTimeInput.hasAttribute('aria-invalid')).toBe(false)
		expect(protocolFeeInput.getAttribute('aria-invalid')).toBe('true')
		expect(protocolFeeInput.getAttribute('aria-describedby')).toBe('open-oracle-protocol-fee-error')
		expectPoliteFieldError('Fee percentage plus protocol fee must not exceed 100%.')
		expect(documentQueries.getByRole('button', { name: 'Create standalone oracle report' }).getAttribute('aria-describedby')).toBe('open-oracle-protocol-fee-error')
	})

	test('clears address touch state when successful creation resets the form', async () => {
		const renderedComponent = await renderIntoDocument(h(OpenOracleSection, createOpenOracleSectionProps()))
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		const baseTokenAddressInput = documentQueries.getByLabelText('Base token address')
		const quoteTokenAddressInput = documentQueries.getByLabelText('Quote token address')

		await act(() => {
			baseTokenAddressInput.dispatchEvent(new Event('blur'))
			quoteTokenAddressInput.dispatchEvent(new Event('blur'))
		})
		expect(documentQueries.getByText('Enter a valid base token address.')).not.toBeNull()
		expect(documentQueries.getByText('Enter a valid quote token address.')).not.toBeNull()

		await act(() => {
			render(
				h(
					OpenOracleSection,
					createOpenOracleSectionProps({
						loadBrowseReports: async () => ({ nextReportId: 0n, pageIndex: 0, pageSize: 25, reportCount: 0n, reports: [] }),
						openOracleResult: {
							action: 'createReportInstance',
							hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
						},
					}),
				),
				renderedComponent.container,
			)
		})

		expect(document.querySelector('input[aria-label="Base token address"]')).toBeNull()
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Create another' }))
		})
		const resetBaseTokenAddressInput = documentQueries.getByLabelText('Base token address')
		const resetQuoteTokenAddressInput = documentQueries.getByLabelText('Quote token address')
		expect(resetBaseTokenAddressInput.hasAttribute('aria-invalid')).toBe(false)
		expect(resetQuoteTokenAddressInput.hasAttribute('aria-invalid')).toBe(false)
		expect(resetBaseTokenAddressInput.hasAttribute('aria-describedby')).toBe(false)
		expect(resetQuoteTokenAddressInput.hasAttribute('aria-describedby')).toBe(false)
		expect(document.getElementById('open-oracle-token1-address-error')).toBeNull()
		expect(document.getElementById('open-oracle-token2-address-error')).toBeNull()
		expect(document.body.querySelectorAll('.field-error')).toHaveLength(0)
	})

	test('automatically disables the dispute launcher when its submission reserve starts', async () => {
		cleanupRenderedComponent = (
			await renderIntoDocument(
				<OpenOracleSection
					{...createOpenOracleSectionProps({
						activeView: 'selected-report',
						openOracleReportDetails: createOpenOracleReportDetails({ currentReporter: '0x3000000000000000000000000000000000000000', currentTime: 100n, disputeDelay: 0n, reportTimestamp: 100n, settlementTime: 61n, timeType: true }),
					})}
				/>,
			)
		).cleanup
		const page = within(document.body)
		expectTransactionButtonEnabled(document.body, 'Dispute & swap')
		await act(async () => await new Promise(resolve => setTimeout(resolve, 1150)))
		expectTransactionButtonDisabled(document.body, 'Dispute & swap')
		expect(getDescriptionTexts(page.getByRole('button', { name: 'Dispute & swap' })).join(' ')).toContain('Dispute window ends too soon')
		expectTransactionButtonDisabled(document.body, 'Settle report')
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
		expect(documentQueries.queryByRole('button', { name: 'Dispute & swap' })).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Settle report' })).not.toBeNull()
	})

	test('counts down to settlement and enables the report action at zero', async () => {
		const reloads: string[] = []
		const settle = mock(() => undefined)
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={100n}>
				<OpenOracleSection
					{...createOpenOracleSectionProps({
						activeView: 'selected-report',
						onLoadOracleReport: () => reloads.push('report'),
						onSettleReport: settle,
						openOracleForm: { ...getDefaultOpenOracleFormState(), reportId: '7' },
						openOracleReportDetails: createOpenOracleReportDetails({
							currentReporter: '0x3000000000000000000000000000000000000000',
							currentTime: 100n,
							disputeDelay: 0n,
							reportTimestamp: 100n,
							settlementTime: 2n,
							timeType: true,
						}),
						openOracleReportLookupState: 'ready',
					})}
				/>
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const page = within(document.body)
		expect(page.getByText('Settle in 2s')).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Settle report')
		await act(async () => await new Promise(resolve => setTimeout(resolve, 1150)))
		expect(page.getByText('Settle in 1s')).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Settle report')
		await act(async () => await new Promise(resolve => setTimeout(resolve, 1150)))
		expect(page.queryByText('Settle in 1s')).toBeNull()
		expectTransactionButtonEnabled(document.body, 'Settle report')
		expect(reloads).toContain('report')
		await act(() => fireEvent.click(page.getByRole('button', { name: 'Settle report' })))
		expect(page.queryByRole('dialog')).toBeNull()
		expect(settle).toHaveBeenCalledTimes(1)
	})

	test('starts a new settlement countdown when the deadline refresh finds a dispute', async () => {
		function ReportHarness() {
			const [report, setReport] = useState(
				createOpenOracleReportDetails({
					currentReporter: '0x3000000000000000000000000000000000000000',
					currentTime: 100n,
					disputeDelay: 0n,
					reportTimestamp: 100n,
					settlementTime: 1n,
					timeType: true,
				}),
			)
			return (
				<OpenOracleSection
					{...createOpenOracleSectionProps({
						activeView: 'selected-report',
						onLoadOracleReport: () => setReport(current => ({ ...current, currentTime: 101n, disputeOccurred: true, reportTimestamp: 101n, settlementTime: 60n })),
						openOracleReportDetails: report,
						openOracleReportLookupState: 'ready',
					})}
				/>
			)
		}
		cleanupRenderedComponent = (await renderIntoDocument(<ReportHarness />)).cleanup
		const page = within(document.body)
		expect(page.getByText('Settle in 1s')).not.toBeNull()
		await act(async () => await new Promise(resolve => setTimeout(resolve, 1150)))
		expect(page.getByText('Settle in 1m 0s')).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Settle report')
	})

	test('refreshes a report when chain time jumps directly to its deadline', async () => {
		const reloads: string[] = []
		function ReportHarness() {
			const [report, setReport] = useState(createOpenOracleReportDetails({ currentReporter: '0x3000000000000000000000000000000000000000', currentTime: 100n, disputeDelay: 0n, reportTimestamp: 100n, settlementTime: 60n, timeType: true }))
			return (
				<ChainTimestampContext.Provider value={160n}>
					<OpenOracleSection
						{...createOpenOracleSectionProps({
							activeView: 'selected-report',
							onLoadOracleReport: () => {
								reloads.push('report')
								setReport(current => ({ ...current, currentTime: 160n, disputeOccurred: true, reportTimestamp: 160n, settlementTime: 60n }))
							},
							openOracleReportDetails: report,
							openOracleReportLookupState: 'ready',
						})}
					/>
				</ChainTimestampContext.Provider>
			)
		}
		cleanupRenderedComponent = (await renderIntoDocument(<ReportHarness />)).cleanup
		await act(async () => await new Promise(resolve => setTimeout(resolve, 1150)))
		expect(reloads).toContain('report')
		expect(within(document.body).getByText('Settle in 1m 0s')).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Settle report')
	})

	test('refreshes an overdue report once without polling away action errors', async () => {
		const reloads: string[] = []
		function ReportHarness() {
			const [report, setReport] = useState(createOpenOracleReportDetails({ currentReporter: '0x3000000000000000000000000000000000000000', currentTime: 160n, disputeDelay: 0n, reportTimestamp: 100n, settlementTime: 60n, timeType: true }))
			return (
				<OpenOracleSection
					{...createOpenOracleSectionProps({
						activeView: 'selected-report',
						onLoadOracleReport: () => {
							reloads.push('report')
							setReport(current => ({ ...current, currentTime: current.currentTime + 1n }))
						},
						openOracleReportDetails: report,
						openOracleReportLookupState: 'ready',
					})}
				/>
			)
		}
		cleanupRenderedComponent = (await renderIntoDocument(<ReportHarness />)).cleanup
		await act(async () => await new Promise(resolve => setTimeout(resolve, 400)))
		expect(reloads).toEqual(['report'])
		await act(async () => await new Promise(resolve => setTimeout(resolve, 5500)))
		expect(reloads).toEqual(['report'])
	})

	test('keeps the settlement countdown moving above one hour', async () => {
		cleanupRenderedComponent = (
			await renderIntoDocument(
				<OpenOracleSection
					{...createOpenOracleSectionProps({
						activeView: 'selected-report',
						openOracleReportDetails: createOpenOracleReportDetails({
							currentReporter: '0x3000000000000000000000000000000000000000',
							currentTime: 100n,
							disputeDelay: 0n,
							reportTimestamp: 100n,
							settlementTime: 3602n,
							timeType: true,
						}),
					})}
				/>,
			)
		).cleanup
		const page = within(document.body)
		expect(page.getByText('Settle in 1h 0m 2s')).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Settle report')
		await act(async () => await new Promise(resolve => setTimeout(resolve, 1150)))
		expect(page.getByText('Settle in 1h 0m 1s')).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Settle report')
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
		expect(documentQueries.queryByRole('button', { name: 'Dispute & swap' })).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Settle report' })).not.toBeNull()
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
					openOracleWithdrawableBalances: { ethAttoEth: 7n * ATTO_ETH_PER_ETH, token1: 100n * ATTO_ETH_PER_ETH, token2: 0n },
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Your oracle balances')).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Report actions' })).toBeNull()
		fireEvent.click(documentQueries.getByRole('button', { name: 'Withdraw ETH' }))
		expect(documentQueries.queryByRole('dialog')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Transaction review' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: `Withdraw ${reportDetails.token2Symbol}` })).toBeNull()
		expect(withdrawnBalances).toEqual(['ethAttoEth'])
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
					openOracleActiveWithdrawalBalance: 'ethAttoEth',
					openOracleReportDetails: reportDetails,
					openOracleWithdrawableBalances: { ethAttoEth: 7n, token1: 100n, token2: 0n },
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('button', { name: 'Withdrawing ETH…' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: `Withdraw ${reportDetails.token1Symbol}` })).not.toBeNull()
		expectTransactionButtonDisabled(document.body, `Withdraw ${reportDetails.token1Symbol}`)
	})

	test('shows changed-balance recovery beside the withdrawal action', async () => {
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
						message: 'Your withdrawable REPv2 balance changed. Try withdrawing the updated balance again.',
					},
					openOracleWithdrawableBalances: { ethAttoEth: 0n, token1: 125n * ATTO_ETH_PER_ETH, token2: 0n },
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Withdraw REPv2' }))

		expect(documentQueries.queryByRole('dialog')).toBeNull()
		expect(documentQueries.getByRole('alert').textContent).toContain('Your withdrawable REPv2 balance changed. Try withdrawing the updated balance again.')
		expectTransactionButtonEnabled(document.body, 'Withdraw REPv2')
	})

	test('cancels an in-progress withdrawal balance check when leaving the report', async () => {
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
					openOracleWithdrawableBalances: { ethAttoEth: 7n * ATTO_ETH_PER_ETH, token1: 0n, token2: 0n },
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Withdraw ETH' }))
		await renderedComponent.cleanup()
		cleanupRenderedComponent = undefined

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

	test('closes the dispute form only after the matching dispute succeeds', async () => {
		const presentation = signal<GlobalTransactionPresentation | undefined>(undefined)
		const result = signal<OpenOracleSectionProps['openOracleResult']>(undefined)
		function Harness() {
			return (
				<GlobalTransactionPresentationProvider transaction={presentation.value}>
					<OpenOracleSection
						{...createOpenOracleSectionProps({
							activeView: 'selected-report',
							openOracleResult: result.value,
							openOracleReportDetails: createOpenOracleReportDetails({ currentReporter: '0x3000000000000000000000000000000000000000', currentTime: 200n, disputeDelay: 10n, reportTimestamp: 100n, settlementTime: 200n }),
						})}
					/>
				</GlobalTransactionPresentationProvider>
			)
		}
		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup
		const page = within(document.body)
		await act(() => fireEvent.click(page.getByRole('button', { name: 'Dispute & swap' })))
		expect(page.getByRole('dialog')).not.toBeNull()
		await act(() => {
			presentation.value = { tone: 'pending', title: 'Dispute pending', operationKey: 'dispute', hash: '0x01' }
		})
		await act(() => {
			result.value = { action: 'dispute', hash: '0x01' }
			presentation.value = { tone: 'success', title: 'Dispute confirmed', operationKey: 'dispute', hash: '0x01' }
		})
		expect(page.queryByRole('dialog')).toBeNull()
	})

	for (const [dialogName, launcherName, report] of [
		['Dispute & swap', 'Dispute & swap', { currentAmount1: 10n * 10n ** 18n, currentAmount2: 5n * 10n ** 18n, currentReporter: '0x3000000000000000000000000000000000000000', currentTime: 200n, disputeDelay: 10n, escalationHalt: 20n * 10n ** 18n, multiplier: 20_000n, reportTimestamp: 100n, settlementTime: 200n }],
	] as const)
		for (const [blockedAccount, fixLabel] of [
			[createAccountState({ address: undefined }), 'Connect wallet'],
			[createAccountState({ chainId: '0x1' }), 'Switch to Sepolia'],
		] as const)
			test(`offers the ${fixLabel} fix inside the ${dialogName} dialog when the wallet changes while it is open`, async () => {
				const { calls, walletActions } = createWalletActions()
				const renderSection = (accountState: AccountState) => (
					<WalletActionsProvider walletActions={walletActions}>
						<OpenOracleSection
							{...createOpenOracleSectionProps({ accountState, activeView: 'selected-report', openOracleForm: { ...getDefaultOpenOracleFormState(), disputeNewAmount1: '11', disputeNewAmount2: '7', reportId: '7' }, openOracleReportDetails: createOpenOracleReportDetails(report), openOracleReportLookupState: 'ready' })}
						/>
					</WalletActionsProvider>
				)
				const rendered = await renderIntoDocument(renderSection(createAccountState()))
				cleanupRenderedComponent = rendered.cleanup
				await act(() => fireEvent.click(within(document.body).getByRole('button', { name: launcherName })))
				await act(() => render(renderSection(blockedAccount), rendered.container))
				const dialog = within(document.body).getByRole('dialog', { name: dialogName })
				expect(within(dialog).getAllByRole('button', { name: fixLabel })).toHaveLength(1)
				const fix = expectWalletFixDescribesAction(dialog, dialogName, fixLabel)
				await act(() => fireEvent.click(fix))
				expect(calls).toEqual([fixLabel === 'Connect wallet' ? 'connect' : 'switch'])
			})
	test('prepares the pending reporting price report and settles with one click', async () => {
		const settle = mock(() => undefined)
		const load = mock(() => undefined)
		const oracle = createOpenOracleSectionProps({
			onSettleReport: settle,
			onLoadOracleReport: load,
			openOracleForm: { ...getDefaultOpenOracleFormState(), reportId: '7' },
			openOracleReportDetails: createOpenOracleReportDetails({ currentReporter: '0x3000000000000000000000000000000000000000', currentTime: 200n, reportTimestamp: 100n, settlementTime: 2n, timeType: true }),
		})
		const rendered = await renderIntoDocument(<ReportingOracleBlocker blocked manager={createOracleManagerDetails({ pendingReportId: 7n, pendingReportReadyAtTimestamp: 102n })} now={200n} onRequest={() => undefined} requestReason={undefined} onRefresh={() => undefined} oracle={oracle} onViewReport={() => undefined} />)
		cleanupRenderedComponent = rendered.cleanup
		expect(load).toHaveBeenCalledWith('7')
		expect(settle).toHaveBeenCalledTimes(0)
		fireEvent.click(within(document.body).getByRole('button', { name: 'Settle report #7' }))
		expect(settle).toHaveBeenCalledTimes(1)
		expect(within(document.body).queryByRole('dialog')).toBeNull()
	})
	for (const [account, fixLabel] of [
		[createAccountState({ address: undefined }), 'Connect wallet'],
		[createAccountState({ chainId: '0x1' }), 'Switch to Sepolia'],
	] as const) {
		test(`offers ${fixLabel} directly on oracle settlement`, async () => {
			const { calls, walletActions } = createWalletActions()
			const settled = mock(() => undefined)
			const rendered = await renderIntoDocument(
				<WalletActionsProvider walletActions={walletActions}>
					<OpenOracleSection
						{...createOpenOracleSectionProps({
							accountState: account,
							activeView: 'selected-report',
							onSettleReport: settled,
							openOracleReportDetails: createOpenOracleReportDetails({ currentReporter: '0x3000000000000000000000000000000000000000', currentTime: 200n, reportTimestamp: 100n, settlementTime: 2n, timeType: true }),
						})}
					/>
				</WalletActionsProvider>,
			)
			cleanupRenderedComponent = rendered.cleanup
			fireEvent.click(expectWalletFixDescribesAction(document.body, 'Settle report', fixLabel))
			expect(settled).toHaveBeenCalledTimes(0)
			expect(calls).toEqual([fixLabel === 'Connect wallet' ? 'connect' : 'switch'])
		})
	}
})
