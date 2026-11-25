import { expect, test } from 'bun:test'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { testDouble } from '@zoltar/ui-core-shared/tests/testUtils/testDouble.js'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import type { ActiveReportingDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { decodeQuestionHeading, StatoblastQuestionHead } from '../../app/components/StatoblastQuestionHead.js'
import { decodeSharesBalance, SavedShares } from '../../app/components/SavedShares.js'

const lifecycle = installDomTestLifecycle()
const pool = '0x0000000000000000000000000000000000000001' as const
const question = {
	ordinaryEscalationGameStarted: true,
	questionId: '0x01',
	questionLedgerAddress: pool,
	marketDetails: { title: 'Test question', description: '', endTime: 10n },
}

test('rules show the response window from the ledger snapshot and the fork branches below resolution', async () => {
	installStatoblastRouting()
	const saved = decodeQuestionHeading({ ...question, ordinaryEscalationGameStarted: false, questionOutcome: 'none', universeHasForked: false, initialReportingResponseWindow: 172_800n })
	if (saved === undefined) throw new Error('Saved question heading was not decoded')
	const view = lifecycle.trackRendered(await renderIntoDocument(<StatoblastQuestionHead page={{ kind: 'question', pool, questionId: 1n, tab: 'claims' }} question={saved} reporting={undefined} now={20n} hasShares={false} presentationOnly />))
	const rules = view.container.querySelector('.statoblast-question-details')
	expect(rules?.textContent).toContain('Response window2d')
	const branch = view.container.querySelector('.statoblast-question-progress .statoblast-fork-step')
	expect(branch?.previousElementSibling?.textContent).toContain('Resolved')
	expect(branch?.textContent).toContain('or Fork')
})

test('saved holdings display amounts in the collateral token’s decimals', async () => {
	const balances = { decimals: 6, yesAttoShares: 1_250_000n, noAttoShares: 2_500_000n, invalidAttoShares: 3_750_000n }
	const cached = decodeSharesBalance(balances)
	if (cached === undefined) throw new Error('Saved holdings were not decoded')
	const view = lifecycle.trackRendered(await renderIntoDocument(<SavedShares {...cached} />))
	expect([...view.container.querySelectorAll('dd')].map(item => item.textContent)).toEqual(['1.25', '2.50', '3.75'])
})

test('the fork step follows an undecided deadline read from chain', async () => {
	installStatoblastRouting()
	const reporting = testDouble<ActiveReportingDetails>({ status: 'active', settlementState: 'locked', hasReachedNonDecision: true, escalationEndTime: 3_700n, sides: [] })
	const view = lifecycle.trackRendered(await renderIntoDocument(<StatoblastQuestionHead page={{ kind: 'question', pool, questionId: 1n, tab: 'reporting' }} question={{ ...question, questionOutcome: 'none', universeHasForked: false }} reporting={reporting} now={4_000n} hasShares={false} presentationOnly />))
	const end = view.container.querySelector('.statoblast-question-progress li[data-danger=true]')
	expect(end?.textContent).toContain('Ended undecided')
	expect(end?.querySelector('time')?.getAttribute('datetime')).toBe('1970-01-01T01:01:40.000Z')
	expect(view.container.querySelector('.statoblast-question-progress [aria-current=step]')?.textContent).toContain('ForkWaiting for a trigger')
})

test.each([
	{ questionOutcome: 'yes' as const, universeHasForked: true, reporting: undefined },
	{ questionOutcome: 'none' as const, universeHasForked: false, reporting: testDouble<ActiveReportingDetails>({ status: 'active', settlementState: 'resolved', questionOutcome: 'yes', hasReachedNonDecision: true, sides: [] }) },
])('the question head shows the resolved stage even when the question or its parent forked', async ({ reporting, ...result }) => {
	installStatoblastRouting()
	const view = lifecycle.trackRendered(await renderIntoDocument(<StatoblastQuestionHead page={{ kind: 'question', pool, questionId: 1n, tab: 'claims' }} question={{ ...question, ...result }} reporting={reporting} now={20n} hasShares={false} presentationOnly />))
	expect(view.container.querySelector('.statoblast-question-stage .badge')?.textContent).toBe('Resolved')
	expect(view.container.textContent).not.toContain('Ended undecided')
})

test.each([
	{ forkQuestionId: 1n, started: true, phase: 'Undecided · fork step', current: 'Fork' },
	{ forkQuestionId: 2n, started: true, phase: 'Response window', current: 'Response window' },
	{ forkQuestionId: 2n, started: false, phase: 'Trading', current: 'Trading' },
])('a forked universe keeps the actual question stage when forked question ID is $forkQuestionId', async ({ forkQuestionId, started, phase, current }) => {
	installStatoblastRouting()
	const heading = decodeQuestionHeading({ ...question, ordinaryEscalationGameStarted: started, questionOutcome: 'none', universeHasForked: true, forkQuestionId, forkedAt: 5n })
	if (heading === undefined) throw new Error('Saved heading was not decoded')
	const view = lifecycle.trackRendered(await renderIntoDocument(<StatoblastQuestionHead page={{ kind: 'question', pool, questionId: 1n, tab: 'reporting' }} question={heading} reporting={undefined} now={20n} hasShares={false} />))
	expect(view.container.querySelector('.statoblast-question-stage .badge')?.textContent).toBe(phase)
	expect(view.container.querySelector('.statoblast-question-progress [aria-current=step] strong')?.textContent).toBe(current)
	if (forkQuestionId === 2n) {
		expect(view.container.textContent).toContain('This universe has forked.')
		expect(view.container.textContent).not.toContain('Trading is open')
	}
})
