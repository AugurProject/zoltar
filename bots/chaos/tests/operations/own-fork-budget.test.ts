import { relevantTokenSpenders } from '../../src/monitoring/discovery-escalation.ts'
import { expect, test } from 'bun:test'
import { forkDefinition } from '../../src/operations/statoblast/forks.ts'
import { address, planningOptionsFixture, snapshotFixture } from './fixture.ts'

test('own-question fork obeys REP budget and reserve, and records the actual wallet debit (#1664)', () => {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	const universe = snapshot.universes[0]
	if (pool === undefined || universe === undefined) throw new Error('Missing fork fixture')
	Object.assign(pool, { ownQuestionForkReady: true, ownQuestionForkShortfallAttoRep: 101n.toString(), ownQuestionForkSpender: address(50) })
	const definition = forkDefinition('own-question')
	const options = planningOptionsFixture({ maxRepSpendAttoRep: 100n.toString(), minimumRepReserveAttoRep: 0n.toString() })
	expect(definition.buildPlan(snapshot, options)).toBeUndefined()
	Object.assign(pool, { ownQuestionForkShortfallAttoRep: 100n.toString() })
	const inventory = snapshot.wallet.tokens.find(token => token.address === universe.repToken)
	if (inventory === undefined) throw new Error('Missing REP inventory')
	inventory.balance = '100'
	inventory.allowances[address(50)] = '100'
	expect(definition.buildPlan(snapshot, { ...options, minimumRepReserveAttoRep: 1n.toString() })).toBeUndefined()
	const plan = definition.buildPlan(snapshot, options)
	expect(plan?.steps.at(-1)?.walletAssetDebits).toContainEqual({ amount: '100', asset: universe.repToken, category: 'rep', kind: 'erc20' })
	expect(plan?.steps.at(-1)?.preflightCalls).toHaveLength(1)
	Object.assign(pool, { ownQuestionForkShortfallAttoRep: 0n.toString() })
	expect(definition.buildPlan(snapshot, options)?.steps.at(-1)?.walletAssetDebits).toEqual([])
})

test('discovered REP spenders retain approval for an affordable reporter-ledger shortfall (#1664)', () => {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	if (pool === undefined) throw new Error('Missing fork fixture')
	const reporterLedger = address(99)
	Object.assign(pool, { ownQuestionForkReady: true, ownQuestionForkShortfallAttoRep: 100n.toString(), ownQuestionForkSpender: reporterLedger })
	const inventory = snapshot.wallet.tokens.find(token => token.address === pool.repToken)
	if (inventory === undefined) throw new Error('Missing REP inventory')
	inventory.balance = 100n.toString()
	// Discovery only loads allowances for these addresses; do not inject an undiscovered approval.
	inventory.allowances = Object.fromEntries(relevantTokenSpenders(snapshot.deployments, snapshot.pools, pool.repToken).map(spender => [spender, spender === reporterLedger ? 100n.toString() : 0n.toString()]))
	expect(inventory.allowances[reporterLedger]).toBe(100n.toString())
	expect(relevantTokenSpenders(snapshot.deployments, snapshot.pools, snapshot.deployments.weth)).not.toContain(reporterLedger)
	expect(forkDefinition('own-question').buildPlan(snapshot, planningOptionsFixture({ maxRepSpendAttoRep: 100n.toString(), minimumRepReserveAttoRep: 0n.toString() }))).toBeDefined()
})
