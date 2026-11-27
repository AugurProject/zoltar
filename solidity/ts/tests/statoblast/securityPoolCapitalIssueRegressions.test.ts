import { describe, expect, test } from 'bun:test'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { capitalUnit as E, useCapitalTestFixture } from './securityPoolCapitalTestFixture'

describe('capital issue regressions', () => {
	const f = useCapitalTestFixture()
	for (const pledged of [false, true]) {
		test(`#1738 rejects capital self-recipient with pledged=${pledged}`, async () => {
			await f.fundOwners()
			await f.deposit(0, 210n * E)
			if (pledged) await f.authorize(0, 100n * E)
			const before = await f.owner(0)
			await expect(writeContractAndWait(f.client(), () => f.client().writeContract({ ...f.capital, functionName: 'withdrawPrincipal', args: [E, f.capital.address] }))).rejects.toThrow('Invalid capital withdrawal')
			expect(await f.owner(0)).toEqual(before)
			await writeContractAndWait(f.client(), () => f.client().writeContract({ ...f.capital, functionName: 'withdrawPrincipal', args: [E, f.client().account.address] }))
		})
	}
	test('#1738 rejects earnings self-recipient', async () => {
		await f.fundOwners()
		await f.deposit(0, 210n * E)
		const id = await f.authorize(0, 100n * E)
		await writeContractAndWait(f.client(), () => f.client().writeContract({ ...f.harness, functionName: 'fundRepFees', args: [86_400n * E] }))
		await f.getAnvilWindowEthereum().advanceTime(100n)
		await writeContractAndWait(f.client(), () => f.client().writeContract({ ...f.capital, functionName: 'checkpoint' }))
		expect((await f.position(id)).repFees).toBeGreaterThan(0n)
		const before = await f.owner(0)
		await expect(writeContractAndWait(f.client(), () => f.client().writeContract({ ...f.capital, functionName: 'claimEarnings', args: [f.capital.address] }))).rejects.toThrow('Invalid earnings recipient')
		expect(await f.owner(0)).toEqual(before)
		await writeContractAndWait(f.client(), () => f.client().writeContract({ ...f.capital, functionName: 'claimEarnings', args: [f.client().account.address] }))
	})
	const setup = async (small = false) => {
		await f.fundOwners()
		await f.deposit(0, small ? 105n * 10n ** 13n : 105n * E)
		const id = await f.authorize(0, small ? 10n ** 15n : 100n * E)
		await f.deposit(1, 105n * E)
		await f.authorize(1, 100n * E)
		await writeContractAndWait(f.client(), () => f.client().writeContract({ ...f.harness, functionName: 'setDemand', args: [small ? 100n * E : 150n * E] }))
		return id
	}
	for (const { offset, amount } of [
		{ offset: 0, amount: 100n },
		{ offset: 1, amount: 100n },
		{ offset: 0, amount: 50n },
	])
		test(`#1245 takeover preserves a successful embedded cure for owner ${offset} amount ${amount}`, async () => {
			await setup()
			const id = (await f.owner(offset)).positionId
			await f.price(2n * E)
			await f.getAnvilWindowEthereum().advanceTime(3601n)
			await writeContractAndWait(f.client(2), () => f.client(2).writeContract({ ...f.capital, functionName: 'takeOver', args: [id, amount * E, 0n, 0n] }))
			expect((await f.position(id)).commitment).toBe(50n * E)
			expect((await f.position(id)).rep).toBe(105n * E)
			expect((await f.owner(2)).positionId).toBe(0n)
		})
	test('a positive minimum reward rejects an unpaid cure atomically', async () => {
		const id = await setup()
		await f.price(2n * E)
		await f.getAnvilWindowEthereum().advanceTime(3601n)
		const before = await f.position(id)
		await expect(writeContractAndWait(f.client(2), () => f.client(2).writeContract({ ...f.capital, functionName: 'takeOver', args: [id, 100n * E, 1n, 0n] }))).rejects.toThrow('Takeover reward below minimum')
		expect(await f.position(id)).toEqual(before)
		expect((await f.owner(2)).positionId).toBe(0n)
	})
	test('#1254 a minimum position cannot release backed REP through a cure', async () => {
		const id = await setup(true)
		await f.price((12n * E) / 10n)
		await writeContractAndWait(f.client(), () => f.client().writeContract({ ...f.capital, functionName: 'setCommitment', args: [0n] }))
		expect((await f.owner(0)).freeAttoRep).toBe(0n)
		expect((await f.position(id)).rep).toBe(105n * 10n ** 13n)
	})
	test('#1253 renewal resets eligibility history while retaining wall-clock auction age', async () => {
		const id = await setup()
		await writeContractAndWait(f.client(), () => f.client().writeContract({ ...f.harness, functionName: 'setDemand', args: [200n * E] }))
		await writeContractAndWait(f.client(), async () => f.client().writeContract({ ...f.harness, functionName: 'setPrice', args: [2n * E, Number((await f.client().getBlock()).timestamp + 60n)] }))
		await f.getAnvilWindowEthereum().advanceTime(7200n)
		await f.price(2n * E)
		const started = await f.client().readContract({ ...f.capital, functionName: 'liquidationStarted', args: [id] })
		expect((await f.client().getBlock()).timestamp - started).toBeLessThan(60n)
		await f.deposit(2, 210n * E)
		expect(await f.client().readContract({ ...f.capital, functionName: 'liquidationElapsed', args: [id] })).toBeGreaterThanOrEqual(7200n)
		await writeContractAndWait(f.client(2), () => f.client(2).writeContract({ ...f.capital, functionName: 'takeOver', args: [id, 100n * E, 105n * E, 210n * E] }))
		expect((await f.position(id)).rep).toBe(0n)
		expect((await f.position((await f.owner(2)).positionId)).rep).toBe(315n * E)
	})
})
