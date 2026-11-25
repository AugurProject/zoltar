import { expect, test } from 'bun:test'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { testDouble } from '@zoltar/ui-core-shared/tests/testUtils/testDouble.js'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import type { ActiveReportingDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { StatoblastQuestionHead } from '../../app/components/StatoblastQuestionHead.js'
import { decodeSharesBalance, SavedShares } from '../../app/components/SavedShares.js'

const lifecycle = installDomTestLifecycle()
const pool = '0x0000000000000000000000000000000000000001' as const
const question = {
	ordinaryEscalationGameStarted: true,
	questionId: '0x01',
	questionLedgerAddress: pool,
	marketDetails: { title: 'Test question', description: '', endTime: 10n },
}

test('saved holdings display amounts in the collateral token’s decimals', async () => {
	const balances = { decimals: 6, yesAttoShares: 1_250_000n, noAttoShares: 2_500_000n, invalidAttoShares: 3_750_000n }
	const cached = decodeSharesBalance(balances)
	if (cached === undefined) throw new Error('Saved holdings were not decoded')
	const view = lifecycle.trackRendered(await renderIntoDocument(<SavedShares {...cached} />))
	expect([...view.container.querySelectorAll('dd')].map(item => item.textContent)).toEqual(['1.25', '2.50', '3.75'])
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
