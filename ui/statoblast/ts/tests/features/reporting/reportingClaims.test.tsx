import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import type { ReportingSectionProps } from '@zoltar/ui-statoblast-shared/features/oracleTypes.js'
import { ReportingSection } from '@zoltar/ui-statoblast-shared/features/reporting/components/ReportingSection.js'
import type { ActiveReportingDetails, EscalationDeposit } from '@zoltar/ui-statoblast-shared/types/contracts.js'

const lifecycle = installDomTestLifecycle()
const rep = (amount: bigint) => amount * 10n ** 18n

function createDeposit(overrides: Partial<EscalationDeposit> = {}): EscalationDeposit {
	return { amountAttoRep: rep(1n), cumulativeAmountAttoRep: rep(1n), depositIndex: 0n, depositor: zeroAddress, ...overrides }
}

test('claims the selected saved winning deposits together and shows losing deposits without an action', async () => {
	const winning = [createDeposit(), createDeposit({ depositIndex: 2n, amountAttoRep: rep(2n), cumulativeAmountAttoRep: rep(3n) })]
	const losing = [createDeposit({ depositIndex: 0n, amountAttoRep: 0n, originalAttoRep: rep(1n) }), createDeposit({ depositIndex: 1n, amountAttoRep: 0n })]
	const calls: Parameters<ReportingSectionProps['onWithdrawEscalation']>[] = []
	const details: ActiveReportingDetails = {
		status: 'active',
		currentTime: 150n,
		activationTime: 120n,
		currentRequiredBond: rep(1n),
		earliestForkTime: 0n,
		escalationEndTime: 300n,
		escalationGameAddress: zeroAddress,
		forkThresholdAttoRep: rep(40n),
		nonDecisionThresholdAttoRep: rep(20n),
		marketDetails: createMarketDetails({ endTime: 100n }),
		hasReachedNonDecision: false,
		questionLedgerAddress: zeroAddress,
		settlementCollateralAttoEth: 1n,
		startBondAttoRep: rep(1n),
		systemState: 'operational',
		totalCostAttoRep: rep(1n),
		universeId: 1n,
		bindingCapital: 0n,
		questionOutcome: 'yes',
		settlementState: 'resolved',
		parentWithdrawalEnabled: true,
		sides: [
			{ balance: rep(3n), deposits: winning, importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: winning },
			{ balance: 0n, deposits: losing, importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
		],
	}
	lifecycle.trackRendered(
		await renderIntoDocument(
			<ReportingSection
				designedOverview
				accountState={createAccountState()}
				loadingReportingDetails={false}
				onApproveReportingRep={() => undefined}
				onLoadReporting={() => undefined}
				onReportOutcome={() => undefined}
				onReportingFormChange={() => undefined}
				onWithdrawEscalation={(...args) => calls.push(args)}
				reportingActiveAction={undefined}
				reportingDetails={details}
				reportingError={undefined}
				reportingResult={undefined}
				reportingForm={{ questionLedgerAddress: zeroAddress, reportAmount: '', selectedOutcome: undefined, selectedWithdrawDepositIndexesByOutcome: { yes: [], no: [], invalid: [] } }}
			/>,
		),
	)
	const claims = document.body.querySelector('table[aria-label="Claim your REP"]')
	if (claims === null) throw new Error('Expected the claim table')
	const rows = within(claims)
	const first = rows.getByRole('checkbox', { name: 'Deposit #0 · Yes' })
	const second = rows.getByRole('checkbox', { name: 'Deposit #2 · Yes' })
	expect(first).toHaveProperty('checked', true)
	expect(second).toHaveProperty('checked', true)
	expect(rows.getAllByRole('checkbox')).toHaveLength(2)
	const losingRows = [...claims.querySelectorAll('tbody tr')].filter(row => row.textContent?.includes('Lost, no action needed'))
	expect(losingRows).toHaveLength(2)
	expect(losingRows[0]?.textContent).toContain('1.00 REP')
	expect(losingRows[1]?.textContent).not.toContain('1.00 REP')
	expect(losingRows[1]?.textContent?.match(/0\.00 REP/g)).toHaveLength(1)
	const queries = within(document.body)
	expect(queries.getAllByRole('button', { name: /^Claim .*REP/ })).toHaveLength(1)
	expect(queries.queryByRole('button', { name: /settled No records/ })).toBeNull()
	await act(() => fireEvent.click(first))
	expectTransactionButtonEnabled(document.body, 'Claim 2.00 REP')
	await act(() => fireEvent.click(second))
	expectTransactionButtonDisabled(document.body, 'Claim 0.00 REP', 'Select a deposit to claim.')
	await act(() => fireEvent.click(first))
	await act(() => fireEvent.click(second))
	await act(() => fireEvent.click(queries.getByRole('button', { name: 'Claim 3.00 REP' })))
	expect(calls).toEqual([['yes', [0n, 2n]]])
})
