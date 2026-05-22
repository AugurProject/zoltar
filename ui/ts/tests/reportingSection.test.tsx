/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { h } from 'preact'
import { zeroAddress } from 'viem'
import { ReportingSection } from '../components/ReportingSection.js'
import type { AccountState, ReportingFormState } from '../types/app.js'
import type { MarketDetails, ReportingDetails } from '../types/contracts.js'
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

function createMarketDetails(): MarketDetails {
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
	}
}

function createReportingDetails(): ReportingDetails {
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

	test('shows a reporting stage banner and workflow summary strip', async () => {
		const renderedComponent = await renderIntoDocument(h(ReportingSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getAllByText('Active').length).toBeGreaterThan(0)
		expect(documentQueries.queryByText('Available')).toBeNull()
		expect(documentQueries.queryByText('Blocked')).toBeNull()
		expect(documentQueries.queryByText('Reporting Workflow')).toBeNull()
		expect(document.body.textContent?.includes('Selected side currently has')).toBe(true)
		expect(document.body.textContent?.includes('Selected side has')).toBe(true)
	})

	test('renders the pre-reporting stage inside the shared warning surface', async () => {
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
		expect(documentQueries.getByRole('heading', { name: 'Pre-Reporting' })).not.toBeNull()
		expect(document.body.querySelector('.warning-surface.lifecycle-stage-banner')).not.toBeNull()
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
