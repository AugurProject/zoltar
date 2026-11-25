/// <reference types="bun-types" />

import { getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installFakeEnvironmentLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import * as securityPoolCopy from '@zoltar/ui-statoblast-shared/copy/securityPool.js'
import { ReportingSection } from '@zoltar/ui-statoblast-shared/features/reporting/components/ReportingSection.js'
import type { OwnForkAdmission } from '@zoltar/ui-statoblast-shared/protocol/reporting.js'
import type { ActiveReportingDetails, EscalationSide } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { useOwnForkTrigger, type UseOwnForkTriggerDependencies } from '../../app/hooks/useOwnForkTrigger.js'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'

const ATTO_REP = 10n ** 18n
const pool = getAddress('0x00000000000000000000000000000000000000c1')
const forkHash = '0x00000000000000000000000000000000000000000000000000000000000000f1'
const approvalHash = '0x00000000000000000000000000000000000000000000000000000000000000a1'

function side(key: EscalationSide['key'], label: string, balance: bigint): EscalationSide {
	return { balance, deposits: [], importedUserDeposits: [], key, label, userDeposits: [] }
}

const reportingDetails: ActiveReportingDetails = {
	activationTime: 120n,
	bindingCapital: 10n,
	currentRequiredBond: 2n,
	currentTime: 150n,
	earliestForkTime: 0n,
	escalationEndTime: 300n,
	escalationGameAddress: zeroAddress,
	forkThresholdAttoRep: 40n,
	hasReachedNonDecision: true,
	marketDetails: { answerUnit: '', createdAt: 1n, description: '', displayValueMax: 100n, displayValueMin: 0n, endTime: 100n, exists: true, marketType: 'binary', numTicks: 2n, outcomeLabels: ['Yes', 'No'], questionId: '0x01', startTime: 1n, title: 'Will this resolve?' },
	nonDecisionThresholdAttoRep: 20n,
	parentWithdrawalEnabled: false,
	questionOutcome: 'none',
	questionLedgerAddress: pool,
	settlementCollateralAttoEth: 1n,
	settlementState: 'locked',
	sides: [side('invalid', 'Invalid', 20n), side('yes', 'Yes', 20n), side('no', 'No', 0n)],
	startBondAttoRep: 1n,
	status: 'active',
	systemState: 'operational',
	totalCostAttoRep: 0n,
	universeId: 1n,
	viewerWalletRepAllowanceAttoRep: 0n,
	viewerWalletRepBalanceAttoRep: 100n * ATTO_REP,
}

function Harness({ dependencies, details = reportingDetails, reportAmount = '5' }: { dependencies: UseOwnForkTriggerDependencies; details?: ActiveReportingDetails; reportAmount?: string }) {
	const ownFork = useOwnForkTrigger(
		{
			active: details.hasReachedNonDecision,
			onForked: async () => undefined,
			parameters: { accountAddress: zeroAddress, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, refreshState: async () => undefined },
			question: { questionLedgerAddress: pool, universeId: 1n },
			refreshKey: 0,
		},
		dependencies,
	)
	return (
		<ReportingSection
			accountState={createAccountState({ address: zeroAddress })}
			currentTimestamp={150n}
			designedOverview
			loadingReportingDetails={false}
			onApproveReportingRep={() => undefined}
			onLoadReporting={() => undefined}
			onReportOutcome={() => undefined}
			onReportingFormChange={() => undefined}
			onTriggerZoltarFork={() => void ownFork.triggerFork()}
			onWithdrawEscalation={() => undefined}
			reportingActiveAction={undefined}
			reportingDetails={details}
			reportingError={undefined}
			reportingForm={{ reportAmount, questionLedgerAddress: pool, selectedOutcome: 'yes', selectedWithdrawDepositIndexesByOutcome: { invalid: [], no: [], yes: [] } }}
			reportingResult={undefined}
			showHeader={false}
			showQuestionLedgerAddressInput={false}
			triggerZoltarForkApproval={ownFork.approval}
			triggerZoltarForkAvailability={ownFork.triggerForkAvailability}
			triggerZoltarForkPending={ownFork.forkPending}
		/>
	)
}

function createDependencies(initial: OwnForkAdmission) {
	let admission = initial
	const sent: string[] = []
	const dependencies: UseOwnForkTriggerDependencies = {
		approveOwnForkAdmission: async (_account: Address, _callbacks, _pool: Address, amountAttoRep: bigint) => {
			sent.push(`approve:${amountAttoRep.toString()}`)
			admission = { ...admission, allowanceAttoRep: amountAttoRep }
			return approvalHash
		},
		forkWithOwnEscalationGame: async () => {
			sent.push('fork')
			return forkHash
		},
		loadOwnForkAdmission: async () => admission,
	}
	return { dependencies, sent }
}

describe('redesigned question report', () => {
	const { trackCleanup } = installFakeEnvironmentLifecycle({ accountAddress: zeroAddress, installActiveEnvironment: installActiveEnvironmentForTesting })

	test('previews the wallet payout, accepted stake, new leader, and response deadline', async () => {
		const { dependencies } = createDependencies({ allowanceAttoRep: 0n, recommendedApprovalAttoRep: 0n, shortfallAttoRep: 0n })
		const details: ActiveReportingDetails = {
			...reportingDetails,
			bindingCapital: 5n * ATTO_REP,
			forkThresholdAttoRep: 40n * ATTO_REP,
			hasReachedNonDecision: false,
			nonDecisionThresholdAttoRep: 20n * ATTO_REP,
			sides: [side('invalid', 'Invalid', ATTO_REP), { ...side('yes', 'Yes', 5n * ATTO_REP), userDeposits: [{ amountAttoRep: ATTO_REP, cumulativeAmountAttoRep: ATTO_REP, depositIndex: 0n, depositor: zeroAddress }] }, side('no', 'No', 8n * ATTO_REP)],
			startBondAttoRep: 3n * ATTO_REP,
		}
		const rendered = await renderIntoDocument(<Harness dependencies={dependencies} details={details} reportAmount='4' />)
		trackCleanup(rendered.cleanup)
		const queries = within(document.body)
		const comparison = queries.getByText('After this report', { selector: 'caption' }).closest('table')
		const cells = (label: RegExp) => {
			const row = Array.from(comparison?.querySelectorAll('tbody tr') ?? []).find(candidate => label.test(candidate.querySelector('th')?.textContent ?? ''))
			return Array.from(row?.querySelectorAll('td') ?? [], cell => cell.textContent?.replaceAll('\u00a0', ' '))
		}
		expect(cells(/^You.d get back/)).toEqual(['0.00 REP', '≈ 7.67 REP(exact 7.666666666666666667 REP)'])
		expect(cells(/^Your REP staked on Yes/)).toEqual(['1.00 REP', '5.00 REP'])
		expect(cells(/^Leader/)).toEqual(['No', 'Yes'])
		const [before, after] = cells(/^Window ends/)
		expect(before).toBe(formatTimestamp(details.escalationEndTime))
		expect(after).not.toBe(before)
		expect(queries.getByRole('radio', { name: /^Yes/ })).not.toBeNull()
		expect(document.body.textContent?.replaceAll('\u00a0', ' ')).toContain('If Yes loses, you lose 5.00 REP.')
	})
})

const forkSection = () => {
	const heading = within(document.body).getByRole('heading', { name: securityPoolCopy.forkAdmission })
	const section = heading.closest('section')
	if (section === null) throw new Error('Missing fork admission section')
	return section
}

describe('own-question fork admission', () => {
	const { trackCleanup } = installFakeEnvironmentLifecycle({ accountAddress: zeroAddress, installActiveEnvironment: installActiveEnvironmentForTesting })

	test('a shortfall shows its own approval before the fork, which stays blocked until approved and then sends only the fork', async () => {
		const shortfall = 40n * ATTO_REP
		const { dependencies, sent } = createDependencies({ allowanceAttoRep: 0n, recommendedApprovalAttoRep: shortfall + ATTO_REP, shortfallAttoRep: shortfall })
		const rendered = await renderIntoDocument(<Harness dependencies={dependencies} />)
		trackCleanup(rendered.cleanup)
		const approveButton = () => {
			const [button] = within(forkSection()).getAllByRole('button')
			if (button === undefined) throw new Error('Missing approval button')
			return button
		}
		// The approval precedes the fork as its own button, defaulting to the shortfall plus the recommended 1 REP buffer.
		await waitFor(() => expect(approveButton().textContent?.replaceAll('\u00a0', ' ')).toBe('Approve 41 REP'))
		expect(forkSection().textContent?.replaceAll('\u00a0', ' ')).toContain('Triggering costs you 40.00 REP')
		expect(
			within(forkSection())
				.getAllByRole('button')
				.map(button => button.textContent),
		).toEqual([approveButton().textContent, securityPoolCopy.triggerUniverseFork])
		expectTransactionButtonDisabled(document.body, securityPoolCopy.triggerUniverseFork, securityPoolCopy.forkAdmissionApprovalRequired)
		await act(async () => {
			fireEvent.click(approveButton())
		})
		await waitFor(() => expectTransactionButtonEnabled(document.body, securityPoolCopy.triggerUniverseFork))
		expect(sent).toEqual([`approve:${(shortfall + ATTO_REP).toString()}`])
		expect(
			within(forkSection())
				.getAllByRole('button')
				.map(button => button.textContent),
		).toEqual([securityPoolCopy.triggerUniverseFork])
		expect(within(forkSection()).getByRole('textbox', { name: 'REP approval amount' })).not.toBeNull()
		await act(async () => {
			fireEvent.click(within(document.body).getByRole('button', { name: securityPoolCopy.triggerUniverseFork }))
		})
		await waitFor(() => expect(sent).toEqual([`approve:${(shortfall + ATTO_REP).toString()}`, 'fork']))
	})

	test('without a shortfall the fork is the only step and one click sends exactly the fork', async () => {
		const { dependencies, sent } = createDependencies({ allowanceAttoRep: 0n, recommendedApprovalAttoRep: 0n, shortfallAttoRep: 0n })
		const rendered = await renderIntoDocument(<Harness dependencies={dependencies} />)
		trackCleanup(rendered.cleanup)
		await waitFor(() => expectTransactionButtonEnabled(document.body, securityPoolCopy.triggerUniverseFork))
		expect(within(forkSection()).queryByRole('button', { name: /approve/i })).toBeNull()
		expect(within(forkSection()).queryByRole('textbox', { name: 'REP approval amount' })).toBeNull()
		expect(forkSection().textContent).not.toContain('Triggering costs you')
		expect(forkSection().textContent).not.toContain('Cost from your wallet')
		expect(forkSection().textContent).toContain('A fork cannot be undone.')
		expect(forkSection().textContent).toContain('Your REP stays staked and carries to the child universes after the fork.')
		expect(forkSection().textContent).not.toContain('—')
		expect(within(document.body).queryByRole('textbox', { name: 'Report amount' })).toBeNull()
		expect(within(document.body).queryByRole('button', { name: /^Report Yes/ })).toBeNull()
		await act(async () => {
			fireEvent.click(within(document.body).getByRole('button', { name: securityPoolCopy.triggerUniverseFork }))
		})
		await waitFor(() => expect(sent).toEqual(['fork']))
	})

	test('shows only the checking fork step while the cost is unknown', async () => {
		const { dependencies } = createDependencies({ allowanceAttoRep: 0n, recommendedApprovalAttoRep: 0n, shortfallAttoRep: 0n })
		const admission = Promise.withResolvers<OwnForkAdmission>()
		const rendered = await renderIntoDocument(<Harness dependencies={{ ...dependencies, loadOwnForkAdmission: () => admission.promise }} />)
		trackCleanup(rendered.cleanup)
		expectTransactionButtonDisabled(forkSection(), 'Checking…', securityPoolCopy.checkingForkAdmission)
		expect(within(forkSection()).queryByRole('textbox', { name: 'REP approval amount' })).toBeNull()
		expect(forkSection().textContent).not.toContain('Triggering costs you')
		expect(forkSection().textContent).not.toContain('—')
		await act(async () => {
			admission.resolve({ allowanceAttoRep: 0n, recommendedApprovalAttoRep: 0n, shortfallAttoRep: 0n })
		})
		await waitFor(() => expectTransactionButtonEnabled(forkSection(), securityPoolCopy.triggerUniverseFork))
	})
})
