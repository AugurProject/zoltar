import { describe, expect, test } from 'bun:test'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { capitalUnit as E, useCapitalTestFixture } from './statoblast/securityPoolCapitalTestFixture'

// Audit regression: `_takeOver` cures the target first and then requires it to still be
// unhealthy. When the target's own deficit fit in `totalCommitment - demand`, the cure healed
// it, the quote reverted, and the revert undid the cure. The spare was never consumed, so with
// several unhealthy owners whose combined deficit exceeded it, no position could be taken over
// while outstanding demand stayed under-backed. A healing cure now stands without an award.
describe('audit: a curable target no longer blocks every takeover', () => {
	const fixture = useCapitalTestFixture()
	const alice = 0
	const bob = 1
	const keeper = 2
	const setDemand = (amount: bigint) => writeContractAndWait(fixture.client(), () => fixture.client().writeContract({ ...fixture.harness, functionName: 'setDemand', args: [amount] }))
	const takeOver = (id: bigint, commitment: bigint) => writeContractAndWait(fixture.client(keeper), () => fixture.client(keeper).writeContract({ ...fixture.capital, functionName: 'takeOver', args: [id, commitment, 0n, 10_000n * E] }))
	const totals = () => fixture.client().readContract({ ...fixture.capital, functionName: 'totals' })
	const started = (id: bigint) => fixture.client().readContract({ ...fixture.capital, functionName: 'liquidationStarted', args: [id] })

	test('the first call applies the cure, and the position left without spare is taken over', async () => {
		await fixture.fundOwners()
		// Two owners each back 100 ETH of commitment exactly (multiplier 1.05, price 1).
		await fixture.deposit(alice, 105n * E)
		await fixture.deposit(bob, 105n * E)
		const a = await fixture.authorize(alice, 100n * E)
		const b = await fixture.authorize(bob, 100n * E)
		// Traders hold 150 ETH of claims: spare commitment above demand is 50 ETH.
		await setDemand(150n * E)
		// REP halves in value. Each owner's 105 REP now backs only 50 ETH: each has a 50 ETH deficit.
		await fixture.price(2n * E)
		expect(await started(a)).toBeGreaterThan(0n)
		expect(await started(b)).toBeGreaterThan(0n)
		expect((await totals())[2]).toBe(0n)

		await fixture.deposit(keeper, 1_000n * E)
		await fixture.getAnvilWindowEthereum().advanceTime(7_200n)
		// Alice's deficit fits the spare. The call cures her and pays no award.
		await takeOver(a, 100n * E)
		expect(await fixture.position(a)).toMatchObject({ rep: 105n * E, commitment: 50n * E })
		expect(await started(a)).toBe(0n)
		expect((await fixture.owner(keeper)).positionId).toBe(0n)
		expect((await fixture.owner(keeper)).freeAttoRep).toBe(1_000n * E)
		expect((await totals())[2]).toBe(50n * E)
		// A healthy position cannot be touched again.
		await expect(takeOver(a, 50n * E)).rejects.toThrow('Adverse observation missing')

		// No spare remains for Bob, so his position is now open to a real takeover.
		await takeOver(b, 100n * E)
		const receiver = (await fixture.owner(keeper)).positionId
		expect(await fixture.position(receiver)).toMatchObject({ rep: 1_000n * E, commitment: 50n * E })
		expect(await fixture.position(b)).toMatchObject({ rep: 105n * E, commitment: 50n * E })
		// Demand is fully backed by healthy commitment again.
		expect((await totals())[2]).toBe(150n * E)
	})
})
