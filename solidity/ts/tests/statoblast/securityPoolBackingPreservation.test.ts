import { describe, expect, test } from 'bun:test'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { capitalUnit as E, useCapitalTestFixture } from './securityPoolCapitalTestFixture'

describe('Statoblast: distress repair preserves pledged backing', () => {
	const f = useCapitalTestFixture()
	const prepare = async () => {
		await f.fundOwners()
		await f.deposit(0, 105n * E)
		const source = await f.authorize(0, 100n * E)
		await f.deposit(1, 105n * E)
		await f.authorize(1, 100n * E)
		await f.deposit(2, 500n * E)
		await writeContractAndWait(f.client(), () => f.client().writeContract({ ...f.harness, functionName: 'setDemand', args: [200n * E] }))
		await f.price(2n * E)
		await f.getAnvilWindowEthereum().advanceTime(1800n)
		return source
	}

	test('a full takeover request accounts for the pledged bonus while conserving custody', async () => {
		const source = await prepare()
		const before = await f.client().readContract({ ...f.capital, functionName: 'totals' })
		const keeper = f.client(2)
		await writeContractAndWait(keeper, () => keeper.writeContract({ ...f.capital, functionName: 'takeOver', args: [source, 100n * E, 0n, 500n * E] }))
		const after = await f.client().readContract({ ...f.capital, functionName: 'totals' })
		expect(after[0]).toBeGreaterThanOrEqual(before[0] + 500n * E)
		expect(after[1]).toBe(before[1])
		expect((await f.owner(0)).freeAttoRep).toBe(0n)
		const remaining = await f.position(source)
		const received = await f.position((await f.owner(2)).positionId)
		expect(remaining.rep + received.rep).toBe(605n * E)
		expect(remaining.commitment + received.commitment).toBe(100n * E)
		expect(remaining.maxHealthyPrice).toBeGreaterThanOrEqual(2n * E)
		expect(received.rep).toBeGreaterThan(500n * E)
	})

	test('a healthy receiver cannot withdraw pledged REP while other distress leaves demand underbacked', async () => {
		const source = await prepare()
		const keeper = f.client(2)
		await writeContractAndWait(keeper, () => keeper.writeContract({ ...f.capital, functionName: 'takeOver', args: [source, 100n * E, 0n, 500n * E] }))
		const before = await keeper.readContract({ ...f.capital, functionName: 'totals' })
		expect(before[2]).toBeLessThan(200n * E)
		await expect(writeContractAndWait(keeper, () => keeper.writeContract({ ...f.capital, functionName: 'withdrawPrincipal', args: [E, keeper.account.address] }))).rejects.toThrow('Portfolio backing insufficient')
		expect(await keeper.readContract({ ...f.capital, functionName: 'totals' })).toEqual(before)
	})
	test('#1343 and #1344 accepted adverse prices can transfer principal only into a backed vault', async () => {
		await f.fundOwners()
		await writeContractAndWait(f.client(), () => f.client().writeContract({ ...f.harness, functionName: 'setPriceError', args: [500_000n] }))
		await f.deposit(0, 210n * E)
		const source = await f.authorize(0, 100n * E)
		await f.deposit(2, 500n * E)
		await writeContractAndWait(f.client(), () => f.client().writeContract({ ...f.harness, functionName: 'setDemand', args: [100n * E] }))
		// Fair 2.08 stays inside the existing liquidation buffer. The +1.05%
		// report crosses it: auction ownership transfers remain oracle-dependent.
		await f.price((208n * E) / 100n)
		expect(await f.client().readContract({ ...f.capital, functionName: 'liquidationStarted', args: [source] })).toBe(0n)
		for (let observation = 0; observation < 5; observation++) {
			await f.price((210184n * E) / 100000n)
			await f.getAnvilWindowEthereum().advanceTime(780n)
		}
		const keeper = f.client(2)
		await writeContractAndWait(keeper, () => keeper.writeContract({ ...f.capital, functionName: 'takeOver', args: [source, 100n * E, 0n, 500n * E] }))
		expect((await f.position(source)).rep).toBe(0n)
		expect((await f.owner(0)).freeAttoRep).toBe(0n)
		expect((await f.position((await f.owner(2)).positionId)).rep).toBe(710n * E)
		await expect(writeContractAndWait(keeper, () => keeper.writeContract({ ...f.capital, functionName: 'takeOver', args: [source, E, 0n, 0n] }))).rejects.toThrow('Adverse observation missing')
	})

	test('an award request above the entire source principal fails atomically', async () => {
		const source = await prepare()
		await f.getAnvilWindowEthereum().advanceTime(3601n)
		const before = await f.position(source)
		await expect(writeContractAndWait(f.client(2), () => f.client(2).writeContract({ ...f.capital, functionName: 'takeOver', args: [source, 100n * E, 106n * E, 500n * E] }))).rejects.toThrow('Takeover award below minimum')
		expect(await f.position(source)).toEqual(before)
		expect((await f.owner(2)).freeAttoRep).toBe(500n * E)
	})

	test('receivers earn future fees and pledged bonus principal without acquiring past income', async () => {
		const source = await prepare()
		const keeper = f.client(2)
		await writeContractAndWait(keeper, () => keeper.writeContract({ ...f.capital, functionName: 'takeOver', args: [source, 100n * E, 0n, 500n * E] }))
		expect((await f.owner(2)).feesAttoEth).toBe(0n)
		await writeContractAndWait(f.client(), () => f.client().writeContract({ ...f.harness, functionName: 'fundFees', value: E }))
		const collateral = await keeper.readContract({ ...f.harness, functionName: 'collateralToken' })
		const before = await keeper.readContract({ abi: f.token.abi, address: collateral, functionName: 'balanceOf', args: [keeper.account.address] })
		await f.getAnvilWindowEthereum().advanceTime(86401n)
		await writeContractAndWait(keeper, () => keeper.writeContract({ ...f.capital, functionName: 'claimEarnings' }))
		expect(await keeper.readContract({ abi: f.token.abi, address: collateral, functionName: 'balanceOf', args: [keeper.account.address] })).toBeGreaterThan(before)
		await writeContractAndWait(f.client(), () => f.client().writeContract({ ...f.capital, functionName: 'claimEarnings' }))
		expect((await f.position(source)).rep + (await f.position((await f.owner(2)).positionId)).rep).toBe(605n * E)
		expect((await f.position((await f.owner(2)).positionId)).rep).toBeGreaterThan(500n * E)
	})

	test('a full request remains valid after a partial embedded cure and transfers only the residual deficit', async () => {
		const source = await prepare()
		await writeContractAndWait(f.client(), () => f.client().writeContract({ ...f.harness, functionName: 'setDemand', args: [190n * E] }))
		const keeper = f.client(2)
		await writeContractAndWait(keeper, () => keeper.writeContract({ ...f.capital, functionName: 'takeOver', args: [source, 100n * E, 0n, 500n * E] }))
		const remaining = await f.position(source)
		const received = await f.position((await f.owner(2)).positionId)
		expect(remaining.rep + received.rep).toBe(605n * E)
		expect(remaining.commitment + received.commitment).toBe(90n * E)
		expect(remaining.maxHealthyPrice).toBeGreaterThanOrEqual(2n * E)
		expect([...(await keeper.readContract({ ...f.capital, functionName: 'totals' }))]).toEqual([710n * E, 190n * E, 90n * E])
	})
})
