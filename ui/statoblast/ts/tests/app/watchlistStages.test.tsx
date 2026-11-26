import { expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import type { WatchlistRow } from '@zoltar/ui-statoblast-shared/protocol/watchlistRows.js'
import { WatchlistPoolForkStage, WatchlistQuestionStage } from '../../app/components/WatchlistStages.js'

const lifecycle = installDomTestLifecycle()
const pool: Address = '0x1111111111111111111111111111111111111111'
const question: NonNullable<WatchlistRow['question']> = { marketDetails: { endTime: 10n, title: 'Saved question' }, ordinaryEscalationGameStarted: false, universeHasForked: false, questionOutcome: 'none' }
const questionRow: WatchlistRow = {
	entity: { kind: 'question', id: `${pool}:1`, pool, questionId: 1n },
	status: 'question',
	question,
	observedAt: 20n,
}
const poolRow: WatchlistRow = {
	entity: { kind: 'pool', id: pool, pool },
	status: 'pool',
	observedAt: 20n,
	pledged: 5n * 10n ** 18n,
	forkedAt: 15n,
	forkChoiceDeadline: 40n,
	forkChoiceRecorded: false,
}

test('saved questions show confirmed outcomes, the fork question, migration, and pre-fork reporting stages', async () => {
	const forkQuestionChecking = { ...questionRow, forkedAt: 15n, forkQuestionId: 1n, question: { ...question, universeHasForked: true } }
	const forkQuestion = { ...forkQuestionChecking, nonDecision: true }
	const migrating = { ...forkQuestion, forkQuestionId: 2n, reportingPrincipal: 1n, shares: { yesAttoShares: 1n, noAttoShares: 0n, invalidAttoShares: 0n } }
	const cases: Array<[WatchlistRow, string]> = [
		[{ ...forkQuestion, question: { ...forkQuestion.question, questionOutcome: 'no' } }, 'Resolved as No'],
		[forkQuestion, 'Fork question'],
		[forkQuestionChecking, 'Checking…'],
		[{ ...forkQuestion, nonDecision: false }, 'Frozen'],
		[migrating, 'Migrate your shares to a child universe'],
		[{ ...questionRow, nonDecision: true }, 'Ended undecided'],
		[{ ...questionRow, question: { ...question, ordinaryEscalationGameStarted: true }, escalationEnd: 40n }, 'Response window'],
		[questionRow, 'Reporting open'],
	]
	const rendered = lifecycle.trackRendered(
		await renderIntoDocument(
			<ul>
				{cases.map(([row, label]) => (
					<li key={label}>
						<WatchlistQuestionStage row={row} reason={undefined} />
					</li>
				))}
			</ul>,
		),
	)
	const rows = [...rendered.container.querySelectorAll('li')]
	expect(rows.map(row => row.firstElementChild?.textContent)).toEqual(cases.map(([, label]) => label))
	expect(within(rendered.container).getByText('REP deposits carry to the child universes.')).not.toBeNull()
})

test('saved pools distinguish an open choice, elapsed deadline, selected branch, migration, and activation', async () => {
	const recorded = { ...poolRow, forkChoiceRecorded: true, forkChoiceOutcome: 'No' }
	const cases: Array<[WatchlistRow, string]> = [
		[poolRow, 'Choose a child universe'],
		[{ ...poolRow, observedAt: 40n }, 'Choice window closed'],
		[recorded, 'Moving to No'],
		[{ ...recorded, forkBranchStarted: true }, 'Recapitalizing No'],
		[{ ...recorded, forkBranchReady: true }, 'No active'],
	]
	const rendered = lifecycle.trackRendered(
		await renderIntoDocument(
			<ul>
				{cases.map(([row, label]) => (
					<li key={label}>
						<WatchlistPoolForkStage row={row} />
					</li>
				))}
			</ul>,
		),
	)
	const rows = [...rendered.container.querySelectorAll('li')]
	expect(rows.map(row => row.firstElementChild?.textContent)).toEqual(cases.map(([, label]) => label))
	expect(rendered.container.querySelectorAll('time')).toHaveLength(2)
})
