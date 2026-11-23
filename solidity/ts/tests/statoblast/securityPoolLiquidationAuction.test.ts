import { describe, expect, test } from 'bun:test'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { capitalUnit as E, useCapitalTestFixture } from './securityPoolCapitalTestFixture'

describe('Statoblast: one-hour liquidation auction', () => {
	const f = useCapitalTestFixture()
	const prepare = async () => {
		await f.fundOwners()
		await f.deposit(0, 105n * E)
		const source = await f.authorize(0, 100n * E)
		await f.deposit(2, 105n * E)
		await writeContractAndWait(f.client(), () => f.client().writeContract({ ...f.harness, functionName: 'setDemand', args: [100n * E] }))
		await f.price(2n * E)
		return source
	}
	const take = (source: bigint, commitment: bigint, minimumAward: bigint) => writeContractAndWait(f.client(2), () => f.client(2).writeContract({ ...f.capital, functionName: 'takeOver', args: [source, commitment, minimumAward, 105n * E + 10n] }))

	test('at one hour the entire principal and commitment move to the funded receiver vault, with no wallet payout', async () => {
		const source = await prepare()
		await f.getAnvilWindowEthereum().advanceTime(3601n)
		const wallet = await f.client().readContract({ ...f.token, functionName: 'balanceOf', args: [f.client(2).account.address] })
		const custody = await f.client().readContract({ ...f.token, functionName: 'balanceOf', args: [f.capital.address] })
		await take(source, 100n * E, 105n * E)
		expect(await f.position(source)).toMatchObject({ rep: 0n, commitment: 0n })
		expect(await f.position((await f.owner(2)).positionId)).toMatchObject({ rep: 210n * E, commitment: 100n * E })
		expect((await f.owner(2)).freeAttoRep).toBe(0n)
		expect(await f.client().readContract({ ...f.token, functionName: 'balanceOf', args: [f.client(2).account.address] })).toBe(wallet)
		expect(await f.client().readContract({ ...f.token, functionName: 'balanceOf', args: [f.capital.address] })).toBe(custody)
		await expect(writeContractAndWait(f.client(2), () => f.client(2).writeContract({ ...f.capital, functionName: 'withdrawPrincipal', args: [E, f.client(2).account.address] }))).rejects.toThrow('Owner collateral too low')
	})

	test('maximum terms remain available after an hour instead of expiring', async () => {
		const source = await prepare()
		await f.getAnvilWindowEthereum().advanceTime(7n * 86400n)
		await take(source, 100n * E, 105n * E)
		expect(await f.position((await f.owner(2)).positionId)).toMatchObject({ rep: 210n * E, commitment: 100n * E })
	})

	test('a receiver cannot take an award without enough backing for the resulting commitment', async () => {
		const source = await prepare()
		await f.getAnvilWindowEthereum().advanceTime(3601n)
		const before = await f.position(source)
		await expect(writeContractAndWait(f.client(1), () => f.client(1).writeContract({ ...f.capital, functionName: 'takeOver', args: [source, 100n * E, 105n * E, 0n] }))).rejects.toThrow('Receiver collateral insufficient')
		expect(await f.position(source)).toEqual(before)
	})

	test('partial fills cannot repeatedly collect the same half-hour vested principal', async () => {
		const source = await prepare()
		await f.deposit(2, 10n)
		await f.getAnvilWindowEthereum().advanceTime(1800n)
		for (const amount of [25n * E, 10n * E]) {
			await take(source, amount, 0n)
			const current = await f.position(source)
			const paid = await f.client().readContract({ ...f.capital, functionName: 'liquidationAwarded', args: [source] })
			const started = await f.client().readContract({ ...f.capital, functionName: 'liquidationStarted', args: [source] })
			const elapsed = (await f.client().getBlock()).timestamp - started
			expect(paid).toBe(105n * E - current.rep)
			expect(paid).toBeLessThanOrEqual((105n * E * elapsed) / 3600n)
			expect(current.rep + (await f.position((await f.owner(2)).positionId)).rep).toBe(210n * E + 10n)
		}
		const remainder = await f.position(source)
		await take(source, remainder.commitment, 0n)
		const healed = await f.position(source)
		expect(healed.maxHealthyPrice).toBeGreaterThanOrEqual(2n * E)
	})

	test('stale reports cannot age directly into a maximum award after renewal', async () => {
		const source = await prepare()
		await writeContractAndWait(f.client(), async () => f.client().writeContract({ ...f.harness, functionName: 'setPrice', args: [2n * E, Number((await f.client().getBlock()).timestamp + 60n)] }))
		await f.getAnvilWindowEthereum().advanceTime(7200n)
		await expect(take(source, 100n * E, 0n)).rejects.toThrow('Capital price stale')
		await f.price(2n * E)
		await expect(take(source, 100n * E, 105n * E)).rejects.toThrow('Takeover award below minimum')
		await f.getAnvilWindowEthereum().advanceTime(3601n)
		await take(source, 100n * E, 105n * E)
	})

	test('stale gaps pause both vested time and prior partial awards until a fresh observation', async () => {
		const source = await prepare()
		await f.deposit(2, 10n)
		await writeContractAndWait(f.client(), async () => f.client().writeContract({ ...f.harness, functionName: 'setPrice', args: [2n * E, Number((await f.client().getBlock()).timestamp + 1800n)] }))
		await f.getAnvilWindowEthereum().advanceTime(900n)
		await take(source, 25n * E, 0n)
		const paid = await f.client().readContract({ ...f.capital, functionName: 'liquidationAwarded', args: [source] })
		await f.getAnvilWindowEthereum().advanceTime(1000n)
		const paused = await f.client().readContract({ ...f.capital, functionName: 'liquidationElapsed', args: [source] })
		await f.getAnvilWindowEthereum().advanceTime(7200n)
		expect(await f.client().readContract({ ...f.capital, functionName: 'liquidationElapsed', args: [source] })).toBe(paused)
		await f.price(2n * E)
		const resumed = await f.client().readContract({ ...f.capital, functionName: 'liquidationElapsed', args: [source] })
		expect(resumed).toBeGreaterThanOrEqual(paused)
		expect(resumed).toBeLessThan(paused + 10n)
		expect(await f.client().readContract({ ...f.capital, functionName: 'liquidationAwarded', args: [source] })).toBe(paid)
	})
})
