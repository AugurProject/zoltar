/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { h, render } from 'preact'
import { useState } from 'preact/hooks'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { ReportingSection } from '../../../features/reporting/components/ReportingSection.js'
import { formatDuration, formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getReportingLockedUntilMessage } from '../../../features/reporting/lib/reporting.js'
import { computeEscalationTimeSinceStartFromAttritionCostAttoRep, ESCALATION_GAME_ACTIVATION_DELAY, getEscalationBalanceTuple, getEscalationBindingCapitalAttoRep } from '../../../features/reporting/lib/reportingDomain.js'
import type { AccountState, ReportingFormState } from '../../../types/app.js'
import type { ActiveReportingDetails, EscalationDeposit, MarketDetails, ReportingDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ReportingSectionProps } from '../../../features/types.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'

const ATTO_REP = 10n ** 18n

function rep(value: bigint) {
	return value * ATTO_REP
}

function getClosestSection(heading: HTMLElement | null) {
	if (heading === null) throw new Error('Expected heading to exist')
	const section = heading.closest('section')
	if (!(section instanceof HTMLElement)) throw new Error('Expected heading to be inside a section')
	return section
}

function getEscalationMetricsSection() {
	return getClosestSection(within(document.body).getByRole('heading', { name: 'Escalation Metrics' }))
}

function getReportOutcomeSection() {
	return getClosestSection(within(document.body).getByRole('heading', { name: 'Report Outcome' }))
}

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalanceAttoEth: 0n,
		wethBalanceAttoEth: 0n,
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
		endTime: 100n,
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

function createDeposit(overrides: Partial<EscalationDeposit> = {}): EscalationDeposit {
	return {
		amountAttoRep: rep(1n),
		cumulativeAmountAttoRep: rep(1n),
		depositIndex: 0n,
		depositor: zeroAddress,
		...overrides,
	}
}

