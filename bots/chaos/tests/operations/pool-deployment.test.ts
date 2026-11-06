import { capitalFixture } from '../support/portfolio-fixtures.ts'
import { expect, test } from 'bun:test'
import { deployPool } from '../../src/operations/statoblast/vaults.ts'
import { snapshotFixture } from './fixture.ts'

const options = { maximumBlockIntervalSeconds: 15, seed: 42, immutableTopologyCapacity: { maxPools: 100, maxQuestions: 100, maxStagedOperationsPerPool: 100, maxUniverses: 100, maxVaultsPerPool: 100, maximumAggregateItems: 10_000 } }

test('offers admission only for questions accepted by the anchored portfolio simulation', () => {
	const snapshot = snapshotFixture()
	const question = snapshot.questions[0]
	if (question === undefined) throw new Error('Missing question fixture')
	snapshot.portfolioCapital = [{ ...capitalFixture(snapshot), admissibleQuestionIds: [] }]
	snapshot.pools = []
	for (const endTime of [snapshot.anchor.timestamp, (BigInt(snapshot.anchor.timestamp) - 1n).toString()]) {
		question.endTime = endTime
		expect(deployPool.evaluate(snapshot, options).eligible).toBe(false)
		expect(deployPool.buildPlan(snapshot, options)).toBeUndefined()
	}
	question.endTime = (BigInt(snapshot.anchor.timestamp) + 1000n).toString()
	snapshot.portfolioCapital[0]?.admissibleQuestionIds.push(question.id)
	expect(deployPool.evaluate(snapshot, options).eligible).toBe(true)
	expect(deployPool.buildPlan(snapshot, options)?.metadata['questionId']).toBe(question.id)
})
