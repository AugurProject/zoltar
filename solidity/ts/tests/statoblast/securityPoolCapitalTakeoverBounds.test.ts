import { describe, expect, test } from 'bun:test'
import { parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { capitalUnit as E, useCapitalTestFixture } from './securityPoolCapitalTestFixture'

const boundedAbi = parseAbi(['function takeOverWithBounds(uint96 id,uint256 commitment,uint256 minimumAward,uint256 maximumOwnRep,(uint256 maximumOwnerPrincipal,uint256 maximumOwnerCommitment,uint256 expectedTargetHealthFactorBps,uint256 expectedAcceptedPriceEpoch,uint96 expectedSourceBatch) bounds) returns(uint96)'])

describe('Statoblast: takeover owner consent bounds', () => {
	const fixture = useCapitalTestFixture()
	const prepare = async (receiverCommitment = 0n) => {
		await fixture.fundOwners()
		await fixture.deposit(0, 105n * E)
		await fixture.deposit(1, 500n * E)
		const source = await fixture.authorize(0, 100n * E)
		if (receiverCommitment !== 0n) await fixture.authorize(1, receiverCommitment)
		await writeContractAndWait(fixture.client(), () => fixture.client().writeContract({ ...fixture.harness, functionName: 'setDemand', args: [100n * E + receiverCommitment] }))
		await fixture.price(2n * E)
		await fixture.getAnvilWindowEthereum().advanceTime(3601n)
		const epoch = await fixture.client().readContract({ ...fixture.capital, functionName: 'acceptedPriceEpoch' })
		return { source, bounds: { maximumOwnerPrincipal: (5525n * E) / 10n, maximumOwnerCommitment: receiverCommitment + 50n * E, expectedTargetHealthFactorBps: 10_000n, expectedAcceptedPriceEpoch: epoch, expectedSourceBatch: 0n } }
	}
	test('a bounded takeover accepts the exact final principal and commitment consent', async () => {
		const { source, bounds } = await prepare()
		const buyer = fixture.client(1)
		await writeContractAndWait(buyer, () => buyer.writeContract({ abi: boundedAbi, address: fixture.capital.address, functionName: 'takeOverWithBounds', args: [source, 50n * E, 1n, 500n * E, bounds] }))
		expect(await fixture.position((await fixture.owner(1)).positionId)).toMatchObject({ rep: bounds.maximumOwnerPrincipal, commitment: bounds.maximumOwnerCommitment })
		expect(await fixture.position(source)).toMatchObject({ rep: (525n * E) / 10n, commitment: 50n * E })
	})
	test('an existing receiver must consent to its entire resulting position, including previous principal and commitment', async () => {
		const { source, bounds } = await prepare(100n * E)
		const buyer = fixture.client(1)
		const call = (maximumOwnerPrincipal: bigint, maximumOwnerCommitment: bigint) =>
			writeContractAndWait(buyer, () => buyer.writeContract({ abi: boundedAbi, address: fixture.capital.address, functionName: 'takeOverWithBounds', args: [source, 50n * E, 1n, 0n, { ...bounds, maximumOwnerPrincipal, maximumOwnerCommitment }] }))
		await expect(call((525n * E) / 10n, bounds.maximumOwnerCommitment)).rejects.toThrow('Takeover owner principal exceeds limit')
		await expect(call(bounds.maximumOwnerPrincipal, 50n * E)).rejects.toThrow('Takeover owner commitment exceeds limit')
		expect(await fixture.position((await fixture.owner(1)).positionId)).toMatchObject({ rep: 500n * E, commitment: 100n * E })
		await call(bounds.maximumOwnerPrincipal, bounds.maximumOwnerCommitment)
		expect(await fixture.position((await fixture.owner(1)).positionId)).toMatchObject({ rep: bounds.maximumOwnerPrincipal, commitment: 150n * E })
	})
	test('a same-owner deposit after the quote cannot bypass the fixed final principal cap by raising the idle-funds allowance', async () => {
		const { source, bounds } = await prepare()
		const buyer = fixture.client(1)
		await fixture.deposit(1, E)
		const previous = await fixture.owner(1)
		await expect(writeContractAndWait(buyer, () => buyer.writeContract({ abi: boundedAbi, address: fixture.capital.address, functionName: 'takeOverWithBounds', args: [source, 50n * E, 1n, 501n * E, bounds] }))).rejects.toThrow('Takeover owner principal exceeds limit')
		expect(await fixture.owner(1)).toEqual(previous)
		expect(await fixture.position(source)).toMatchObject({ rep: 105n * E, commitment: 100n * E })
	})

	for (const mutation of ['principal', 'commitment', 'target', 'price', 'cohort'] as const) {
		test(`a changed ${mutation} bound reverts atomically without consuming principal or changing obligations`, async () => {
			const { source, bounds } = await prepare()
			const buyer = fixture.client(1)
			if (mutation === 'principal') bounds.maximumOwnerPrincipal--
			if (mutation === 'commitment') bounds.maximumOwnerCommitment--
			if (mutation === 'target') await writeContractAndWait(buyer, () => buyer.writeContract({ ...fixture.capital, functionName: 'setHealthTarget', args: [12_000n] }))
			if (mutation === 'price') await fixture.price(2n * E)
			if (mutation === 'cohort') await writeContractAndWait(fixture.client(), () => fixture.client().writeContract({ ...fixture.capital, functionName: 'requestRetirement', args: [source, 60n * E] }))
			const previous = {
				source: await fixture.position(source),
				buyer: await fixture.owner(1),
				balance: await buyer.readContract({ ...fixture.token, functionName: 'balanceOf', args: [fixture.capital.address] }),
			}
			const reason = { principal: 'Takeover owner principal exceeds limit', commitment: 'Takeover owner commitment exceeds limit', target: 'Takeover owner target changed', price: 'Takeover price epoch changed', cohort: 'Takeover source cohort changed' }[mutation]
			await expect(writeContractAndWait(buyer, () => buyer.writeContract({ abi: boundedAbi, address: fixture.capital.address, functionName: 'takeOverWithBounds', args: [source, 50n * E, 1n, 500n * E, bounds] }))).rejects.toThrow(reason)
			expect(await fixture.position(source)).toEqual(previous.source)
			expect(await fixture.owner(1)).toEqual(previous.buyer)
			expect(await buyer.readContract({ ...fixture.token, functionName: 'balanceOf', args: [fixture.capital.address] })).toBe(previous.balance)
		})
	}
})