function createReportingDetails(overrides: Partial<ActiveReportingDetails> = {}): ActiveReportingDetails {
	return {
		bindingCapital: rep(10n),
		settlementCollateralAttoEth: 1n,
		currentRequiredBond: rep(20n),
		currentTime: 150n,
		escalationEndTime: 300n,
		escalationGameAddress: zeroAddress,
		forkThresholdAttoRep: rep(40n),
		hasReachedNonDecision: false,
		marketDetails: createMarketDetails(),
		nonDecisionThresholdAttoRep: rep(20n),
		questionOutcome: 'none',
		securityPoolAddress: zeroAddress,
		sides: [
			{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			{ balance: rep(5n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [createDeposit()] },
			{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
		],
		activationTime: 120n,
		startBondAttoRep: rep(3n),
		status: 'active',
		systemState: 'operational',
		totalCostAttoRep: rep(20n),
		universeId: 1n,
		settlementState: 'locked',
		parentWithdrawalEnabled: false,
		viewerPoolHeldVaultRepBackingAttoRep: 10n * ATTO_REP,
		viewerVaultExists: true,
		viewerVaultDisputeStakedAttoRep: 1n * ATTO_REP,
		viewerVaultRepBackingAttoRep: 11n * ATTO_REP,
		...overrides,
	}
}

function createDynamicReportingDetails(overrides: Partial<ActiveReportingDetails> = {}): ActiveReportingDetails {
	const sides = overrides.sides ?? [
		{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
		{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [createDeposit()] },
		{ balance: rep(3n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
	]
	const startBondAttoRep = overrides.startBondAttoRep ?? rep(1n)
	const nonDecisionThresholdAttoRep = overrides.nonDecisionThresholdAttoRep ?? rep(20n)
	const forkThresholdAttoRep = overrides.forkThresholdAttoRep ?? nonDecisionThresholdAttoRep * 2n
	const activationTime = overrides.activationTime ?? 120n
	const currentTime = overrides.currentTime ?? 150n
	const bindingCapital = getEscalationBindingCapitalAttoRep(getEscalationBalanceTuple(sides))
	const escalationEndTime = activationTime + computeEscalationTimeSinceStartFromAttritionCostAttoRep(startBondAttoRep, nonDecisionThresholdAttoRep, bindingCapital)

	const baseDetails: ActiveReportingDetails = {
		bindingCapital,
		settlementCollateralAttoEth: 1n,
		currentRequiredBond: rep(2n),
		currentTime,
		escalationEndTime,
		escalationGameAddress: zeroAddress,
		forkThresholdAttoRep,
		hasReachedNonDecision: false,
		marketDetails: createMarketDetails(),
		nonDecisionThresholdAttoRep,
		questionOutcome: 'none',
		securityPoolAddress: zeroAddress,
		sides,
		startBondAttoRep,
		activationTime,
		status: 'active',
		systemState: 'operational',
		totalCostAttoRep: 0n,
		universeId: 1n,
		settlementState: 'locked',
		parentWithdrawalEnabled: false,
		viewerPoolHeldVaultRepBackingAttoRep: 10n * ATTO_REP,
		viewerVaultExists: true,
		viewerVaultDisputeStakedAttoRep: 1n * ATTO_REP,
		viewerVaultRepBackingAttoRep: 11n * ATTO_REP,
	}

	return {
		...baseDetails,
		...overrides,
		bindingCapital,
		currentTime,
		escalationEndTime,
		forkThresholdAttoRep,
		nonDecisionThresholdAttoRep,
		sides,
		startBondAttoRep,
		activationTime,
	}
}

function createNotStartedReportingDetails(overrides: Partial<Extract<ReportingDetails, { status: 'not-started' }>> = {}): ReportingDetails {
	return {
		settlementCollateralAttoEth: 1n * ATTO_REP,
		currentTime: 150n,
		forkThresholdAttoRep: rep(100n),
		marketDetails: createMarketDetails(),
		nonDecisionThresholdAttoRep: rep(50n),
		questionOutcome: 'none',
		securityPoolAddress: zeroAddress,
		startBondAttoRep: rep(3n),
		status: 'not-started',
		systemState: 'operational',
		universeId: 1n,
		settlementState: 'locked',
		parentWithdrawalEnabled: false,
		viewerPoolHeldVaultRepBackingAttoRep: 10n * ATTO_REP,
		viewerVaultExists: true,
		viewerVaultDisputeStakedAttoRep: 0n,
		viewerVaultRepBackingAttoRep: 10n * ATTO_REP,
		...overrides,
	}
}

function createSelectedWithdrawDepositIndexesByOutcome(overrides: Partial<ReportingFormState['selectedWithdrawDepositIndexesByOutcome']> = {}): ReportingFormState['selectedWithdrawDepositIndexesByOutcome'] {
	return {
		invalid: [],
		yes: [],
		no: [],
		...overrides,
	}
}

function createReportingForm(overrides: Partial<ReportingFormState> = {}): ReportingFormState {
	return {
		reportAmount: '1',
		securityPoolAddress: zeroAddress,
		selectedOutcome: undefined,
		selectedWithdrawDepositIndexesByOutcome: createSelectedWithdrawDepositIndexesByOutcome(),
		...overrides,
	}
}

function createProps(overrides: Partial<ReportingSectionProps> = {}): ReportingSectionProps {
	return {
		accountState: createAccountState(),
		currentTimestamp: 150n,
		embedInCard: false,
		loadingReportingDetails: false,
		onApproveReportingRep: () => undefined,
		onLoadReporting: () => undefined,
		onReportOutcome: () => undefined,
		onReportingFormChange: () => undefined,
		onWithdrawEscalation: (_outcome, _depositIndexes) => undefined,
		previewMarketDetails: createMarketDetails(),
		reportingActiveAction: undefined,
		reportingDetails: createReportingDetails(),
		reportingError: undefined,
		reportingForm: createReportingForm(),
		reportingResult: undefined,
		showHeader: false,
		showSecurityPoolAddressInput: false,
		...overrides,
	}
}

function ReportingSectionHarness({ initialProps }: { initialProps?: Partial<ReportingSectionProps> }) {
	const [reportingForm, setReportingForm] = useState<ReportingFormState>(createReportingForm(initialProps?.reportingForm))

	return (
		<ReportingSection
			{...createProps(initialProps)}
			reportingForm={reportingForm}
			onReportingFormChange={changes => {
				initialProps?.onReportingFormChange?.(changes)
				setReportingForm(currentForm => ({
					...currentForm,
					...changes,
				}))
			}}
		/>
	)
}

function findProjectionPreviewElement() {
	const preview = document.body.querySelector('.reporting-workflow-section')
	return preview instanceof HTMLElement ? preview : null
}

function findProjectionPreviewText() {
	return findProjectionPreviewElement()?.textContent ?? ''
}
describe('ReportingSection', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	test('describes reporting timing with question terminology', () => {
		const message = getReportingLockedUntilMessage(100n, 50n)

		expect(message).toContain("this pool's underlying question ends")
		expect(message).not.toContain("this pool's market ends")
	})

	test('uses wall-clock relative timing when the chain timestamp is unavailable', () => {
		const originalDateNow = Date.now
		Date.now = () => 50_000
		try {
			expect(getReportingLockedUntilMessage(100n, undefined)).toContain('(in less than a minute)')
		} finally {
			Date.now = originalDateNow
		}
	})

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('starts unselected until the user explicitly chooses an outcome side', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Active' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Reporting Workflow' })).toBeNull()
		expect(document.body.querySelector('.reporting-workflow-section')).toBeNull()
		expect(document.body.querySelector('.workflow-summary-strip')).toBeNull()
		expect(document.body.textContent?.includes('Current guidance')).toBe(false)
		expect(document.body.textContent?.includes('Reporting is the dispute game that locks vault REP behind an outcome until the market finalizes or forks.')).toBe(false)
		expect(document.body.textContent?.includes('These values show how much stake is required, how long the current dispute window lasts, and whether the question is close to finalization.')).toBe(false)
		expect(document.body.textContent?.includes('Escalation is live. Review the bond, side balances, and time remaining before contributing or withdrawing.')).toBe(false)
		expect(document.body.textContent?.includes('Selected side currently has')).toBe(false)
		expect(documentQueries.queryByRole('button', { name: 'Outcome Side' })).toBeNull()
		expect(document.body.querySelectorAll('.escalation-side.selected').length).toBe(0)
		expect(document.body.textContent?.includes('Select an outcome side above to enable reporting.')).toBe(true)
	})

	test('renders active reporting without the lifecycle banner and no reporting context card', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingForm: createReportingForm({
						reportAmount: '3',
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Reporting Context' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Active' })).toBeNull()
		expect(document.body.querySelector('.reporting-header-stack')).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Min to take the lead' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Max profit' })).not.toBeNull()
		expect(document.body.textContent?.includes('Selected side currently has')).toBe(false)
		expect((documentQueries.getByRole('radio', { name: /^Yes/ }) as HTMLButtonElement).textContent?.includes('Selected')).toBe(true)
		expect(document.body.textContent?.includes('Settle Escalation Deposits')).toBe(true)
		expect(document.body.querySelector('.transaction-object-context')).toBeNull()
	})

	test('suppresses the Pending Start banner once an escalation game has been initialized', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					currentTimestamp: 110n,
					reportingDetails: createDynamicReportingDetails({
						currentTime: 110n,
						activationTime: 120n,
					}),
					reportingForm: createReportingForm({
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Pending Start' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Report Outcome' })).not.toBeNull()
	})

	test('keeps the outcome cards unselected when reporting is locked', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					lockedReason: 'Reporting opens after market end.',
					reportingDetails: undefined,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: 'Outcome Side' })).toBeNull()
		expect(document.body.querySelectorAll('.escalation-side.selected').length).toBe(0)
	})

	test('renders Reporting Not Enabled before market end', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					currentTimestamp: 50n,
					reportingDetails: undefined,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Reporting Not Enabled' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Reporting Context' })).toBeNull()
		expect(documentQueries.queryByText('Opens In')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Escalation Metrics' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Report Outcome' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Settle Escalation Deposits' })).toBeNull()
		expect(document.body.textContent?.includes(getReportingLockedUntilMessage(100n, 50n))).toBe(true)
	})

	test('renders Reporting Open when the market has ended but details are not loaded', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					currentTimestamp: 150n,
					reportingDetails: undefined,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Reporting Open' })).not.toBeNull()
		expect(document.body.textContent?.includes('Loading reporting details.')).toBe(true)
	})

	test('keeps reporting locked at the exact market end timestamp until the next second', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					currentTimestamp: 100n,
					reportingDetails: undefined,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Reporting Not Enabled' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Reporting Open' })).toBeNull()
		expect(document.body.textContent?.includes(getReportingLockedUntilMessage(100n, 100n))).toBe(true)
	})

	test('shows resolved state for finalized pools even when no escalation game was started', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createNotStartedReportingDetails({
						questionOutcome: 'yes',
						settlementState: 'resolved',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('Question finalized as Yes.')).toBe(true)
	})

	test('does not show resolved state before an own-fork child pool becomes operational', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createNotStartedReportingDetails({
						questionOutcome: 'yes',
						systemState: 'forkMigration',
						settlementState: 'locked',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Resolved' })).toBeNull()
		expect(document.body.textContent?.includes('Question finalized as Yes.')).toBe(false)
	})

	test('does not render inline button-local reporting feedback when no reporting result is present', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Reporting submitted')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Latest Reporting Action' })).toBeNull()
	})

	test('keeps escalation metrics inside Escalation Metrics', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricsSection = getEscalationMetricsSection()
		const metricsQueries = within(metricsSection)
		expect(metricsQueries.queryByText('Current Bond')).toBeNull()
		expect(metricsQueries.getByText('Non-decision threshold')).not.toBeNull()
		expect(metricsQueries.getByText('Time Left')).not.toBeNull()
		expect(metricsQueries.getByText('Escalation started')).not.toBeNull()
		expect(metricsQueries.getByText('Start bond')).not.toBeNull()
	})

	test('shows the exact one-attoREP difference between a not-started threshold and normalized bond', async () => {
		const threshold = rep(5n)
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createNotStartedReportingDetails({
						nonDecisionThresholdAttoRep: threshold,
						startBondAttoRep: threshold - 1n,
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricsText = getEscalationMetricsSection().textContent ?? ''
		expect(metricsText).toContain('5 REP')
		expect(metricsText).toContain('4.999999999999999999 REP')
		expect(metricsText).not.toContain('≈')
	})

	test('shows escalation started time as activation time minus the initial delay', async () => {
		const gameStartTimestamp = 120n
		const activationTime = ESCALATION_GAME_ACTIVATION_DELAY + gameStartTimestamp
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					currentTimestamp: gameStartTimestamp,
					reportingDetails: createDynamicReportingDetails({
						activationTime,
						currentTime: gameStartTimestamp,
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricsSection = getEscalationMetricsSection()
		expect(metricsSection.textContent?.includes(formatTimestamp(gameStartTimestamp))).toBe(true)
		expect(metricsSection.textContent?.includes(formatTimestamp(activationTime))).toBe(false)
	})

	test('keeps placeholder outcome cards visible inside Report Outcome before reporting details load', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps({ reportingDetails: undefined })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const reportOutcomeSection = getReportOutcomeSection()
		const amountInput = within(reportOutcomeSection).getByRole('textbox', { name: /^Contribution Amount \(REP\)/ })
		const firstSide = reportOutcomeSection.querySelector('.escalation-side')
		if (!(firstSide instanceof HTMLElement)) throw new Error('Expected escalation side to render')
		expect(reportOutcomeSection.querySelectorAll('.escalation-side')).toHaveLength(3)
		expect(reportOutcomeSection.textContent?.includes('Your deposits:')).toBe(false)
		expect(reportOutcomeSection.textContent?.includes('Projected payout for current amount')).toBe(false)
		expect(reportOutcomeSection.textContent?.includes('Projected profit if this side wins')).toBe(false)
		expect(reportOutcomeSection.textContent?.includes('Total side dispute-staked REP')).toBe(true)
		expect(reportOutcomeSection.textContent?.includes('Your side dispute-staked REP')).toBe(true)
		expect(firstSide.compareDocumentPosition(amountInput) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
	})

	test('disables reporting when deterministic prerequisites are missing', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					accountState: createAccountState({ address: undefined }),
					reportingForm: createReportingForm({
						reportAmount: '',
						selectedOutcome: 'no',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Report No', 'Connect a wallet before reporting on a question.')
		expect(document.body.querySelector('button[title="Connect a wallet before settling escalation deposits."]')).toBeNull()
	})

	test('blocks stale-price submission and links to the pool oracle recovery view', async () => {
		let openOracleCalls = 0
		const reason = "The pool's oracle price expired. Request a new price in Price Oracle, then retry."
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					onOpenPriceOracle: () => {
						openOracleCalls += 1
					},
					reportActionGuardMessage: reason,
					reportingForm: createReportingForm({
						reportAmount: '1',
						selectedOutcome: 'no',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Report No', 'A current pool oracle price is required before reporting.')
		expect(within(document.body).getByRole('status').textContent).toContain(reason)
		expect(document.body.textContent?.match(new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).toHaveLength(1)
		fireEvent.click(within(document.body).getByRole('button', { name: 'Manage pool price' }))
		expect(openOracleCalls).toBe(1)
	})

	test('shows the selected side details after an explicit outcome choice', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingForm: createReportingForm({
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const selectedButton = documentQueries.getByRole('radio', { name: /^Yes/ })
		expect(document.body.querySelectorAll('.escalation-side.selected').length).toBe(1)
		expect(document.body.textContent?.includes('Selected side currently has')).toBe(false)
		expect(selectedButton.textContent?.includes('Selected')).toBe(true)
		expect(document.body.textContent?.includes('Estimated profit if Yes wins')).toBe(false)
		expect(document.body.textContent?.includes('Assumes no later contributions.')).toBe(false)
	})

	test('removes the approval explainer copy and still blocks when pool-held vault REP backing is insufficient', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createReportingDetails({
						viewerPoolHeldVaultRepBackingAttoRep: 2n * ATTO_REP,
					}),
					reportingForm: createReportingForm({
						reportAmount: '5',
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(document.body.textContent?.includes('It does not spend wallet REP directly or require a wallet approval.')).toBe(false)
		expect(document.body.textContent?.includes('Pool-held vault REP backing available for reporting:')).toBe(true)
		expectTransactionButtonDisabled(document.body, 'Report Yes', "Deposit 3 more REP into your vault's pool-held backing before reporting.")
	})

	test('offers wallet REP approval to an active ordinary-game participant without a vault', async () => {
		let approvalCalls = 0
		const renderedComponent = await renderIntoDocument(
			<ReportingSectionHarness
				initialProps={{
					onApproveReportingRep: () => {
						approvalCalls += 1
					},
					reportingDetails: createReportingDetails({
						contributionFunding: 'wallet',
						viewerPoolHeldVaultRepBackingAttoRep: 0n,
						viewerVaultExists: false,
						viewerVaultRepBackingAttoRep: 0n,
						viewerWalletRepAllowanceAttoRep: 0n,
						viewerWalletRepBalanceAttoRep: rep(10n),
					}),
					reportingForm: createReportingForm({ reportAmount: '5', selectedOutcome: 'yes' }),
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent).toContain('Wallet REP available for reporting:')
		expect(document.body.textContent).not.toContain('Pool-held vault REP backing available for reporting:')
		expectTransactionButtonEnabled(document.body, 'Approve REP')
		expectTransactionButtonDisabled(document.body, 'Report Yes', 'Approve REP for this escalation game before reporting.')
		const reportButton = within(document.body).getByRole('button', { name: 'Report Yes' })
		const reportAction = reportButton.closest('.tx-action')
		const actionRow = reportButton.closest('.actions')
		const disabledReason = document.getElementById(reportButton.getAttribute('aria-describedby') ?? '')
		expect(actionRow?.classList.contains('reporting-wallet-action-row')).toBe(true)
		expect(Array.from(actionRow?.children ?? []).filter(child => child.classList.contains('tx-action'))).toHaveLength(2)
		expect(actionRow?.contains(disabledReason)).toBe(false)
		expect(reportAction?.contains(disabledReason)).toBe(false)
		expect(reportButton.closest('.reporting-shared-action-region')?.contains(disabledReason)).toBe(true)
		fireEvent.click(within(document.body).getByRole('button', { name: 'Approve REP' }))
		expect(approvalCalls).toBe(1)
	})

	test('preserves the wallet-report action positions after REP approval', async () => {
		const renderedComponent = await renderIntoDocument(
			<ReportingSectionHarness
				initialProps={{
					reportingDetails: createReportingDetails({
						contributionFunding: 'wallet',
						viewerPoolHeldVaultRepBackingAttoRep: 0n,
						viewerVaultExists: false,
						viewerVaultRepBackingAttoRep: 0n,
						viewerWalletRepAllowanceAttoRep: rep(10n),
						viewerWalletRepBalanceAttoRep: rep(10n),
					}),
					reportingForm: createReportingForm({ reportAmount: '5', selectedOutcome: 'yes' }),
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const actionButtons = within(document.body)
			.getAllByRole('button')
			.filter(button => button.textContent === 'REP approved' || button.textContent === 'Report Yes')
		const actionRow = actionButtons[1]?.closest('.actions')
		expect(actionButtons.map(button => button.textContent)).toEqual(['REP approved', 'Report Yes'])
		expect(actionRow?.classList.contains('reporting-wallet-action-row')).toBe(true)
		expect(Array.from(actionRow?.children ?? []).filter(child => child.classList.contains('tx-action'))).toHaveLength(2)
		expectTransactionButtonDisabled(document.body, 'REP approved')
		expectTransactionButtonEnabled(document.body, 'Report Yes')
	})

	test('renders a compact withdraw-only mode without the reporting banner or report form', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					mode: 'withdraw-only',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Reporting Context' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Report Outcome' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Active' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Settle Escalation Deposits' })).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Settle selected Yes deposits')
		expectTransactionButtonDisabled(document.body, 'Settle all Yes deposits')
	})

	test('keeps finalized withdrawals enabled in withdraw-only mode after escalation closes', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					mode: 'withdraw-only',
					reportingDetails: createReportingDetails({
						questionOutcome: 'yes',
						settlementState: 'resolved',
						parentWithdrawalEnabled: true,
					}),
					reportingForm: createReportingForm({
						selectedWithdrawDepositIndexesByOutcome: createSelectedWithdrawDepositIndexesByOutcome({
							yes: [0n],
						}),
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const withdrawCheckbox = document.body.querySelector("input[type='checkbox']") as HTMLInputElement | null
		if (!(withdrawCheckbox instanceof HTMLInputElement)) throw new Error('Expected withdraw checkbox')
		expect(withdrawCheckbox.disabled).toBe(false)
		expectTransactionButtonEnabled(document.body, 'Settle selected Yes deposits')
		expectTransactionButtonEnabled(document.body, 'Settle all Yes deposits')
	})

	test('keeps reporting disabled off mainnet and shows the switch-network recovery', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					accountState: createAccountState({ chainId: '0xaa36a7' }),
					reportingForm: createReportingForm({
						reportAmount: '1',
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Report Yes')
		expect(document.body.textContent?.includes('Switch to Ethereum mainnet')).toBe(true)
	})

	test('keeps escalation settlement disabled off mainnet and shows the switch-network recovery', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					accountState: createAccountState({ chainId: '0xaa36a7' }),
					mode: 'withdraw-only',
					reportingDetails: createReportingDetails({
						questionOutcome: 'yes',
						settlementState: 'resolved',
						parentWithdrawalEnabled: true,
					}),
					reportingForm: createReportingForm({
						selectedWithdrawDepositIndexesByOutcome: createSelectedWithdrawDepositIndexesByOutcome({
							yes: [0n],
						}),
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Settle selected Yes deposits')
		expectTransactionButtonDisabled(document.body, 'Settle all Yes deposits')
		const reason = 'Switch to Ethereum mainnet.'
		expect(document.body.textContent?.split(reason)).toHaveLength(2)
		const settleSelectedButton = within(document.body).getByRole('button', { name: 'Settle selected Yes deposits' })
		const settleAllButton = within(document.body).getByRole('button', { name: 'Settle all Yes deposits' })
		const reasonId = settleSelectedButton.getAttribute('aria-describedby')
		expect(reasonId).not.toBeNull()
		expect(settleAllButton.getAttribute('aria-describedby')).toBe(reasonId)
		expect(document.getElementById(reasonId ?? '')?.textContent).toContain(reason)
	})

	test('shares one wallet recovery reason across escalation settlement actions', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					accountState: createAccountState({ address: undefined }),
					mode: 'withdraw-only',
					reportingDetails: createReportingDetails({
						questionOutcome: 'yes',
						settlementState: 'resolved',
						parentWithdrawalEnabled: true,
					}),
					reportingForm: createReportingForm({
						selectedWithdrawDepositIndexesByOutcome: createSelectedWithdrawDepositIndexesByOutcome({
							yes: [0n],
						}),
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const reason = 'Connect a wallet before settling escalation deposits.'
		expectTransactionButtonDisabled(document.body, 'Settle selected Yes deposits', reason)
		expectTransactionButtonDisabled(document.body, 'Settle all Yes deposits', reason)
		expect(document.body.textContent?.split(reason)).toHaveLength(2)
		const settleSelectedButton = within(document.body).getByRole('button', { name: 'Settle selected Yes deposits' })
		const settleAllButton = within(document.body).getByRole('button', { name: 'Settle all Yes deposits' })
		const reasonId = settleSelectedButton.getAttribute('aria-describedby')
		expect(reasonId).not.toBeNull()
		expect(settleAllButton.getAttribute('aria-describedby')).toBe(reasonId)
		expect(document.getElementById(reasonId ?? '')?.textContent).toContain(reason)
	})

	test('shows a locked-settlement reason before withdrawals unlock in active reporting', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					mode: 'withdraw-only',
					reportingDetails: createReportingDetails(),
					reportingForm: createReportingForm({
						selectedWithdrawDepositIndexesByOutcome: createSelectedWithdrawDepositIndexesByOutcome({
							yes: [0n],
						}),
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Settle selected Yes deposits', 'Escalation deposits cannot be settled until the question is finalized.')
		expectTransactionButtonDisabled(document.body, 'Settle all Yes deposits', 'Escalation deposits cannot be settled until the question is finalized.')
	})

	test('shows the report submission pending label while the report action is in flight', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingActiveAction: 'reportOutcome',
					reportingForm: createReportingForm({
						reportAmount: '3',
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('Submitting report…')).toBe(true)
		expect(document.body.textContent?.includes('Loading…')).toBe(false)
	})

	test('shows a loading notice and disables withdraw-only controls while deposits refresh', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					loadingReportingDetails: true,
					mode: 'withdraw-only',
					reportingDetails: createReportingDetails({
						questionOutcome: 'yes',
						settlementState: 'resolved',
						parentWithdrawalEnabled: true,
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('Loading escalation deposits…')).toBe(true)
		const withdrawCheckbox = document.body.querySelector("input[type='checkbox']") as HTMLInputElement | null
		if (!(withdrawCheckbox instanceof HTMLInputElement)) throw new Error('Expected withdraw checkbox')
		expect(withdrawCheckbox.disabled).toBe(true)
		expectTransactionButtonDisabled(document.body, 'Settle selected Yes deposits', 'Loading escalation deposits.')
		expectTransactionButtonDisabled(document.body, 'Settle all Yes deposits', 'Loading escalation deposits.')
	})

	test('shares one loading reason across report and settlement controls while retained details refresh', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					loadingReportingDetails: true,
					reportingDetails: createReportingDetails({
						sides: [
							{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(5n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [createDeposit()] },
							{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [createDeposit({ depositIndex: 1n })] },
						],
					}),
					reportingForm: createReportingForm({
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const reportButton = documentQueries.getByRole('button', { name: 'Report Yes' })
		const affectedButtons = [
			reportButton,
			documentQueries.getByRole('button', { name: 'Settle selected Yes deposits' }),
			documentQueries.getByRole('button', { name: 'Settle all Yes deposits' }),
			documentQueries.getByRole('button', { name: 'Settle selected No deposits' }),
			documentQueries.getByRole('button', { name: 'Settle all No deposits' }),
		]
		const sharedReason = 'Loading reporting details.'
		const sharedReasonId = reportButton.getAttribute('aria-describedby')

		expect((documentQueries.getByRole('radio', { name: /^Yes/ }) as HTMLButtonElement).disabled).toBe(true)
		expect((documentQueries.getByRole('textbox', { name: /^Contribution Amount \(REP\)/ }) as HTMLInputElement).disabled).toBe(true)
		for (const button of affectedButtons) {
			expect((button as HTMLButtonElement).disabled).toBe(true)
			expect(button.getAttribute('aria-describedby')).toBe(sharedReasonId)
		}
		expect(sharedReasonId).not.toBeNull()
		expect(document.body.textContent?.split(sharedReason)).toHaveLength(2)
		expect(document.getElementById(sharedReasonId ?? '')?.textContent).toContain(sharedReason)
	})

	test('shows the time-left metric inside Escalation Metrics', async () => {
		const reportingDetails = createReportingDetails()
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps({ reportingDetails })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricsSection = getEscalationMetricsSection()
		expect(metricsSection.textContent?.includes(formatDuration(300n - 150n))).toBe(true)
	})

	test('prefers the live chain timestamp over the loaded reporting snapshot for time left', async () => {
		const reportingDetails = createReportingDetails()
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					currentTimestamp: 200n,
					reportingDetails: {
						...reportingDetails,
						currentTime: 150n,
						escalationEndTime: 300n,
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes(formatDuration(300n - 100n))).toBe(false)
		expect(document.body.textContent?.includes(formatDuration(300n - 200n))).toBe(true)
	})

	test('keeps escalation active with zero time left at the exact timeout boundary', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					currentTimestamp: undefined,
					reportingDetails: {
						...createReportingDetails(),
						currentTime: 300n,
						escalationEndTime: 300n,
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Active' })).toBeNull()
		expect(document.body.textContent?.includes('Escalation ended by timeout. The winner is computed from the current dispute-staked REP totals; refresh reporting if the resolved outcome is not loaded yet.')).toBe(false)
		expect(document.body.textContent?.includes(formatDuration(0n))).toBe(true)
	})

	test('uses the live chain timestamp to flip the escalation phase only after the timeout boundary passes', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					currentTimestamp: 301n,
					reportingDetails: {
						...createReportingDetails(),
						currentTime: 150n,
						escalationEndTime: 300n,
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getAllByText('Timed Out').length).toBeGreaterThan(0)
		expect(document.body.textContent?.includes(formatDuration(0n))).toBe(true)
	})

	test('shares one refresh reason across settlement actions after escalation times out', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					currentTimestamp: 301n,
					mode: 'withdraw-only',
					reportingDetails: {
						...createReportingDetails(),
						currentTime: 150n,
						escalationEndTime: 300n,
					},
					reportingForm: createReportingForm({
						selectedWithdrawDepositIndexesByOutcome: createSelectedWithdrawDepositIndexesByOutcome({
							yes: [0n],
						}),
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const reason = 'Escalation has ended. Refresh reporting to view the finalized outcome before settling deposits.'
		expectTransactionButtonDisabled(document.body, 'Settle selected Yes deposits', reason)
		expectTransactionButtonDisabled(document.body, 'Settle all Yes deposits', reason)
		expect(document.body.textContent?.split(reason)).toHaveLength(2)
		const settleSelectedButton = within(document.body).getByRole('button', { name: 'Settle selected Yes deposits' })
		const settleAllButton = within(document.body).getByRole('button', { name: 'Settle all Yes deposits' })
		const reasonId = settleSelectedButton.getAttribute('aria-describedby')
		expect(reasonId).not.toBeNull()
		expect(settleAllButton.getAttribute('aria-describedby')).toBe(reasonId)
		expect(document.getElementById(reasonId ?? '')?.textContent).toContain(reason)
	})

	test('shows the finalized outcome in the resolved banner', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createReportingDetails({
						questionOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Resolved' })).not.toBeNull()
		expect(document.body.textContent?.includes('Question finalized as Yes.')).toBe(true)
		expect(document.body.textContent?.includes('Review any remaining deposits below.')).toBe(false)
	})

	test('does not show the resolved banner when the child outcome is known before operational finalization', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createReportingDetails({
						questionOutcome: 'yes',
						systemState: 'forkTruthAuction',
						settlementState: 'locked',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Resolved' })).toBeNull()
		expect(document.body.textContent?.includes('Question finalized as Yes.')).toBe(false)
	})

	test('disables reporting after the escalation timer ends', async () => {
		const reportingDetails = createDynamicReportingDetails()
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					currentTimestamp: reportingDetails.escalationEndTime + 1n,
					reportingDetails: createDynamicReportingDetails({
						currentTime: reportingDetails.escalationEndTime + 1n,
					}),
					reportingForm: createReportingForm({
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('radio', { name: /^Yes/ }) as HTMLButtonElement).disabled).toBe(true)
		expect((documentQueries.getByRole('textbox', { name: /^Contribution Amount \(REP\)/ }) as HTMLInputElement).disabled).toBe(true)
		expect((documentQueries.getByRole('button', { name: 'Max' }) as HTMLButtonElement).disabled).toBe(true)
		expect((documentQueries.getByRole('button', { name: 'Min to take the lead' }) as HTMLButtonElement).disabled).toBe(true)
		expect((documentQueries.getByRole('button', { name: 'Max profit' }) as HTMLButtonElement).disabled).toBe(true)
		expectTransactionButtonDisabled(document.body, 'Report Yes')
	})

	test('shows Fork Triggered instead of timeout when non-decision is reached first', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					currentTimestamp: 300n,
					reportingDetails: createReportingDetails({
						currentTime: 300n,
						escalationEndTime: 300n,
						hasReachedNonDecision: true,
					}),
					reportingForm: createReportingForm({
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const lifecycleBanner = getClosestSection(documentQueries.getByRole('heading', { name: 'Fork Triggered' }))
		const lifecycleBannerQueries = within(lifecycleBanner)
		expect(documentQueries.getByRole('heading', { name: 'Fork Triggered' })).not.toBeNull()
		const forkTriggeredReason = 'Escalation reached non-decision. Trigger the universe fork here if this pool should fork.'
		expect(document.body.textContent?.includes(forkTriggeredReason)).toBe(true)
		expect(document.body.textContent?.split(forkTriggeredReason)).toHaveLength(2)
		expect(lifecycleBannerQueries.queryByText('Trigger universe fork')).toBeNull()
		expect(lifecycleBannerQueries.queryByText('Continue in Fork & Migration')).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Report Yes', forkTriggeredReason)
		const reportButton = documentQueries.getByRole('button', { name: 'Report Yes' })
		const reportDescription = document.getElementById(reportButton.getAttribute('aria-describedby') ?? '')
		expect(reportDescription?.textContent).toContain(forkTriggeredReason)
	})

	test('shows Continue in Fork & Migration in the lifecycle banner after the fork has already been triggered', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					forkAlreadyTriggered: true,
					onOpenForkWorkflow: () => undefined,
					reportingDetails: createReportingDetails({
						hasReachedNonDecision: true,
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const lifecycleBanner = getClosestSection(documentQueries.getByRole('heading', { name: 'Fork Triggered' }))
		const lifecycleBannerQueries = within(lifecycleBanner)
		expect(document.body.textContent?.includes('Escalation reached non-decision and the universe fork has already been triggered for this pool. Continue in Fork & Migration.')).toBe(true)
		expect(lifecycleBannerQueries.queryByText('Continue in Fork & Migration')).toBeNull()
		expect(lifecycleBannerQueries.queryByText('Trigger universe fork')).toBeNull()
	})

	test('auto-refreshes reporting once when the live timestamp passes an unresolved timeout boundary', async () => {
		const onLoadReportingCalls: string[] = []
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					currentTimestamp: 301n,
					onLoadReporting: () => {
						onLoadReportingCalls.push('refresh')
					},
					reportingDetails: createReportingDetails({
						currentTime: 150n,
						escalationEndTime: 300n,
						securityPoolAddress: '0x00000000000000000000000000000000000000c1',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(onLoadReportingCalls).toEqual(['refresh'])

		await act(() => {
			render(
				h(
					ReportingSection,
					createProps({
						currentTimestamp: 301n,
						onLoadReporting: () => {
							onLoadReportingCalls.push('rerender')
						},
						reportingDetails: createReportingDetails({
							currentTime: 150n,
							escalationEndTime: 300n,
							securityPoolAddress: '0x00000000000000000000000000000000000000c1',
						}),
					}),
				),
				renderedComponent.container,
			)
		})

		expect(onLoadReportingCalls).toEqual(['refresh'])
	})

	test('does not auto-refresh reporting when non-decision closes escalation before timeout handling', async () => {
		const onLoadReportingCalls: string[] = []
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					currentTimestamp: 300n,
					onLoadReporting: () => {
						onLoadReportingCalls.push('refresh')
					},
					reportingDetails: createReportingDetails({
						currentTime: 150n,
						escalationEndTime: 300n,
						hasReachedNonDecision: true,
						securityPoolAddress: '0x00000000000000000000000000000000000000c2',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(onLoadReportingCalls).toEqual([])
	})

	test('renders a reporting-open notice with zeroed pre-start diagram values before the first report', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createNotStartedReportingDetails(),
					reportingForm: createReportingForm({
						reportAmount: '3',
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const metricsSection = getEscalationMetricsSection()
		const reportOutcomeSection = getReportOutcomeSection()
		expect(documentQueries.queryByRole('heading', { name: 'First Report Starts Escalation' })).toBeNull()
		expect(document.body.textContent?.includes('Reporting is open.')).toBe(true)
		expect(document.body.querySelector('.notice.success')?.textContent).toContain('Reporting is open.')
		expect(reportOutcomeSection.textContent?.includes('Your deposits:')).toBe(false)
		expect(reportOutcomeSection.textContent?.includes('Projected payout for current amount')).toBe(false)
		expect(reportOutcomeSection.textContent?.includes('Projected profit if this side wins')).toBe(false)
		expect(metricsSection.querySelector('[title="50 REP"]')).not.toBeNull()
		expect(metricsSection.querySelector('[title="3 REP"]')).not.toBeNull()
		expect(reportOutcomeSection.querySelectorAll('.currency-value.unavailable')).toHaveLength(0)
		expect(document.body.textContent?.includes('Load reporting details to populate live stakes')).toBe(false)
		expectTransactionButtonEnabled(document.body, 'Report Yes')
		expect(document.body.textContent?.includes('Timer Change')).toBe(false)
		expect(document.body.textContent?.includes('Recheck By')).toBe(false)
	})

	test('separates the 3-day first-report window from the later check-back deadline for larger first reports', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createNotStartedReportingDetails(),
					reportingForm: createReportingForm({
						reportAmount: '10',
						selectedOutcome: 'invalid',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('Timer Change')).toBe(false)
		expect(document.body.textContent?.includes('Recheck By')).toBe(false)
	})

	test('shows explicit outcome-selection guidance before the first report starts escalation', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createNotStartedReportingDetails(),
					reportingForm: createReportingForm({
						reportAmount: '3',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('Reporting is open. Select an outcome side below to enable reporting.')).toBe(false)
		expect(document.body.textContent?.includes('Select an outcome side above to enable reporting.')).toBe(true)
		expectTransactionButtonDisabled(document.body, 'Report on selected side', 'Select an outcome side before reporting on a question.')
	})

	test('disables report submission for a pre-start amount below the first-report minimum', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createNotStartedReportingDetails(),
					reportingForm: createReportingForm({
						reportAmount: '2',
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Report Yes', 'Enter at least 3 REP to start the escalation game.')
	})

	test('accepts decimal report amounts without the removed profit preview', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingForm: createReportingForm({
						reportAmount: '3.5',
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(findProjectionPreviewText()).toBe('')
		expect(document.body.textContent?.includes('Enter a valid report amount to preview profit.')).toBe(false)
		expect((within(document.body).getByRole('textbox', { name: /^Contribution Amount \(REP\)/ }) as HTMLInputElement).value).toBe('3.5')
	})

	test('does not render the removed timer-extension preview for contributions that raise binding capital', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createDynamicReportingDetails(),
					reportingForm: createReportingForm({
						reportAmount: '2',
						selectedOutcome: 'no',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(findProjectionPreviewElement()).toBeNull()
		expect(document.body.textContent?.includes('Estimated profit if No wins')).toBe(false)
		expect(document.body.textContent?.includes('Timer Change')).toBe(false)
	})

	test('does not render the removed no-extension preview when the selected contribution leaves binding capital unchanged', async () => {
		const reportingDetails = createDynamicReportingDetails()
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails,
					reportingForm: createReportingForm({
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(findProjectionPreviewText()).toBe('')
		expect(document.body.textContent?.includes('Estimated profit if Yes wins')).toBe(false)
		expect(document.body.textContent?.includes('Timer Change')).toBe(false)
	})

	test('does not render the removed immediate-finalization preview when the contribution creates a threshold tie', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createDynamicReportingDetails({
						nonDecisionThresholdAttoRep: rep(10n),
						sides: [
							{ balance: rep(10n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(9n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
					}),
					reportingForm: createReportingForm({
						reportAmount: '1',
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(findProjectionPreviewText()).toBe('')
		expect(document.body.textContent?.includes('Timer Change')).toBe(false)
		expect(document.body.textContent?.includes('Estimated profit if Yes wins')).toBe(false)
	})

	test('shows the accepted-deposit note when the typed contribution exceeds the remaining room on the selected side', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createDynamicReportingDetails({
						sides: [
							{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(19n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [createDeposit()] },
							{ balance: rep(3n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
					}),
					reportingForm: createReportingForm({
						reportAmount: '5',
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(findProjectionPreviewText()).toBe('')
		expect(document.body.textContent?.includes('from pool-held backing into dispute-staked REP')).toBe(true)
		expect(document.body.textContent?.includes('instead of the full entered amount.')).toBe(true)
	})

	test('autofills the active minimum-outcome-change preset', async () => {
		const renderedComponent = await renderIntoDocument(<ReportingSectionHarness initialProps={{ reportingForm: createReportingForm({ selectedOutcome: 'yes' }) }} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Min to take the lead' }))
		})

		const amountInput = within(document.body).getByRole('textbox', { name: /^Contribution Amount \(REP\)/ })
		expect((amountInput as HTMLInputElement).value).toBe('4')
	})

	test('autofills the active max-profit preset', async () => {
		const renderedComponent = await renderIntoDocument(<ReportingSectionHarness initialProps={{ reportingForm: createReportingForm({ selectedOutcome: 'yes' }) }} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Max profit' }))
		})

		const amountInput = within(document.body).getByRole('textbox', { name: /^Contribution Amount \(REP\)/ })
		expect((amountInput as HTMLInputElement).value).toBe('7')
		expect(findProjectionPreviewText()).toBe('')
	})

	test('autofills the max contribution with the smaller of outcome capacity and pool-held vault REP backing', async () => {
		const renderedComponent = await renderIntoDocument(
			<ReportingSectionHarness
				initialProps={{
					reportingDetails: createReportingDetails({
						nonDecisionThresholdAttoRep: rep(20n),
						sides: [
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(19n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
							{ balance: rep(4n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						startBondAttoRep: rep(1n),
						viewerPoolHeldVaultRepBackingAttoRep: rep(10n),
					}),
					reportingForm: createReportingForm({
						selectedOutcome: 'yes',
					}),
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Max' }))
		})

		const amountInput = within(document.body).getByRole('textbox', { name: /^Contribution Amount \(REP\)/ })
		expect((amountInput as HTMLInputElement).value).toBe('1')
	})

	test('autofills the max contribution with the remaining selected-side threshold capacity when that is smaller', async () => {
		const renderedComponent = await renderIntoDocument(
			<ReportingSectionHarness
				initialProps={{
					reportingDetails: createReportingDetails({
						sides: [
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(18n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
							{ balance: rep(4n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						nonDecisionThresholdAttoRep: rep(20n),
						startBondAttoRep: rep(1n),
						viewerPoolHeldVaultRepBackingAttoRep: rep(10n),
					}),
					reportingForm: createReportingForm({
						selectedOutcome: 'yes',
					}),
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Max' }))
		})

		const amountInput = within(document.body).getByRole('textbox', { name: /^Contribution Amount \(REP\)/ })
		expect((amountInput as HTMLInputElement).value).toBe('2')
	})

	test('autofills the pre-start max contribution with the threshold when it is smaller than pool-held vault REP backing', async () => {
		const renderedComponent = await renderIntoDocument(
			<ReportingSectionHarness
				initialProps={{
					reportingDetails: createNotStartedReportingDetails({
						nonDecisionThresholdAttoRep: rep(6n),
						viewerPoolHeldVaultRepBackingAttoRep: rep(10n),
						viewerVaultRepBackingAttoRep: rep(10n),
					}),
					reportingForm: createReportingForm({
						selectedOutcome: 'yes',
					}),
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Max' }))
		})

		const amountInput = within(document.body).getByRole('textbox', { name: /^Contribution Amount \(REP\)/ })
		expect((amountInput as HTMLInputElement).value).toBe('6')
	})

	test('autofills the pre-start minimum-outcome-change preset from the pool start bond', async () => {
		const renderedComponent = await renderIntoDocument(<ReportingSectionHarness initialProps={{ reportingDetails: createNotStartedReportingDetails(), reportingForm: createReportingForm({ selectedOutcome: 'yes' }) }} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Min to take the lead' }))
		})

		const amountInput = within(document.body).getByRole('textbox', { name: /^Contribution Amount \(REP\)/ })
		expect((amountInput as HTMLInputElement).value).toBe('3')
	})

	test('disables Max profit before the escalation game exists', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createNotStartedReportingDetails(),
					reportingForm: createReportingForm({
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const maxProfitButton = within(document.body).getByRole('button', { name: 'Max profit' }) as HTMLButtonElement
		expect(maxProfitButton.disabled).toBe(true)
		expect(maxProfitButton.title).toBe('Max profit becomes available after the escalation game starts.')
		expect(document.body.textContent?.includes('Max profit becomes available after the escalation game starts.')).toBe(false)
	})

	test('disables pre-start report submission when the contribution would exceed the remaining selected-side threshold capacity', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createNotStartedReportingDetails({
						nonDecisionThresholdAttoRep: rep(20n),
						startBondAttoRep: rep(1n),
						viewerPoolHeldVaultRepBackingAttoRep: rep(10n),
					}),
					reportingForm: createReportingForm({
						reportAmount: '25',
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Report Yes', 'Only 20 REP remains before the selected side reaches the threshold.')
	})

	test('allows active report submission when the entered amount is clamped to the remaining selected-side capacity', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createReportingDetails({
						sides: [
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(18n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
							{ balance: rep(4n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						nonDecisionThresholdAttoRep: rep(20n),
						startBondAttoRep: rep(1n),
						viewerPoolHeldVaultRepBackingAttoRep: rep(10n),
					}),
					reportingForm: createReportingForm({
						reportAmount: '5',
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Report Yes')
	})

	test('explains why escalation withdrawals stay disabled after fork is triggered', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					mode: 'withdraw-only',
					reportingDetails: createReportingDetails({
						hasReachedNonDecision: true,
						sides: [
							{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(5n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [createDeposit()] },
							{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const settlementReason = 'Dispute-staked REP remains in escalation after non-decision. Trigger the universe fork here if this pool should fork.'
		expect(document.body.textContent?.includes(settlementReason)).toBe(true)
		expect(document.body.textContent?.split(settlementReason)).toHaveLength(2)
		expectTransactionButtonDisabled(document.body, 'Settle all Yes deposits', settlementReason)
		const settleSelectedButton = within(document.body).getByRole('button', { name: 'Settle selected Yes deposits' })
		const settleAllButton = within(document.body).getByRole('button', { name: 'Settle all Yes deposits' })
		expect(settleSelectedButton.getAttribute('aria-describedby')).toBe(settleAllButton.getAttribute('aria-describedby'))
		expect(document.getElementById(settleAllButton.getAttribute('aria-describedby') ?? '')?.textContent).toContain(settlementReason)
	})

	test('shares one workflow lock reason across reporting and settlement actions', async () => {
		const sharedLockReason = 'This parent pool is forked. Continue in Fork & Migration for migration and settlement.'
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					lockedReason: sharedLockReason,
					reportingForm: createReportingForm({
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const reportButton = documentQueries.getByRole('button', { name: 'Report Yes' })
		const settleSelectedButton = documentQueries.getByRole('button', { name: 'Settle selected Yes deposits' })
		const settleAllButton = documentQueries.getByRole('button', { name: 'Settle all Yes deposits' })
		const sharedReasonId = reportButton.getAttribute('aria-describedby')
		const sharedReason = document.getElementById(sharedReasonId ?? '')
		const sharedActionRegion = reportButton.closest('.reporting-shared-action-region')

		expect(document.body.textContent?.split(sharedLockReason)).toHaveLength(2)
		expect(sharedReasonId).not.toBeNull()
		expect(sharedReason).not.toBeNull()
		expect(sharedActionRegion?.contains(sharedReason)).toBe(true)
		expect(settleSelectedButton.getAttribute('aria-describedby')).toBe(sharedReasonId)
		expect(settleAllButton.getAttribute('aria-describedby')).toBe(sharedReasonId)
		expect(sharedReason?.textContent).toContain(sharedLockReason)
	})

	test('shows when the unresolved escalation migration window has closed', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					forkAlreadyTriggered: true,
					reportingDetails: createReportingDetails({
						settlementState: 'migration-expired',
						systemState: 'poolForked',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('The optional unresolved parent escalation-deposit accounting cleanup window has closed. Child proof eligibility is unchanged.')).toBe(true)
		expect(document.body.textContent?.includes('must migrate in Fork & Migration')).toBe(false)
		expect(document.body.textContent?.includes('Connected wallet has no unsettled escalation deposits.')).toBe(false)
	})

	test('shows a Trigger universe fork action when non-decision blocks escalation deposits', async () => {
		let triggerZoltarForkCalls = 0
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					mode: 'withdraw-only',
					onTriggerZoltarFork: () => {
						triggerZoltarForkCalls += 1
					},
					reportingDetails: createReportingDetails({
						hasReachedNonDecision: true,
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Trigger universe fork' }))
		})

		expect(triggerZoltarForkCalls).toBe(1)
	})

	test('keeps only Open fork & migration visible after a fork-triggered pool has already entered its fork workflow', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					forkAlreadyTriggered: true,
					mode: 'withdraw-only',
					onOpenForkWorkflow: () => undefined,
					onTriggerZoltarFork: () => undefined,
					reportingDetails: createReportingDetails({
						hasReachedNonDecision: true,
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: 'Trigger universe fork' })).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Open fork & migration' })).not.toBeNull()
		expect(document.body.textContent?.includes('Dispute-staked REP remains in escalation after non-decision. The universe fork has already been triggered for this pool, so continue in Fork & Migration.')).toBe(true)
	})

	test('shows a Trigger universe fork action when non-decision blocks reporting', async () => {
		let triggerZoltarForkCalls = 0
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					onTriggerZoltarFork: () => {
						triggerZoltarForkCalls += 1
					},
					reportingDetails: createReportingDetails({
						hasReachedNonDecision: true,
					}),
					triggerZoltarForkAvailability: {
						disabled: false,
						reason: undefined,
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expectTransactionButtonEnabled(document.body, 'Trigger universe fork')

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Trigger universe fork' }))
		})

		expect(triggerZoltarForkCalls).toBe(1)
	})

	test('triggers the universe fork directly from reporting', async () => {
		let triggerZoltarForkCalls = 0
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					onTriggerZoltarFork: () => {
						triggerZoltarForkCalls += 1
					},
					reportingDetails: createReportingDetails({
						hasReachedNonDecision: true,
					}),
					triggerZoltarForkAvailability: {
						disabled: false,
						reason: undefined,
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Trigger universe fork' }))
		})

		expect(triggerZoltarForkCalls).toBe(1)
	})

	test('disables preset buttons when reporting details are missing without showing the load reason inline', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: undefined,
					reportingForm: createReportingForm({
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('button', { name: 'Min to take the lead' }) as HTMLButtonElement).disabled).toBe(true)
		expect((documentQueries.getByRole('button', { name: 'Max profit' }) as HTMLButtonElement).disabled).toBe(true)
		expect(document.body.textContent?.includes('Load reporting details before using presets.')).toBe(false)
	})

	test('shows one associated blocker when contribution capacity disables both presets', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createReportingDetails({
						nonDecisionThresholdAttoRep: rep(20n),
						sides: [
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(20n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
							{ balance: rep(20n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						startBondAttoRep: rep(1n),
					}),
					reportingForm: createReportingForm({
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const blocker = documentQueries.getByText('No remaining contribution capacity is available on the selected side.')
		const minimumButton = documentQueries.getByRole('button', { name: 'Min to take the lead' }) as HTMLButtonElement
		const maxProfitButton = documentQueries.getByRole('button', { name: 'Max profit' }) as HTMLButtonElement
		expect(minimumButton.disabled).toBe(true)
		expect(maxProfitButton.disabled).toBe(true)
		expect(blocker.id).not.toBe('')
		expect(minimumButton.getAttribute('aria-describedby')).toBe(blocker.id)
		expect(maxProfitButton.getAttribute('aria-describedby')).toBe(blocker.id)
	})

	test('removes side-level deposit and projection detail lines from the shared outcome chart', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingForm: createReportingForm({
						selectedOutcome: 'no',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const reportOutcomeSection = getReportOutcomeSection()
		expect(within(document.body).queryByRole('heading', { name: 'Outcome Sides' })).toBeNull()
		expect(reportOutcomeSection.textContent?.includes('Projected payout for current amount')).toBe(false)
		expect(reportOutcomeSection.textContent?.includes('Projected profit if this side wins')).toBe(false)
		expect(reportOutcomeSection.textContent?.includes('Your deposits:')).toBe(false)
	})

	test('renders withdraw-only messages and enables selectable deposits once withdrawal is allowed', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					mode: 'withdraw-only',
					reportingDetails: createReportingDetails({
						questionOutcome: 'yes',
						settlementState: 'resolved',
						parentWithdrawalEnabled: true,
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		expectTransactionButtonDisabled(document.body, 'Settle selected Yes deposits', 'Select at least one deposit to settle or use Settle all for this side.')
		expectTransactionButtonEnabled(document.body, 'Settle all Yes deposits')
		expect(within(document.body).getByRole('checkbox', { name: /Deposit #0/i })).toBeDefined()
		expect(document.body.textContent?.includes('Current claim type: Winning payout')).toBe(true)
		expect(document.body.textContent?.includes('Initially deposited:')).toBe(true)
		expect(document.body.textContent?.includes('Worth now:')).toBe(true)
	})

	test('renders withdraw-only empty state when the connected wallet has no deposits on any side', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					mode: 'withdraw-only',
					reportingDetails: createReportingDetails({
						questionOutcome: 'yes',
						sides: [
							{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(5n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
							{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						settlementState: 'resolved',
						parentWithdrawalEnabled: true,
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('Connected wallet has no unsettled escalation deposits.')).toBe(true)
		expect(within(document.body).queryByRole('button', { name: /Settle Selected/i })).toBeNull()
		expect(within(document.body).queryByRole('button', { name: /Settle All/i })).toBeNull()
	})

	test('updates selected withdrawal indexes from deposit checkboxes in withdraw-only mode', async () => {
		const onReportingFormChangeCalls: Partial<ReportingFormState>[] = []
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					mode: 'withdraw-only',
					onReportingFormChange: update => {
						onReportingFormChangeCalls.push(update)
					},
					reportingDetails: createReportingDetails({
						questionOutcome: 'yes',
						sides: [
							{
								balance: rep(5n),
								deposits: [],
								importedUserDeposits: [],
								key: 'yes',
								label: 'Yes',
								userDeposits: [createDeposit(), createDeposit({ amountAttoRep: rep(2n), cumulativeAmountAttoRep: rep(3n), depositIndex: 1n })],
							},
							{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
							{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						settlementState: 'resolved',
						parentWithdrawalEnabled: true,
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const depositCheckbox = within(document.body).getByRole('checkbox', { name: /Deposit #1/i })
		fireEvent.click(depositCheckbox)
		fireEvent.click(depositCheckbox)

		expect(onReportingFormChangeCalls).toEqual([{ selectedWithdrawDepositIndexesByOutcome: createSelectedWithdrawDepositIndexesByOutcome({ yes: [1n] }) }, { selectedWithdrawDepositIndexesByOutcome: createSelectedWithdrawDepositIndexesByOutcome() }])
	})

	test('renders grouped withdraw sections for every side with deposits and keeps duplicate indexes distinct', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					mode: 'withdraw-only',
					reportingForm: createReportingForm({
						selectedWithdrawDepositIndexesByOutcome: createSelectedWithdrawDepositIndexesByOutcome({
							yes: [0n],
						}),
					}),
					reportingDetails: createReportingDetails({
						questionOutcome: 'yes',
						sides: [
							{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [createDeposit()] },
							{ balance: rep(5n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [createDeposit()] },
							{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						settlementState: 'resolved',
						parentWithdrawalEnabled: true,
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Invalid' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Yes' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'No' })).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Settle selected Invalid deposits', 'Select at least one deposit to settle or use Settle all for this side.')
		expectTransactionButtonEnabled(document.body, 'Settle all Invalid deposits')
		expectTransactionButtonEnabled(document.body, 'Settle selected Yes deposits')
		expectTransactionButtonEnabled(document.body, 'Settle all Yes deposits')

		const depositLabels = document.body.querySelectorAll('.withdraw-deposit-option')
		expect(depositLabels).toHaveLength(2)
		const checkedCheckboxes = document.body.querySelectorAll("input[type='checkbox']:checked")
		expect(checkedCheckboxes).toHaveLength(1)
	})

	test('autofills the minimum-outcome-change preset with 1001 REP when another side has 1000 REP', async () => {
		const renderedComponent = await renderIntoDocument(
			h(ReportingSectionHarness, {
				initialProps: {
					reportingDetails: createReportingDetails({
						currentRequiredBond: rep(1_000n),
						nonDecisionThresholdAttoRep: rep(2_000n),
						sides: [
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(1_000n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						startBondAttoRep: rep(1n),
					}),
					reportingForm: createReportingForm({
						selectedOutcome: 'no',
					}),
				},
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Min to take the lead' }))
		})

		const amountInput = within(document.body).getByRole('textbox', { name: /^Contribution Amount \(REP\)/ })
		expect((amountInput as HTMLInputElement).value).toBe('1001')
	})

	test('autofills the max-profit preset with 1500 REP when another side has 1000 REP', async () => {
		const renderedComponent = await renderIntoDocument(
			h(ReportingSectionHarness, {
				initialProps: {
					reportingDetails: createReportingDetails({
						currentRequiredBond: rep(1_000n),
						nonDecisionThresholdAttoRep: rep(2_000n),
						sides: [
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(1_000n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
							{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						startBondAttoRep: rep(1n),
					}),
					reportingForm: createReportingForm({
						selectedOutcome: 'no',
					}),
				},
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Max profit' }))
		})

		const amountInput = within(document.body).getByRole('textbox', { name: /^Contribution Amount \(REP\)/ })
		expect((amountInput as HTMLInputElement).value).toBe('1500')
		expect(document.body.textContent?.includes('Estimated profit if No wins')).toBe(false)
	})

	test('disables the minimum-outcome-change preset when the selected side already leads', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createReportingDetails({
						sides: [
							{ balance: rep(2n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(9n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [createDeposit()] },
							{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
					}),
					reportingForm: createReportingForm({
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const minButton = within(document.body).getByRole('button', { name: 'Min to take the lead' }) as HTMLButtonElement
		expect(minButton.disabled).toBe(true)
		expect(minButton.title).toBe('Selected side already leads.')
		expect(document.body.textContent?.includes('Selected side already leads.')).toBe(false)
	})

	test('disables max profit when the reward window is already filled without rendering the inline reason', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createReportingDetails({
						sides: [
							{ balance: rep(15n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
							{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
							{ balance: rep(2n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
						],
					}),
					reportingForm: createReportingForm({
						selectedOutcome: 'yes',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const maxProfitButton = within(document.body).getByRole('button', { name: 'Max profit' }) as HTMLButtonElement
		expect(maxProfitButton.disabled).toBe(true)
		expect(maxProfitButton.title).toBe('Max profit preset unavailable because the reward window is already filled on the selected side.')
		expect(document.body.textContent?.includes('Max profit preset unavailable because the reward window is already filled on the selected side.')).toBe(false)
	})

	test('lets users select an outcome side from the outcome cards and updates the report button label', async () => {
		const updates: Partial<ReportingFormState>[] = []
		const renderedComponent = await renderIntoDocument(
			<ReportingSectionHarness
				initialProps={{
					onReportingFormChange: update => {
						updates.push(update)
					},
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const outcomeGroup = documentQueries.getByRole('radiogroup', { name: 'Report outcome' })
		const outcomeQueries = within(outcomeGroup)
		const invalidButton = outcomeQueries.getByRole('radio', { name: /^Invalid/ }) as HTMLButtonElement
		const yesButton = outcomeQueries.getByRole('radio', { name: /^Yes/ }) as HTMLButtonElement
		const noButton = outcomeQueries.getByRole('radio', { name: /^No/ }) as HTMLButtonElement

		expect(yesButton.getAttribute('aria-checked')).toBe('false')
		expect(noButton.getAttribute('aria-checked')).toBe('false')
		expect(invalidButton.tabIndex).toBe(0)
		expect(yesButton.tabIndex).toBe(-1)
		expect(noButton.tabIndex).toBe(-1)
		expect(documentQueries.getByRole('button', { name: 'Report on selected side' })).not.toBeNull()

		await act(() => {
			fireEvent.click(noButton)
		})

		expect(updates).toEqual([{ selectedOutcome: 'no' }])
		expect((outcomeQueries.getByRole('radio', { name: /^Yes/ }) as HTMLButtonElement).getAttribute('aria-checked')).toBe('false')
		expect((outcomeQueries.getByRole('radio', { name: /^No/ }) as HTMLButtonElement).getAttribute('aria-checked')).toBe('true')
		expect((outcomeQueries.getByRole('radio', { name: /^No/ }) as HTMLButtonElement).tabIndex).toBe(0)
		expect(documentQueries.getByRole('button', { name: 'Report No' })).not.toBeNull()

		await act(() => {
			fireEvent.keyDown(outcomeQueries.getByRole('radio', { name: /^No/ }), { key: 'ArrowLeft' })
		})
		const selectedYesButton = outcomeQueries.getByRole('radio', { name: /^Yes/ }) as HTMLButtonElement
		expect(updates.at(-1)).toEqual({ selectedOutcome: 'yes' })
		expect(selectedYesButton.getAttribute('aria-checked')).toBe('true')
		expect(selectedYesButton.tabIndex).toBe(0)
		expect(document.activeElement === selectedYesButton).toBe(true)

		await act(() => {
			fireEvent.keyDown(selectedYesButton, { key: 'ArrowRight' })
		})
		const selectedNoButton = outcomeQueries.getByRole('radio', { name: /^No/ }) as HTMLButtonElement
		expect(updates.at(-1)).toEqual({ selectedOutcome: 'no' })
		expect(selectedNoButton.getAttribute('aria-checked')).toBe('true')
		expect(document.activeElement === selectedNoButton).toBe(true)
	})

	test('disables outcome side selection when the reporting workflow is locked', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					lockedReason: 'Reporting opens after market end.',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('radio', { name: /^Yes/ }) as HTMLButtonElement).disabled).toBe(true)
		expect((documentQueries.getByRole('radio', { name: /^No/ }) as HTMLButtonElement).disabled).toBe(true)
		expect((documentQueries.getByRole('radio', { name: /^Invalid/ }) as HTMLButtonElement).disabled).toBe(true)
	})

	test('renders reporting transaction status outside the action rows', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingResult: {
						action: 'reportOutcome',
						hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
						outcome: 'yes',
						securityPoolAddress: zeroAddress,
						universeId: 1n,
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(document.body.querySelector('.workflow-transaction-status')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Latest Reporting Action' })).toBeNull()
		expect(documentQueries.queryByText('Reporting Contribution Submitted')).toBeNull()
	})

	test('uses only the latest action card after withdrawing escalation deposits', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingResult: {
						action: 'withdrawEscalation',
						hash: '0x5678000000000000000000000000000000000000000000000000000000000000',
						outcome: 'yes',
						securityPoolAddress: zeroAddress,
						universeId: 1n,
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Latest Reporting Action' })).toBeNull()
		expect(documentQueries.queryByText('Escalation Deposits Withdrawn')).toBeNull()
		expect(documentQueries.queryByText('Eligible escalation deposits were withdrawn for the selected outcome side.')).toBeNull()
	})
})
