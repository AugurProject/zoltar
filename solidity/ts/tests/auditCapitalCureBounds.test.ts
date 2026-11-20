import { describe, expect, test } from 'bun:test'
import { statoblast_WETH9_WETH9 as wethArtifact } from '../types/contractArtifact'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { BURN_ADDRESS } from '../testSupport/simulator/utils/constants'
import { capitalUnit as E, useCapitalTestFixture } from './statoblast/securityPoolCapitalTestFixture'

// Audit regression for the bounds of the unpaid cure a takeover call applies. The cure
// removed the unbacked part of a commitment, rounded up to the economic minimum, and applied
// no rule to what it left: a position slightly under water kept a commitment below the
// minimum, which its owner could not restate. Whatever a cure leaves is now at least the minimum,
// except for an owner leaving entirely, whose rest waits in the retirement queue.
describe('audit: the unpaid cure never leaves a commitment below the minimum', () => {
	const fixture = useCapitalTestFixture()
	const alice = 0
	const bob = 1
	const keeper = 2
	const MINIMUM = 10n ** 15n
	const admin = () => fixture.client()
	const harnessWrite = (functionName: 'setPriceError' | 'setDemand', value: bigint) => writeContractAndWait(admin(), () => admin().writeContract({ ...fixture.harness, functionName, args: [value] }))
	const totals = () => admin().readContract({ ...fixture.capital, functionName: 'totals' })
	const started = (id: bigint) => admin().readContract({ ...fixture.capital, functionName: 'liquidationStarted', args: [id] })
	const takeOver = (id: bigint, commitment: bigint) => writeContractAndWait(fixture.client(keeper), () => fixture.client(keeper).writeContract({ ...fixture.capital, functionName: 'takeOver', args: [id, commitment, 0n, 10_000n * E] }))
	const setCommitment = (offset: number, commitment: bigint) => writeContractAndWait(fixture.client(offset), () => fixture.client(offset).writeContract({ ...fixture.capital, functionName: 'setCommitment', args: [commitment] }))

	/** Bob commits `commitment` with exactly the required REP, then REP falls to `price` REP per ETH. */
	const underwater = async (commitment: bigint, demand: bigint, price: bigint) => {
		await fixture.fundOwners()
		await fixture.price(E)
		await fixture.deposit(alice, 1_000n * E)
		await fixture.authorize(alice, 100n * E)
		const required = await admin().readContract({ ...fixture.capital, functionName: 'requiredRep', args: [commitment, 10_000n] })
		await fixture.deposit(bob, required)
		const id = await fixture.authorize(bob, commitment)
		await harnessWrite('setDemand', demand)
		await fixture.price(price)
		const supported = (((required * 10_000n) / 10_500n) * E) / price
		expect(await started(id)).toBeGreaterThan(0n)
		return { id, required, supported }
	}

	// One and a half minimums with a quarter-minimum deficit: the cut rounds up to one minimum,
	// which would leave half a minimum. A full cure would release still-backed principal, so it is refused.
	test('a cure that would release still-backed principal leaves the full position for takeover or retirement', async () => {
		const commitment = (3n * MINIMUM) / 2n
		const { id, required, supported } = await underwater(commitment, 0n, (12n * E) / 10n)
		expect(commitment - supported).toBe(MINIMUM / 4n)

		// A caller with no principal cannot turn a minimum-sized cure into a free exit.
		await expect(takeOver(id, commitment)).rejects.toThrow('Receiver collateral insufficient')
		expect(await fixture.position(id)).toMatchObject({ rep: required, commitment })
		expect(await started(id)).toBeGreaterThan(0n)
		expect((await fixture.owner(keeper)).positionId).toBe(0n)
		expect((await fixture.owner(bob)).freeAttoRep).toBe(0n)
		expect((await totals())[2]).toBe(100n * E)
	})

	// The same position with spare of exactly one minimum: the cut can neither finish the
	// commitment nor leave a whole minimum, so the cure removes nothing and the position
	// stays open to a paid takeover of all of it.
	test('a subminimum receiver cannot acquire the source remainder or its REP', async () => {
		const commitment = (3n * MINIMUM) / 2n
		const { id, required } = await underwater(commitment, 100n * E + MINIMUM / 2n, (12n * E) / 10n)
		await fixture.deposit(keeper, 1_000n * E)
		await expect(takeOver(id, commitment)).rejects.toThrow('Receiver commitment below minimum')
		expect(await fixture.position(id)).toMatchObject({ rep: required, commitment })
		expect((await fixture.owner(keeper)).positionId).toBe(0n)
	})

	// Three minimums backed for only 0.6 of one, with spare of two and a half: the uncovered 2.4
	// would leave 0.6. The cut shrinks to two minimums, so exactly the minimum is left, and that
	// remainder, still under water, is what the keeper takes over.
	test('a minimum residual requires additional capacity and cannot be seized', async () => {
		const commitment = 3n * MINIMUM
		const { id, required } = await underwater(commitment, 100n * E + MINIMUM / 2n, 5n * E)
		await fixture.deposit(keeper, 1_000n * E)
		await expect(takeOver(id, commitment)).rejects.toThrow('Position requires additional backing')
		expect(await fixture.position(id)).toMatchObject({ rep: required, commitment })
		expect((await fixture.owner(keeper)).positionId).toBe(0n)
	})

	// The minimum-rest rule protects a takeover, whose rest stays live. An owner's full exit
	// queues the rest for retirement instead, so its cure still removes the whole deficit.
	test('an owner leaving entirely is cured of the whole deficit even when the queued rest is below the minimum', async () => {
		const commitment = (3n * MINIMUM) / 2n
		const { id, supported } = await underwater(commitment, 100n * E + MINIMUM / 20n, (15n * E) / 2n)
		expect(supported).toBe(MINIMUM / 5n)

		await setCommitment(bob, 0n)
		// Spare of 1.45 minimums covers the deficit at the liquidation price. The backed remainder,
		// below the minimum, stays live only while it waits in the retirement queue.
		const remaining = (await fixture.position(id)).commitment
		expect(remaining).toBeGreaterThan(0n)
		expect(remaining).toBeLessThanOrEqual(supported)
		expect(await started(id)).toBe(0n)
	})

	// Design property, not a defect: between the liquidation price (accepted / (1 + error)) and
	// the conservative price (accepted / (1 - error)) a position is neither healthy capacity nor
	// in distress. It earns no fees, its share is burned, and only its owner can remove it.
	test('commitment inside the price error band earns no fees and cannot be cured or taken over', async () => {
		await fixture.fundOwners()
		await harnessWrite('setPriceError', 200_000n)
		await fixture.price(E)
		await fixture.deposit(alice, 300n * E)
		const a = await fixture.authorize(alice, 100n * E)
		// Bob posts exactly the admission requirement for the same commitment.
		const required = await admin().readContract({ ...fixture.capital, functionName: 'requiredRep', args: [100n * E, 10_000n] })
		await fixture.deposit(bob, required)
		const b = await fixture.authorize(bob, 100n * E)
		expect((await totals())[2]).toBe(200n * E)

		// REP weakens by 1%, well inside the 2% band on either side of the accepted price.
		await fixture.price((101n * E) / 100n)
		expect((await totals())[2]).toBe(100n * E)
		expect(await started(b)).toBe(0n)
		await fixture.deposit(keeper, 1_000n * E)
		await expect(takeOver(b, 100n * E)).rejects.toThrow('Adverse observation missing')

		// One ETH of fees vests over the reward duration while Bob stays in the band.
		const weth = await admin().readContract({ ...fixture.harness, functionName: 'collateralToken' })
		const burned = () => admin().readContract({ abi: wethArtifact.abi, address: weth, functionName: 'balanceOf', args: [addressString(BURN_ADDRESS)] })
		await writeContractAndWait(admin(), () => admin().writeContract({ ...fixture.harness, functionName: 'fundFees', value: E }))
		await fixture.getAnvilWindowEthereum().advanceTime(86_400n)
		await writeContractAndWait(admin(), () => admin().writeContract({ ...fixture.capital, functionName: 'checkpoint' }))
		const earnedByAlice = (await fixture.position(a)).ethFees
		const earnedByBob = (await fixture.position(b)).ethFees
		expect(earnedByBob).toBe(0n)
		// Alice receives her share of total commitment, not of healthy commitment: half is burned.
		expect(earnedByAlice).toBeGreaterThan((499n * E) / 1000n)
		expect(earnedByAlice).toBeLessThanOrEqual(E / 2n)
		const quarantined = await admin().readContract({ ...fixture.capital, functionName: 'pendingBurnCash' })
		expect(earnedByAlice + quarantined + (await burned())).toBe(E)
		await writeContractAndWait(admin(), () => admin().writeContract({ ...fixture.capital, functionName: 'flushBurn' }))
		expect(earnedByAlice + (await burned())).toBe(E)

		// Bob keeps every unit of principal: an unhealthy exit needs no spare and no keeper.
		await setCommitment(bob, 0n)
		await writeContractAndWait(fixture.client(bob), () => fixture.client(bob).writeContract({ ...fixture.capital, functionName: 'withdrawPrincipal', args: [required, fixture.client(bob).account.address] }))
		expect((await fixture.owner(bob)).freeAttoRep).toBe(0n)
	})
})
