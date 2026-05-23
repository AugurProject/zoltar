/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { fireEvent, within } from '@testing-library/dom'
import { h } from 'preact'
import { useState } from 'preact/hooks'
import { zeroAddress } from 'viem'
import { ReportingSection } from '../components/ReportingSection.js'
import { formatDuration } from '../lib/formatters.js'
import { computeEscalationTimeSinceStartFromAttritionCost, getEscalationBalanceTuple, getEscalationBindingCapital } from '../lib/reportingDomain.js'
import type { AccountState, ReportingFormState } from '../types/app.js'
import type { ActiveReportingDetails, EscalationDeposit, MarketDetails, ReportingDetails } from '../types/contracts.js'
import type { ReportingSectionProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from './testUtils/transactionActionButton.js'

const REP = 10n ** 18n

function rep(value: bigint) {
	return value * REP
}

function getClosestSection(heading: HTMLElement | null) {
	if (heading === null) throw new Error('Expected heading to exist')
	const section = heading.closest('section')
	if (!(section instanceof HTMLElement)) throw new Error('Expected heading to be inside a section')
	return section
}

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalance: 0n,
		wethBalance: 0n,
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
		amount: rep(1n),
		cumulativeAmount: rep(1n),
		depositIndex: 0n,
		depositor: zeroAddress,
		...overrides,
	}
}

