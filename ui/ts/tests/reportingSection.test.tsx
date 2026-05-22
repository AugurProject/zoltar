/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { h } from 'preact'
import { zeroAddress } from 'viem'
import { ReportingSection } from '../components/ReportingSection.js'
import { formatDuration } from '../lib/formatters.js'
import type { AccountState, ReportingFormState } from '../types/app.js'
import type { ActiveReportingDetails, MarketDetails, ReportingActionResult, ReportingDetails } from '../types/contracts.js'
import type { ReportingSectionProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from './testUtils/transactionActionButton.js'

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

function createReportingDetails(overrides: Partial<ActiveReportingDetails> = {}): ActiveReportingDetails {
	return {
		bindingCapital: 10n,
		completeSetCollateralAmount: 1n,
		currentRequiredBond: 2n,
		currentTime: 150n,
		escalationEndTime: 300n,
		escalationGameAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		nonDecisionThreshold: 20n,
		resolution: 'none',
		securityPoolAddress: zeroAddress,
		sides: [
			{ balance: 5n, deposits: [], key: 'yes', label: 'Yes', userDeposits: [{ amount: 1n, cumulativeAmount: 1n, depositIndex: 0n, depositor: zeroAddress }] },
			{ balance: 2n, deposits: [], key: 'no', label: 'No', userDeposits: [] },
			{ balance: 1n, deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
		],
		startBond: 1n,
		status: 'active',
		startingTime: 120n,
		totalCost: 0n,
		universeId: 1n,
		...overrides,
	}
}

function createReportingResult(overrides: Partial<ReportingActionResult> = {}): ReportingActionResult {
	return {
		action: 'reportOutcome',
		hash: '0x01',
		outcome: 'yes',
		securityPoolAddress: zeroAddress,
		universeId: 1n,
		...overrides,
	}
}

function createNotStartedReportingDetails(): ReportingDetails {
	return {
		completeSetCollateralAmount: 1n,
		currentTime: 150n,
		marketDetails: createMarketDetails(),
		resolution: 'none',
		securityPoolAddress: zeroAddress,
		status: 'not-started',
		universeId: 1n,
	}
}

function createReportingForm(): ReportingFormState {
	return {
		reportAmount: '1',
		securityPoolAddress: zeroAddress,
		selectedOutcome: 'yes',
		withdrawDepositIndexes: '',
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
		reportingForm: createReportingForm(),
		reportingResult: undefined,
		showHeader: false,
		showSecurityPoolAddressInput: false,
		...overrides,
	}
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

		const reportingContextCard = documentQueries.getByRole('heading', { name: 'Reporting Context' }).closest('.entity-card')
		if (reportingContextCard === null) throw new Error('Expected reporting context entity card')
		const reportingContextQueries = within(reportingContextCard as HTMLElement)
		expect(reportingContextQueries.getByText('Escalation Game')).not.toBeNull()
		expect(reportingContextQueries.queryByText('Security Pool')).toBeNull()
		expect(reportingContextQueries.queryByText('Universe')).toBeNull()
		expect(reportingContextQueries.queryByText('Resolution')).toBeNull()

		expect(document.body.textContent?.includes('Selected side currently has')).toBe(true)
		expect(document.body.textContent?.includes('Selected side has')).toBe(false)
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
		expect(document.body.querySelector('.warning-surface.lifecycle-stage-banner')).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Reporting Context' })).not.toBeNull()
	})

	test('does not render the reporting success banner after a contribution result', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingDetails: createReportingDetails({ currentTime: 110n, startingTime: 120n }),
					reportingResult: createReportingResult(),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Reporting contribution submitted')).toBeNull()
		expect(documentQueries.queryByText('Contributed on the Yes side.')).toBeNull()
		expect(documentQueries.queryByText('Next: Review the leading side and updated bond before contributing again.')).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Latest Reporting Action' })).not.toBeNull()
	})

	test('disables reporting buttons when deterministic prerequisites are missing', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					accountState: createAccountState({ address: undefined }),
					reportingForm: {
						...createReportingForm(),
						reportAmount: '',
						selectedOutcome: 'no',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Report / Contribute On Selected Side', 'Connect a wallet before reporting on a market.')
		expect(document.body.querySelector('button[title=\"Connect a wallet before withdrawing escalation deposits.\"]')).toBeNull()
		expect(document.body.querySelector('.disabled-reason')).toBeNull()
	})

	test('enables reporting action when the selected side can accept reports', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Report / Contribute On Selected Side')
		expect(document.body.textContent?.includes('Withdraw Escalation Deposits')).toBe(false)
	})

	test('renders a withdraw-only mode without reporting context or report form', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps({ mode: 'withdraw-only' })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Reporting Context' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Report Outcome' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Withdraw Escalation Deposits' })).not.toBeNull()
		expectTransactionButtonEnabled(document.body, 'Withdraw Escalation Deposits')
	})

	test('renders time left from escalation end time and current chain time', async () => {
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

		expect(document.body.textContent?.includes(formatDuration(300n - 150n))).toBe(true)
	})

	test('shows awaiting resolution with zero time left once the escalation end time has passed', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
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
		expect(documentQueries.getAllByText('Awaiting Resolution').length).toBeGreaterThan(0)
		expect(document.body.textContent?.includes(formatDuration(0n))).toBe(true)
	})

	test('shows first-report guidance before the escalation game starts', async () => {
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
		expect(documentQueries.queryByText('Outcome Sides')).toBeNull()
		expect(document.body.textContent?.includes('Reporting is open, but the escalation game has not started yet.')).toBe(true)
		expect(document.body.textContent?.includes('The first report or contribution will deploy and initialize the escalation game for this pool.')).toBe(true)

		expectTransactionButtonEnabled(document.body, 'Report / Contribute On Selected Side')
		expect(document.body.textContent?.includes('Withdraw Escalation Deposits')).toBe(false)
	})

	test('accepts decimal report amounts for profit preview', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ReportingSection,
				createProps({
					reportingForm: {
						...createReportingForm(),
						reportAmount: '1.5',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('projects roughly')).toBe(true)
		expect(document.body.textContent?.includes('Enter a valid report amount to preview profit.')).toBe(false)
	})
})
