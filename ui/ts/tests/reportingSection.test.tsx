/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { fireEvent, within } from '@testing-library/dom'
import { h } from 'preact'
import { useState } from 'preact/hooks'
import { zeroAddress } from 'viem'
import { ReportingSection } from '../components/ReportingSection.js'
import { formatDuration } from '../lib/formatters.js'
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
		questionOutcome: 'none',
		resolution: 'none',
		securityPoolAddress: zeroAddress,
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

	test('renders the reporting workflow without banners or duplicate loaded-market metadata', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Reporting Context' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Pending Start' })).toBeNull()
		expect(documentQueries.queryByText('The current escalation lifecycle phase is')).toBeNull()
		expect(documentQueries.queryByText('Reporting contribution submitted')).toBeNull()
		expect(document.body.textContent?.includes('Selected side currently has')).toBe(true)
		expect(document.body.textContent?.includes('Withdraw Escalation Deposits')).toBe(false)
		expect(documentQueries.getByRole('button', { name: 'Min to change proposed outcome' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Max profit' })).not.toBeNull()
	})

	test('does not render the pre-reporting warning banner before market end', async () => {
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
		expect(documentQueries.queryByRole('heading', { name: 'Pre-Reporting' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Reporting Context' })).not.toBeNull()
	})

	test('renders button-local reporting feedback instead of the latest action card', async () => {
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

	test('renders escalation metrics inside outcome sides instead of a standalone card', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Escalation Metrics' })).toBeNull()
		const outcomeSidesSection = getClosestSection(documentQueries.getByRole('heading', { name: 'Outcome Sides' }))
		const outcomeSidesQueries = within(outcomeSidesSection)
		expect(outcomeSidesQueries.getByText('Current Bond')).not.toBeNull()
		expect(outcomeSidesQueries.getByText('Binding Capital')).not.toBeNull()
		expect(outcomeSidesQueries.getByText('Threshold')).not.toBeNull()
		expect(outcomeSidesQueries.getByText('Time Left')).not.toBeNull()
		expect(outcomeSidesQueries.getByText('Game Start')).not.toBeNull()
		expect(outcomeSidesQueries.getByText('Start Bond')).not.toBeNull()
	})

	test('shows a warning dialog instead of locked reporting metrics before the market end time', async () => {
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
		expect(documentQueries.getByText('Reporting is not enabled. Opens in less than a minute.')).not.toBeNull()
		expect(documentQueries.queryByText('Locked')).toBeNull()
		expect(documentQueries.queryByText('Opens In')).toBeNull()
	})

	test('shows a single reporting-open status line when escalation details are not loaded yet', async () => {
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
		expect(document.body.textContent?.includes('Reporting is open. Market ended at')).toBe(true)
		expect(documentQueries.queryByText(/current escalation lifecycle phase/i)).toBeNull()
	})

	test('keeps outcome sides visible with zeroed cards before reporting details load', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: undefined,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const outcomeSidesSection = getClosestSection(documentQueries.getByRole('heading', { name: 'Outcome Sides' }))
		expect(within(outcomeSidesSection).queryByText('Load reporting details to populate live stakes, bond progression, and deposit indexes.')).toBeNull()

		const sideCards = Array.from(outcomeSidesSection.querySelectorAll('.escalation-side'))
		expect(sideCards).toHaveLength(3)
		const sideLabels = sideCards.map(card => {
			const label = card.querySelector('.panel-label')?.textContent
			if (label === undefined) throw new Error('Expected side label')
			return label
		})
		expect(sideLabels).toEqual(['Invalid', 'Yes', 'No'])
		expect(outcomeSidesSection.textContent?.includes('Your deposits: None')).toBe(true)
		expect(outcomeSidesSection.querySelector('[title="0 REP"]')).not.toBeNull()
	})

	test('disables reporting buttons when deterministic prerequisites are missing', async () => {
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
		expect(document.body.querySelector('.disabled-reason')).toBeNull()
	})

	test('enables reporting action when the selected side can accept reports', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingForm: createReportingForm({
						reportAmount: '4',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Report / Contribute On Selected Side')
		expect(document.body.textContent?.includes('Withdraw Escalation Deposits')).toBe(false)
	})

	test('shows vault-collateral copy and blocks reporting when unlocked vault REP is insufficient', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createReportingDetails({
						viewerVaultAvailableEscalationRep: 2n * REP,
					}),
					reportingForm: {
						...createReportingForm(),
						reportAmount: '5',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('It does not spend wallet REP directly or require a wallet approval.')).toBe(true)
		expect(document.body.textContent?.includes('Available unlocked vault REP for reporting:')).toBe(true)
		expectTransactionButtonDisabled(document.body, 'Report / Contribute On Selected Side', 'Need 3 more unlocked REP in your vault before reporting.')
	})

	test('renders a withdraw-only mode without reporting context or report form', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps({ mode: 'withdraw-only' })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Reporting Context' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Report Outcome' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Withdraw Escalation Deposits' })).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Withdraw Escalation Deposits', 'Escalation deposits cannot be withdrawn until the question is finalized or the game is canceled by an external fork.')
	})

	test('shows the moved time and bond metrics inside outcome sides', async () => {
		const reportingDetails = createReportingDetails()
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: {
						...reportingDetails,
						currentTime: 150n,
						escalationEndTime: 300n,
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const outcomeSidesSection = getClosestSection(within(document.body).getByRole('heading', { name: 'Outcome Sides' }))
		expect(outcomeSidesSection.textContent?.includes(formatDuration(300n - 150n))).toBe(true)
		expect(outcomeSidesSection.textContent?.includes('The market resolves as')).toBe(false)
		expect(outcomeSidesSection.textContent?.includes('Game starts at')).toBe(false)
	})

	test('shows awaiting resolution with zero time left once the escalation end time has passed', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps({ reportingDetails: createReportingDetails({ currentTime: 300n, escalationEndTime: 300n }) })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getAllByText('Awaiting Resolution').length).toBeGreaterThan(0)
		expect(document.body.textContent?.includes(formatDuration(0n))).toBe(true)
	})

	test('shows zeroed outcome sides before the first report starts the escalation game', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createNotStartedReportingDetails(),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Escalation Metrics')).toBeNull()
		const outcomeSidesSection = getClosestSection(documentQueries.getByRole('heading', { name: 'Outcome Sides' }))
		expect(documentQueries.queryByRole('heading', { name: 'Escalation Status' })).toBeNull()
		expect(within(outcomeSidesSection).queryByText('Escalation game has not started yet. The first report will populate live stakes, bond progression, and deposit indexes.')).toBeNull()
		expect(outcomeSidesSection.querySelectorAll('.escalation-side')).toHaveLength(3)
		expect(outcomeSidesSection.textContent?.includes('Your deposits: None')).toBe(true)
		expect(outcomeSidesSection.querySelector('[title="0 REP"]')).not.toBeNull()
		expectTransactionButtonEnabled(document.body, 'Report / Contribute On Selected Side')
	})

	test('accepts decimal report amounts for profit preview', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps({ reportingForm: createReportingForm({ reportAmount: '1.5' }) })))
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('projects roughly')).toBe(true)
		expect(document.body.textContent?.includes('Enter a valid report amount to preview profit.')).toBe(false)
	})

	test('autofills the report amount for the minimum outcome change preset', async () => {
		const renderedComponent = await renderIntoDocument(<ReportingSectionHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Min to change proposed outcome' }))
		})

		const amountInput = within(document.body).getByRole('textbox', { name: 'Report / Contribution Amount (REP)' })
		expect((amountInput as HTMLInputElement).value).toBe('4')
	})

	test('autofills the report amount for the max profit preset and updates the preview', async () => {
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

	test('disables preset buttons when reporting details are missing', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps({ reportingDetails: undefined })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('button', { name: 'Min to change proposed outcome' }) as HTMLButtonElement).disabled).toBe(true)
		expect((documentQueries.getByRole('button', { name: 'Max profit' }) as HTMLButtonElement).disabled).toBe(true)
		expect(document.body.textContent?.includes('Load reporting details before using presets.')).toBe(false)
	})

	test('shows unavailable preset reasons for impossible states', async () => {
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

	test('renders the shared outcome chart with per-side projections and deposit details', async () => {
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

		const documentQueries = within(document.body)
		const outcomeSection = getClosestSection(documentQueries.getByRole('heading', { name: 'Outcome Sides' }))
		const outcomeSectionQueries = within(outcomeSection)

		expect(outcomeSectionQueries.getByText('Bars show total REP on each outcome. The marker shows current binding capital, and the thin inset shows your wallet stake.')).not.toBeNull()
		expect(outcomeSectionQueries.getAllByText('Total stake').length).toBeGreaterThan(0)
		expect(outcomeSectionQueries.getAllByText('Your stake').length).toBeGreaterThan(0)
		expect(outcomeSectionQueries.getByText('Binding capital')).not.toBeNull()
		expect(outcomeSectionQueries.getByText('Leading')).not.toBeNull()
		expect(outcomeSectionQueries.getByText('Selected')).not.toBeNull()
		expect(outcomeSection.textContent?.includes('Projected payout for current amount')).toBe(true)
		expect(outcomeSection.textContent?.includes('Projected profit if this side wins')).toBe(true)
		expect(outcomeSection.textContent?.includes('Your deposits:')).toBe(true)
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

	test('autofills the report amount for the minimum outcome change preset with 1001 REP when another side has 1000 REP', async () => {
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

	test('autofills the report amount for the max profit preset with 1500 REP when another side has 1000 REP', async () => {
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

	test('updates the displayed profit preview after clicking max profit in a partial-depth scenario', async () => {
		const renderedComponent = await renderIntoDocument(<ReportingSectionHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const previewBefore = findProfitPreview()

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Max profit' }))
		})

		const previewAfter = findProfitPreview()
		expect(previewBefore).not.toBe(previewAfter)
	})

	test('deduplicates identical preset unavailability reasons', async () => {
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

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('button', { name: 'Min to change proposed outcome' }) as HTMLButtonElement).disabled).toBe(true)
		expect((documentQueries.getByRole('button', { name: 'Max profit' }) as HTMLButtonElement).disabled).toBe(true)
		expect(documentQueries.getAllByText('Min preset unavailable because the selected side cannot take the lead within the remaining bond capacity.')).toHaveLength(1)
	})
})