function createReportingDetails(overrides: Partial<ActiveReportingDetails> = {}): ActiveReportingDetails {
	return {
		bindingCapital: rep(10n),
		completeSetCollateralAmount: 1n,
		currentRequiredBond: rep(20n),
		currentTime: 150n,
		escalationEndTime: 300n,
		escalationGameAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		nonDecisionThreshold: rep(20n),
		questionOutcome: 'none',
		resolution: 'none',
		securityPoolAddress: zeroAddress,
		sides: [
			{ balance: rep(1n), deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			{ balance: rep(5n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [createDeposit()] },
			{ balance: rep(8n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
		],
		startBond: rep(3n),
		startingTime: 120n,
		status: 'active',
		totalCost: rep(20n),
		universeId: 1n,
		withdrawalEnabled: false,
		withdrawalState: 'not-finalized',
		viewerVaultAvailableEscalationRep: 10n * REP,
		viewerVaultExists: true,
		viewerVaultLockedRepInEscalationGame: 1n * REP,
		viewerVaultRepDepositShare: 11n * REP,
		...overrides,
	}
}

function createDynamicReportingDetails(overrides: Partial<ActiveReportingDetails> = {}): ActiveReportingDetails {
	const sides = overrides.sides ?? [
		{ balance: rep(1n), deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
		{ balance: rep(8n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [createDeposit()] },
		{ balance: rep(3n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
	]
	const startBond = overrides.startBond ?? rep(1n)
	const nonDecisionThreshold = overrides.nonDecisionThreshold ?? rep(20n)
	const startingTime = overrides.startingTime ?? 120n
	const currentTime = overrides.currentTime ?? 150n
	const bindingCapital = getEscalationBindingCapital(getEscalationBalanceTuple(sides))
	const escalationEndTime = startingTime + computeEscalationTimeSinceStartFromAttritionCost(startBond, nonDecisionThreshold, bindingCapital)

	const baseDetails: ActiveReportingDetails = {
		bindingCapital,
		completeSetCollateralAmount: 1n,
		currentRequiredBond: rep(2n),
		currentTime,
		escalationEndTime,
		escalationGameAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		nonDecisionThreshold,
		questionOutcome: 'none',
		resolution: 'none',
		securityPoolAddress: zeroAddress,
		sides,
		startBond,
		startingTime,
		status: 'active',
		totalCost: 0n,
		universeId: 1n,
		withdrawalEnabled: false,
		withdrawalState: 'not-finalized',
		viewerVaultAvailableEscalationRep: 10n * REP,
		viewerVaultExists: true,
		viewerVaultLockedRepInEscalationGame: 1n * REP,
		viewerVaultRepDepositShare: 11n * REP,
	}

	return {
		...baseDetails,
		...overrides,
		bindingCapital,
		currentTime,
		escalationEndTime,
		nonDecisionThreshold,
		sides,
		startBond,
		startingTime,
	}
}

function createReportingFeedback(overrides: Partial<NonNullable<ReportingSectionProps['reportingFeedback']>> = {}): NonNullable<ReportingSectionProps['reportingFeedback']> {
	return {
		action: 'reportOutcome',
		status: {
			detail: 'Report recorded on-chain.',
			hash: '0x01',
			title: 'Reporting submitted',
			tone: 'success',
		},
		...overrides,
	}
}

function createNotStartedReportingDetails(overrides: Partial<Extract<ReportingDetails, { status: 'not-started' }>> = {}): ReportingDetails {
	return {
		completeSetCollateralAmount: 1n * REP,
		currentTime: 150n,
		marketDetails: createMarketDetails(),
		nonDecisionThreshold: rep(50n),
		questionOutcome: 'none',
		resolution: 'none',
		securityPoolAddress: zeroAddress,
		startBond: rep(3n),
		status: 'not-started',
		universeId: 1n,
		withdrawalEnabled: false,
		withdrawalState: 'not-finalized',
		viewerVaultAvailableEscalationRep: 10n * REP,
		viewerVaultExists: true,
		viewerVaultLockedRepInEscalationGame: 0n,
		viewerVaultRepDepositShare: 10n * REP,
		...overrides,
	}
}

function createReportingForm(overrides: Partial<ReportingFormState> = {}): ReportingFormState {
	return {
		reportAmount: '1',
		securityPoolAddress: zeroAddress,
		selectedOutcome: 'yes',
		selectedWithdrawDepositIndexes: [],
		...overrides,
	}
}

function createProps(overrides: Partial<ReportingSectionProps> = {}): ReportingSectionProps {
	return {
		accountState: createAccountState(),
		currentTimestamp: 150n,
		embedInCard: false,
		loadingReportingDetails: false,
		onLoadReporting: () => undefined,
		onReportOutcome: () => undefined,
		onReportingFormChange: () => undefined,
		onWithdrawEscalation: () => undefined,
		previewMarketDetails: createMarketDetails(),
		reportingActiveAction: undefined,
		reportingDetails: createReportingDetails(),
		reportingError: undefined,
		reportingFeedback: undefined,
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
				setReportingForm(currentForm => ({
					...currentForm,
					...changes,
				}))
			}}
		/>
	)
}

function findProfitPreview() {
	return Array.from(document.body.querySelectorAll('p.detail'))
		.map(element => element.textContent ?? '')
		.find(text => text.includes('projects roughly'))
}

describe('ReportingSection', () => {
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

	test('renders active reporting with a lifecycle banner and no reporting context card', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Reporting Context' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Active' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Min to change proposed outcome' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Max profit' })).not.toBeNull()
		expect(document.body.textContent?.includes('Selected side currently has')).toBe(true)
		expect(document.body.textContent?.includes('Withdraw Escalation Deposits')).toBe(false)
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
		expect(document.body.textContent?.includes('Reporting opens after the market end timestamp for this pool.')).toBe(true)
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
		expect(document.body.textContent?.includes('Load reporting details to view the escalation state for this pool.')).toBe(true)
	})

	test('renders button-local reporting feedback instead of a latest action card', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingFeedback: createReportingFeedback(),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Reporting submitted')).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Latest Reporting Action' })).toBeNull()
	})

	test('keeps escalation metrics inside Outcome Sides', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const outcomeSidesSection = getClosestSection(within(document.body).getByRole('heading', { name: 'Outcome Sides' }))
		const outcomeSidesQueries = within(outcomeSidesSection)
		expect(outcomeSidesQueries.getByText('Current Bond')).not.toBeNull()
		expect(outcomeSidesQueries.getByText('Binding Capital')).not.toBeNull()
		expect(outcomeSidesQueries.getByText('Threshold')).not.toBeNull()
		expect(outcomeSidesQueries.getByText('Time Left')).not.toBeNull()
		expect(outcomeSidesQueries.getByText('Game Start')).not.toBeNull()
		expect(outcomeSidesQueries.getByText('Start Bond')).not.toBeNull()
	})

	test('keeps placeholder outcome cards visible before reporting details load', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps({ reportingDetails: undefined })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const outcomeSidesSection = getClosestSection(within(document.body).getByRole('heading', { name: 'Outcome Sides' }))
		expect(outcomeSidesSection.querySelectorAll('.escalation-side')).toHaveLength(3)
		expect(outcomeSidesSection.textContent?.includes('Your deposits:')).toBe(false)
		expect(outcomeSidesSection.textContent?.includes('Projected payout for current amount')).toBe(false)
		expect(outcomeSidesSection.textContent?.includes('Projected profit if this side wins')).toBe(false)
		expect(outcomeSidesSection.textContent?.includes('Total stake')).toBe(true)
		expect(outcomeSidesSection.textContent?.includes('Your stake')).toBe(true)
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

		expectTransactionButtonDisabled(document.body, 'Report / Contribute On Selected Side', 'Connect a wallet before reporting on a market.')
		expect(document.body.querySelector('button[title="Connect a wallet before withdrawing escalation deposits."]')).toBeNull()
	})

	test('removes the approval explainer copy and still blocks when unlocked vault REP is insufficient', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createReportingDetails({
						viewerVaultAvailableEscalationRep: 2n * REP,
					}),
					reportingForm: createReportingForm({
						reportAmount: '5',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('It does not spend wallet REP directly or require a wallet approval.')).toBe(false)
		expect(document.body.textContent?.includes('Available unlocked vault REP for reporting:')).toBe(true)
		expectTransactionButtonDisabled(document.body, 'Report / Contribute On Selected Side', 'Need 3 more unlocked REP in your vault before reporting.')
	})

	test('renders a compact withdraw-only mode without the reporting banner or report form', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps({ mode: 'withdraw-only' })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Reporting Context' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Report Outcome' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Active' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Withdraw Escalation Deposits' })).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Withdraw Escalation Deposits', 'Escalation deposits cannot be withdrawn until the question is finalized or the game is canceled by an external fork.')
	})

	test('shows the time-left metric inside Outcome Sides', async () => {
		const reportingDetails = createReportingDetails()
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps({ reportingDetails })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const outcomeSidesSection = getClosestSection(within(document.body).getByRole('heading', { name: 'Outcome Sides' }))
		expect(outcomeSidesSection.textContent?.includes(formatDuration(300n - 150n))).toBe(true)
	})

	test('shows Awaiting Resolution with zero time left once the escalation end time has passed', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps({ reportingDetails: createReportingDetails({ currentTime: 301n, escalationEndTime: 300n }) })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Awaiting Resolution' })).not.toBeNull()
		expect(document.body.textContent?.includes(formatDuration(0n))).toBe(true)
	})

	test('disables reporting after the escalation timer ends', async () => {
		const reportingDetails = createDynamicReportingDetails()
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createDynamicReportingDetails({
						currentTime: reportingDetails.escalationEndTime + 1n,
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Report / Contribute On Selected Side', 'Reporting is closed because the escalation timer has ended.')
	})

	test('renders pre-start metrics and placeholders before the first report starts escalation', async () => {
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

		const documentQueries = within(document.body)
		const outcomeSidesSection = getClosestSection(documentQueries.getByRole('heading', { name: 'Outcome Sides' }))
		expect(documentQueries.getByRole('heading', { name: 'First Report Starts Escalation' })).not.toBeNull()
		expect(outcomeSidesSection.textContent?.includes('Your deposits:')).toBe(false)
		expect(outcomeSidesSection.textContent?.includes('Projected payout for current amount')).toBe(false)
		expect(outcomeSidesSection.textContent?.includes('Projected profit if this side wins')).toBe(false)
		expect(outcomeSidesSection.querySelector('[title="50 REP"]')).not.toBeNull()
		expect(outcomeSidesSection.querySelector('[title="3 REP"]')).not.toBeNull()
		expect(outcomeSidesSection.querySelectorAll('.currency-value.unavailable').length).toBeGreaterThanOrEqual(2)
		expect(document.body.textContent?.includes('Load reporting details to populate live stakes')).toBe(false)
		expectTransactionButtonEnabled(document.body, 'Report / Contribute On Selected Side')
	})

	test('disables report submission for a pre-start amount below the first-report minimum', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createNotStartedReportingDetails(),
					reportingForm: createReportingForm({
						reportAmount: '2',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Report / Contribute On Selected Side', 'Enter at least 3 REP to start the escalation game.')
	})

	test('accepts decimal report amounts for the profit preview', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps({ reportingForm: createReportingForm({ reportAmount: '1.5' }) })))
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('projects roughly')).toBe(true)
		expect(document.body.textContent?.includes('Enter a valid report amount to preview profit.')).toBe(false)
	})

	test('shows the timer-extension preview below the report button for contributions that raise binding capital', async () => {
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

		const documentQueries = within(document.body)
		const reportButton = documentQueries.getByRole('button', { name: 'Report / Contribute On Selected Side' })
		const preview = documentQueries.getByText(/^This contribution would extend the timer by /)
		expect(reportButton.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
	})

	test('shows a no-extension preview when the selected contribution leaves binding capital unchanged', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps({ reportingDetails: createDynamicReportingDetails() })))
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('This contribution would not extend the timer.')).toBe(true)
	})

	test('shows the accepted-deposit note when the typed contribution exceeds the remaining room on the selected side', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createDynamicReportingDetails({
						sides: [
							{ balance: rep(1n), deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(19n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [createDeposit()] },
							{ balance: rep(3n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
					}),
					reportingForm: createReportingForm({
						reportAmount: '5',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('This contribution would not extend the timer.')).toBe(true)
		expect(document.body.textContent?.includes('Based on an accepted deposit of')).toBe(true)
		expect(document.body.textContent?.includes('≈ 1.00 REP.')).toBe(true)
	})

	test('autofills the active minimum-outcome-change preset', async () => {
		const renderedComponent = await renderIntoDocument(<ReportingSectionHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Min to change proposed outcome' }))
		})

		const amountInput = within(document.body).getByRole('textbox', { name: 'Report / Contribution Amount (REP)' })
		expect((amountInput as HTMLInputElement).value).toBe('4')
	})

	test('autofills the active max-profit preset and updates the preview', async () => {
		const renderedComponent = await renderIntoDocument(<ReportingSectionHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const previewBefore = findProfitPreview()

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Max profit' }))
		})

		const amountInput = within(document.body).getByRole('textbox', { name: 'Report / Contribution Amount (REP)' })
		const previewAfter = findProfitPreview()
		expect((amountInput as HTMLInputElement).value).toBe('7')
		expect(previewBefore).not.toBe(previewAfter)
	})

	test('autofills the pre-start minimum-outcome-change preset from the pool start bond', async () => {
		const renderedComponent = await renderIntoDocument(<ReportingSectionHarness initialProps={{ reportingDetails: createNotStartedReportingDetails() }} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Min to change proposed outcome' }))
		})

		const amountInput = within(document.body).getByRole('textbox', { name: 'Report / Contribution Amount (REP)' })
		expect((amountInput as HTMLInputElement).value).toBe('3')
	})

	test('disables Max profit before the escalation game exists', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps({ reportingDetails: createNotStartedReportingDetails() })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const maxProfitButton = within(document.body).getByRole('button', { name: 'Max profit' }) as HTMLButtonElement
		expect(maxProfitButton.disabled).toBe(true)
		expect(maxProfitButton.title).toBe('Max profit becomes available after the escalation game starts.')
		expect(document.body.textContent?.includes('Max profit becomes available after the escalation game starts.')).toBe(false)
	})

	test('disables preset buttons when reporting details are missing without showing the load reason inline', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps({ reportingDetails: undefined })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('button', { name: 'Min to change proposed outcome' }) as HTMLButtonElement).disabled).toBe(true)
		expect((documentQueries.getByRole('button', { name: 'Max profit' }) as HTMLButtonElement).disabled).toBe(true)
		expect(document.body.textContent?.includes('Load reporting details before using presets.')).toBe(false)
	})

	test('shows unavailable preset reasons for impossible active-game states', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createReportingDetails({
						nonDecisionThreshold: rep(20n),
						sides: [
							{ balance: 0n, deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(20n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
							{ balance: rep(19n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						startBond: rep(1n),
					}),
					reportingForm: createReportingForm({
						selectedOutcome: 'no',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('Min preset unavailable because the selected side cannot take the lead within the remaining bond capacity.')).toBe(true)
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

		const outcomeSection = getClosestSection(within(document.body).getByRole('heading', { name: 'Outcome Sides' }))
		expect(outcomeSection.textContent?.includes('Bars show total REP on each outcome. The marker shows current binding capital, and the thin inset shows your wallet stake.')).toBe(true)
		expect(outcomeSection.textContent?.includes('Projected payout for current amount')).toBe(false)
		expect(outcomeSection.textContent?.includes('Projected profit if this side wins')).toBe(false)
		expect(outcomeSection.textContent?.includes('Your deposits:')).toBe(false)
	})

	test('renders withdraw-only messages and enables selectable deposits once withdrawal is allowed', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					mode: 'withdraw-only',
					reportingDetails: createReportingDetails({
						questionOutcome: 'yes',
						withdrawalEnabled: true,
						withdrawalState: 'resolved',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Withdraw Escalation Deposits')
		expect(document.body.textContent?.includes('Connected wallet has 1 withdrawable unsettled deposit entry on the selected side.')).toBe(true)
		expect(within(document.body).getByRole('checkbox', { name: /Deposit #0/i })).toBeDefined()
	})

	test('renders withdraw-only empty state when the selected side has no deposits', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					mode: 'withdraw-only',
					reportingForm: createReportingForm({ selectedOutcome: 'no' }),
					reportingDetails: createReportingDetails({
						questionOutcome: 'yes',
						withdrawalEnabled: true,
						withdrawalState: 'resolved',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('Connected wallet has no unsettled deposits on the selected side.')).toBe(true)
		expectTransactionButtonDisabled(document.body, 'Withdraw Escalation Deposits', 'No deposits are available to withdraw on the selected side.')
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
								key: 'yes',
								label: 'Yes',
								userDeposits: [createDeposit(), createDeposit({ amount: rep(2n), cumulativeAmount: rep(3n), depositIndex: 1n })],
							},
							{ balance: rep(8n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
							{ balance: rep(1n), deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
						],
						withdrawalEnabled: true,
						withdrawalState: 'resolved',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const depositCheckbox = within(document.body).getByRole('checkbox', { name: /Deposit #1/i })
		fireEvent.click(depositCheckbox)
		fireEvent.click(depositCheckbox)

		expect(onReportingFormChangeCalls).toEqual([{ selectedWithdrawDepositIndexes: [1n] }, { selectedWithdrawDepositIndexes: [] }])
	})

	test('autofills the minimum-outcome-change preset with 1001 REP when another side has 1000 REP', async () => {
		const renderedComponent = await renderIntoDocument(
			h(ReportingSectionHarness, {
				initialProps: {
					reportingDetails: createReportingDetails({
						currentRequiredBond: rep(1_000n),
						nonDecisionThreshold: rep(2_000n),
						sides: [
							{ balance: 0n, deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(1_000n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
							{ balance: 0n, deposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						startBond: rep(1n),
					}),
					reportingForm: createReportingForm({
						selectedOutcome: 'no',
					}),
				},
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Min to change proposed outcome' }))
		})

		const amountInput = within(document.body).getByRole('textbox', { name: 'Report / Contribution Amount (REP)' })
		expect((amountInput as HTMLInputElement).value).toBe('1001')
	})

	test('autofills the max-profit preset with 1500 REP when another side has 1000 REP', async () => {
		const renderedComponent = await renderIntoDocument(
			h(ReportingSectionHarness, {
				initialProps: {
					reportingDetails: createReportingDetails({
						currentRequiredBond: rep(1_000n),
						nonDecisionThreshold: rep(2_000n),
						sides: [
							{ balance: 0n, deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(1_000n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
							{ balance: 0n, deposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
						startBond: rep(1n),
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

		const amountInput = within(document.body).getByRole('textbox', { name: 'Report / Contribution Amount (REP)' })
		expect((amountInput as HTMLInputElement).value).toBe('1500')
		expect(document.body.textContent?.includes('projects roughly')).toBe(true)
	})

	test('disables the minimum-outcome-change preset when the selected side already leads', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createReportingDetails({
						sides: [
							{ balance: rep(2n), deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
							{ balance: rep(9n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [createDeposit()] },
							{ balance: rep(8n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
						],
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const minButton = within(document.body).getByRole('button', { name: 'Min to change proposed outcome' }) as HTMLButtonElement
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
							{ balance: rep(15n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
							{ balance: rep(8n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
							{ balance: rep(2n), deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
						],
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
})
