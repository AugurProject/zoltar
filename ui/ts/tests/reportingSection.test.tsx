/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { h } from 'preact'
import { zeroAddress } from 'viem'
import { ReportingSection } from '../components/ReportingSection.js'
import type { AccountState, ReportingFormState } from '../types/app.js'
import type { MarketDetails, ReportingActionResult, ReportingDetails } from '../types/contracts.js'
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

function createReportingDetails(overrides: Partial<ReportingDetails> = {}): ReportingDetails {
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
		expect(documentQueries.getAllByText('Active').length).toBeGreaterThan(0)
		expect(documentQueries.queryByRole('heading', { name: 'Pending Start' })).toBeNull()
		expect(documentQueries.queryByText('The current escalation lifecycle phase is')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Loaded Escalation Game' })).not.toBeNull()

		const loadedEscalationCard = documentQueries.getByRole('heading', { name: 'Loaded Escalation Game' }).closest('.entity-card')
		if (loadedEscalationCard === null) throw new Error('Expected loaded escalation entity card')
		const loadedEscalationQueries = within(loadedEscalationCard as HTMLElement)
		expect(loadedEscalationQueries.getByText('Escalation Game')).not.toBeNull()
		expect(loadedEscalationQueries.queryByText('Security Pool')).toBeNull()
		expect(loadedEscalationQueries.queryByText('Universe')).toBeNull()
		expect(loadedEscalationQueries.queryByText('Resolution')).toBeNull()
		expect(loadedEscalationQueries.queryByText('Market End')).toBeNull()

		expect(document.body.textContent?.includes('Selected side currently has')).toBe(true)
		expect(document.body.textContent?.includes('Selected side has')).toBe(true)
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
		expectTransactionButtonDisabled(document.body, 'Withdraw Escalation Deposits', 'Connect a wallet before withdrawing escalation deposits.')
		expect(document.body.querySelector('.disabled-reason')).toBeNull()
	})

	test('enables reporting actions when the selected side can accept reports and has deposits to withdraw', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Report / Contribute On Selected Side')
		expectTransactionButtonEnabled(document.body, 'Withdraw Escalation Deposits')
	})
})
