/// <reference types="bun-types" />

import { getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installFakeEnvironmentLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as transactionStepsCopy from '@zoltar/ui-core-shared/copy/transactionSteps.js'
import * as portfolioCopy from '@zoltar/ui-statoblast-shared/copy/portfolio.js'
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
	securityPoolAddress: pool,
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

function Harness({ dependencies }: { dependencies: UseOwnForkTriggerDependencies }) {
	const ownFork = useOwnForkTrigger(
		{
			active: true,
			onForked: async () => undefined,
			parameters: { accountAddress: zeroAddress, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, refreshState: async () => undefined },
			question: { securityPoolAddress: pool, universeId: 1n },
			refreshKey: 0,
		},
		dependencies,
	)
	return (
		<ReportingSection
			accountState={createAccountState({ address: zeroAddress })}
			currentTimestamp={150n}
			loadingReportingDetails={false}
			onApproveReportingRep={() => undefined}
			onLoadReporting={() => undefined}
			onReportOutcome={() => undefined}
			onReportingFormChange={() => undefined}
			onTriggerZoltarFork={() => void ownFork.triggerFork()}
			onWithdrawEscalation={() => undefined}
			reportingActiveAction={undefined}
			reportingDetails={reportingDetails}
			reportingError={undefined}
			reportingForm={{ reportAmount: '', securityPoolAddress: pool, selectedOutcome: undefined, selectedWithdrawDepositIndexesByOutcome: { invalid: [], no: [], yes: [] } }}
			reportingResult={undefined}
			showHeader={false}
			showSecurityPoolAddressInput={false}
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

const forkSection = () => {
	const heading = within(document.body).getByRole('heading', { name: portfolioCopy.forkAdmission })
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
		expect(
			within(forkSection())
				.getAllByRole('button')
				.map(button => button.textContent),
		).toEqual([approveButton().textContent, portfolioCopy.triggerUniverseFork])
		expectTransactionButtonDisabled(document.body, portfolioCopy.triggerUniverseFork, portfolioCopy.forkAdmissionApprovalRequired)
		await act(async () => {
			fireEvent.click(approveButton())
		})
		await waitFor(() => expectTransactionButtonEnabled(document.body, portfolioCopy.triggerUniverseFork))
		expect(sent).toEqual([`approve:${(shortfall + ATTO_REP).toString()}`])
		expectTransactionButtonDisabled(document.body, commonCopy.approvalSatisfied)
		await act(async () => {
			fireEvent.click(within(document.body).getByRole('button', { name: portfolioCopy.triggerUniverseFork }))
		})
		await waitFor(() => expect(sent).toEqual([`approve:${(shortfall + ATTO_REP).toString()}`, 'fork']))
	})

	test('without a shortfall the approval stays in place as not needed and one fork click sends exactly the fork', async () => {
		const { dependencies, sent } = createDependencies({ allowanceAttoRep: undefined, recommendedApprovalAttoRep: 0n, shortfallAttoRep: 0n })
		const rendered = await renderIntoDocument(<Harness dependencies={dependencies} />)
		trackCleanup(rendered.cleanup)
		await waitFor(() => expectTransactionButtonEnabled(document.body, portfolioCopy.triggerUniverseFork))
		expectTransactionButtonDisabled(forkSection(), transactionStepsCopy.skipped)
		await act(async () => {
			fireEvent.click(within(document.body).getByRole('button', { name: portfolioCopy.triggerUniverseFork }))
		})
		await waitFor(() => expect(sent).toEqual(['fork']))
	})
})
