import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { ActiveReportingDetails, EscalationSide } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { decodeReportingOverview, reportingOverview, StatoblastReportingOverview } from '../../app/components/StatoblastReportingOverview.js'

const lifecycle = installDomTestLifecycle()
const rep = (amount: bigint) => amount * 10n ** 18n
const yesDeposit = { amountAttoRep: rep(3n), cumulativeAmountAttoRep: rep(3n), depositIndex: 0n, depositor: zeroAddress }

function side(key: 'yes' | 'no' | 'invalid', balance: bigint, saved = false): EscalationSide {
	const label = { yes: 'Yes', no: 'No', invalid: 'Invalid' }[key]
	const deposits = saved ? [yesDeposit] : []
	return { key, label, balance, deposits, userDeposits: deposits, importedUserDeposits: [] }
}

function details(overrides: Partial<ActiveReportingDetails> = {}): ActiveReportingDetails {
	return {
		status: 'active',
		activationTime: 120n,
		bindingCapital: 0n,
		currentRequiredBond: rep(1n),
		currentTime: 150n,
		earliestForkTime: 0n,
		escalationEndTime: 300n,
		escalationGameAddress: zeroAddress,
		forkThresholdAttoRep: rep(200n),
		hasReachedNonDecision: false,
		marketDetails: createMarketDetails({ endTime: 100n }),
		nonDecisionThresholdAttoRep: rep(100n),
		parentWithdrawalEnabled: false,
		questionLedgerAddress: zeroAddress,
		questionOutcome: 'none',
		settlementCollateralAttoEth: 0n,
		settlementState: 'locked',
		sides: [side('yes', rep(3n), true), side('no', rep(8n)), side('invalid', 0n)],
		startBondAttoRep: rep(1n),
		systemState: 'operational',
		totalCostAttoRep: rep(1n),
		universeId: 0n,
		...overrides,
	}
}

test('the reporting banner explains the consequence of falling behind and marks verified saved deposits', async () => {
	const view = reportingOverview(details(), Date.now())
	const leadActions: [string, bigint][] = []
	const result = lifecycle.trackRendered(await renderIntoDocument(<StatoblastReportingOverview view={view} now={150n} autoRefresh={false} onTakeLead={(side, amount) => leadActions.push([side, amount])} />))
	const { getByLabelText, getByRole, getByText } = within(result.container)
	expect(getByText("You're behind on Yes")).toBeDefined()
	expect(result.container.textContent).toMatch(/If Yes is still behind when the window ends, your 3(?:\.00)?\s+REP is lost\./)
	expect(getByText(/Behind,/)).toBeDefined()
	expect(getByLabelText('Deposit saved on this device')).toBeDefined()
	expect(result.container.querySelector('details')?.open).toBe(false)
	expect(getByText('How reporting works')).toBeDefined()
	await act(() => getByRole('button', { name: /^Report.*on Yes/ }).click())
	expect(leadActions).toEqual([['Yes', rep(5n) + 1n]])
})

test('stake found on chain without a located deposit is not marked saved', async () => {
	const view = reportingOverview(details({ sides: [{ ...side('yes', rep(3n)), localPrincipalAttoRep: rep(3n) }, side('no', rep(8n))] }), Date.now())
	const result = lifecycle.trackRendered(await renderIntoDocument(<StatoblastReportingOverview view={view} now={150n} autoRefresh={false} />))
	expect(within(result.container).getByText("You're behind on Yes")).toBeDefined()
	expect(Boolean(within(result.container).queryByRole('img', { name: 'Deposit saved on this device' }))).toBe(false)
})

test('a forked parent with a live response window points to recovery instead of offering another report', async () => {
	const view = decodeReportingOverview(reportingOverview(details({ settlementState: 'migration-required' }), Date.now()))
	if (view === undefined) throw new Error('Expected the Reporting snapshot to round-trip')
	const result = lifecycle.trackRendered(await renderIntoDocument(<StatoblastReportingOverview view={view} now={150n} autoRefresh={false} onTakeLead={() => undefined} />))
	const queries = within(result.container)
	expect(Boolean(queries.queryByRole('button', { name: /^Report.*on Yes/ }))).toBe(false)
	expect(queries.getByText(/Your deposits carry over/)).toBeDefined()
})

test('the reporting banner distinguishes open without reports, an empty game and tied outcomes', async () => {
	const notStarted = reportingOverview({ ...details(), status: 'not-started' }, Date.now())
	const noReports = lifecycle.trackRendered(await renderIntoDocument(<StatoblastReportingOverview view={notStarted} now={150n} autoRefresh={false} />))
	expect(noReports.container.textContent).toMatch(/No reports yet\. The first report needs at least 1(?:\.00)?\s+REP\./)
	const empty = reportingOverview(details({ sides: [side('yes', 0n), side('no', 0n), side('invalid', 0n)] }), Date.now())
	const emptyGame = lifecycle.trackRendered(await renderIntoDocument(<StatoblastReportingOverview view={empty} now={150n} autoRefresh={false} />))
	expect(within(emptyGame.container).getByText('No REP staked on any outcome')).toBeDefined()
	const tied = reportingOverview(details({ sides: [side('yes', rep(3n), true), side('no', rep(3n)), side('invalid', 0n)] }), Date.now())
	const tiedGame = lifecycle.trackRendered(await renderIntoDocument(<StatoblastReportingOverview view={tied} now={150n} autoRefresh={false} />))
	expect(within(tiedGame.container).getByText('Tied')).toBeDefined()
	expect(tiedGame.container.textContent).toContain('it stays open until one outcome leads')
})

test('a cached resolved banner shows the verified payout and takes precedence over fork and deadline states', async () => {
	const selected = details({ settlementState: 'resolved', questionOutcome: 'yes', parentWithdrawalEnabled: true, hasReachedNonDecision: true })
	const view = decodeReportingOverview(reportingOverview(selected, Date.now() - 120_000))
	if (view === undefined) throw new Error('Expected the Reporting snapshot to round-trip')
	const result = lifecycle.trackRendered(await renderIntoDocument(<StatoblastReportingOverview view={view} now={301n} autoRefresh={false} checkingDeadline />))
	expect(within(result.container).getByText('Resolved as Yes')).toBeDefined()
	expect(result.container.textContent).toMatch(/Claim 3(?:\.00)?\s+REP from your Yes deposits/)
	expect(within(result.container).getByText('as of 2 min ago')).toBeDefined()
})

test('the resolved banner links to Shares and respects the collateral decimals', async () => {
	const view = reportingOverview(details({ settlementState: 'resolved', questionOutcome: 'yes' }), Date.now())
	const result = lifecycle.trackRendered(await renderIntoDocument(<StatoblastReportingOverview view={view} now={301n} autoRefresh={false} winningShares={{ amount: 2_500_000n, decimals: 6, href: '#/test/shares' }} />))
	expect(result.container.textContent).toContain('2.50 Yes shares can also be redeemed on Shares.')
	expect(within(result.container).getByRole('link', { name: 'Shares' }).getAttribute('href')).toBe('#/test/shares')
})
