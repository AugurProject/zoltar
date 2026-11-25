import { expect, test } from 'bun:test'
import { eligibleOperationPlans } from '../support/operation-plans.ts'
import { planningOptionsFixture, snapshotFixture } from './fixture.ts'

const planningOptions = planningOptionsFixture()

function plan(snapshot: ReturnType<typeof snapshotFixture>, definitionId: string) {
	return eligibleOperationPlans(snapshot, planningOptions).find(candidate => candidate.definitionId === definitionId)
}

function configureOpenQuestion(snapshot: ReturnType<typeof snapshotFixture>) {
	const question = snapshot.questions[0]
	if (question === undefined) throw new Error('Question fixture missing')
	question.endTime = (BigInt(snapshot.anchor.timestamp) + 10_000n).toString()
	const pool = snapshot.pools[0]
	if (pool === undefined) throw new Error('Missing question')
	pool.additionalMintCapacityAttoEth = (2n * 10n ** 18n).toString()
	pool.purchaseQuote = { spender: pool.coordinator, mintAttoEth: 1000000n.toString(), feeAttoEth: 100000n.toString(), premiumAttoEth: 200000n.toString(), minimumShares: '1000000' }
}

const mintingDefinitionIds = ['statoblast.complete-set.create', 'trading.liquidity.add-eth', 'trading.position.enter']

function expectMintingPlansUseQuestionDeadline(snapshot: ReturnType<typeof snapshotFixture>) {
	const pool = snapshot.pools[0]
	const question = snapshot.questions[0]
	if (pool === undefined || question === undefined) throw new Error('Pool fixture missing')
	pool.escalationGame = '0x0000000000000000000000000000000000000000'
	const laterThanOracleHorizon = BigInt(snapshot.anchor.timestamp) + 300n
	const questionLastSecond = BigInt(question.endTime) - 1n
	for (const definitionId of mintingDefinitionIds) {
		const candidate = plan(snapshot, definitionId)
		expect(candidate, definitionId).toBeDefined()
		const deadline = candidate?.deadlineTimestamp
		if (deadline === undefined) throw new Error(`${definitionId} must keep its question-end deadline`)
		expect(BigInt(deadline) > laterThanOracleHorizon, definitionId).toBe(true)
		expect(BigInt(deadline) <= questionLastSecond, definitionId).toBe(true)
	}
}

test('keeps the question-end deadline for complete-set minting and minting router plans', () => {
	const snapshot = snapshotFixture()
	configureOpenQuestion(snapshot)
	expectMintingPlansUseQuestionDeadline(snapshot)
})
