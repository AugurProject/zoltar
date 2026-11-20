import { describe, expect, test } from 'bun:test'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { capitalUnit as E, useCapitalTestFixture } from './securityPoolCapitalTestFixture'

async function importOwners(fixture: ReturnType<typeof useCapitalTestFixture>, count: number, alternating: boolean, demand: bigint) {
	const sender = fixture.client()
	await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'beginImport' }))
	for (let start = 0; start < count; start += 8) await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'importChoices', args: [BigInt(start), 8n, alternating] }))
	await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'finishImport', args: [demand] }))
}

async function fundHistoricalFees(fixture: ReturnType<typeof useCapitalTestFixture>, count: number, alternating: boolean) {
	const sender = fixture.client()
	// Historical lazy fees and healthy observations cross both cohorts,
	// including expired and still-vesting streams at measurement time.
	for (let epoch = 0; epoch < 6; epoch++) {
		const clusterBoundary = (alternating ? 4n : 2n) * E + (BigInt(count) * 10n ** 12n) / (21n * BigInt(epoch + 1))
		await fixture.price(epoch % 2 === 0 ? E : clusterBoundary)
		await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'fundFees', value: BigInt(count) * E }))
		await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.harness, functionName: 'fundRepFees', args: [BigInt(count) * E] }))
		await fixture.getAnvilWindowEthereum().advanceTime(18_000n)
	}
}

// These measure production Ledger composition: stream checkpoint, three index
// registries, retirement, and the Ledger's collateral rekey of the boundary.
// An eightfold population increase may grow logarithmic paths; it is not O(1).
describe('Statoblast: production capital retirement gas', () => {
	const fixture = useCapitalTestFixture()
	for (const alternating of [false, true]) {
		test(`${alternating ? 'alternating health' : 'clustered health'} at 64 and 512 owners retains bounded production transaction gas`, async () => {
			const ethereum = fixture.getAnvilWindowEthereum()
			const sender = fixture.client()
			const baseline = await ethereum.anvilSnapshot()
			const measurements: { owners: number; checkpoint: bigint; preview: bigint; targeted: bigint }[] = []
			for (const count of [64, 512]) {
				if (count === 512) await ethereum.anvilRevert(baseline)
				await importOwners(fixture, count, alternating, BigInt(count) * 2n * E)
				await fundHistoricalFees(fixture, count, alternating)
				await fixture.price(2n * E)
				await ethereum.advanceTime(18_000n)
				const snapshot = await ethereum.anvilSnapshot()
				const checkpointHash = await writeContractAndWait(sender, () => sender.writeContract({ ...fixture.capital, functionName: 'checkpoint' }))
				const checkpoint = (await sender.waitForTransactionReceipt({ hash: checkpointHash })).gasUsed
				await ethereum.anvilRevert(snapshot)
				const before = await sender.readContract({ ...fixture.capital, functionName: 'totals' })
				const claimant = createWriteClient(ethereum, 0x1001n)
				await ethereum.impersonateAccount(claimant.account.address)
				await ethereum.setBalance(claimant.account.address, 10n * E)
				const price = await sender.readContract({ ...fixture.capital, functionName: 'conservativePrice' })
				const demand = await sender.readContract({ ...fixture.capital, functionName: 'demandAttoEth' })
				const preview = await sender.estimateContractGas({ ...fixture.commitments, functionName: 'previewRetirement', args: [2n, price, demand] })
				const targetedHash = await writeContractAndWait(claimant, () => claimant.writeContract({ ...fixture.capital, functionName: 'serveRetirement', args: [2n] }))
				const targeted = (await sender.waitForTransactionReceipt({ hash: targetedHash })).gasUsed
				const after = await sender.readContract({ ...fixture.capital, functionName: 'totals' })
				expect(before[1] - after[1]).toBe(10n * E)
				expect(after[0]).toBe(before[0])
				expect(await fixture.position(2n)).toMatchObject({ batch: 0n, commitment: 10n * E, remainingCommitment: 0n })
				for (const gas of [checkpoint, preview, targeted]) expect(gas).toBeLessThan(3_000_000n)
				measurements.push({ owners: count, checkpoint, preview, targeted })
			}
			const small = measurements[0]
			const large = measurements[1]
			if (small === undefined || large === undefined) throw new Error('Missing production gas populations')
			for (const operation of ['checkpoint', 'preview', 'targeted'] as const) expect(large[operation]).toBeLessThan(small[operation] * 3n + 250_000n)
			if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ productionLedgerGas: measurements, alternating })
		})
	}
})

describe('Statoblast: production bounded takeover gas', () => {
	const fixture = useCapitalTestFixture()
	for (const alternating of [false, true]) {
		test(`${alternating ? 'alternating health' : 'clustered health'} at 64 and 512 owners executes a fully funded takeover with estimated gas`, async () => {
			const ethereum = fixture.getAnvilWindowEthereum()
			const buyer = fixture.client(1)
			const baseline = await ethereum.anvilSnapshot()
			const measurements: { owners: number; estimate: bigint; used: bigint }[] = []
			for (const count of [64, 512]) {
				if (count === 512) await ethereum.anvilRevert(baseline)
				await importOwners(fixture, count, alternating, BigInt(count) * 20n * E)
				await fixture.fundOwners()
				await fixture.deposit(1, 100n * E)
				await writeContractAndWait(buyer, () => buyer.writeContract({ ...fixture.capital, functionName: 'setHealthTarget', args: [15_000n] }))
				await fundHistoricalFees(fixture, count, alternating)
				const price = (alternating ? 2n : 3n) * E
				await fixture.price(price)
				await ethereum.advanceTime(18_000n)
				const id = BigInt(count / 2 + 1)
				const source = await fixture.position(id)
				const owner = await fixture.owner(1)
				const before = await buyer.readContract({ ...fixture.capital, functionName: 'totals' })
				const demand = await buyer.readContract({ ...fixture.capital, functionName: 'demandAttoEth' })
				const epoch = await buyer.readContract({ ...fixture.capital, functionName: 'acceptedPriceEpoch' })
				const started = await buyer.readContract({ ...fixture.capital, functionName: 'liquidationStarted', args: [id] })
				// Match the bot's full-source path: no unused commitment to cure,
				// an empty funded receiver, matching target, and a fully earned award.
				expect(before[1]).toBe(demand)
				expect(owner).toMatchObject({ positionId: 0n, freeAttoRep: 100n * E, targetHealthFactorBps: 15_000n })
				expect(source.maxHealthyPrice).toBeLessThan(price)
				expect(started).toBeGreaterThan(0n)
				expect((await buyer.getBlock()).timestamp - started).toBeGreaterThanOrEqual(3600n)
				const request = {
					...fixture.capital,
					functionName: 'takeOverWithBounds',
					args: [id, source.commitment, 0n, owner.freeAttoRep, { maximumOwnerPrincipal: owner.freeAttoRep + source.rep, maximumOwnerCommitment: source.commitment, expectedTargetHealthFactorBps: owner.targetHealthFactorBps, expectedAcceptedPriceEpoch: epoch, expectedSourceBatch: source.batch }],
				} as const
				// Receipt gas includes storage refunds; only the upfront estimate is
				// suitable for the transaction's gas allowance and gas-cost screen.
				const estimate = await buyer.estimateContractGas(request)
				await buyer.simulateContract({ ...request, gas: estimate })
				const hash = await writeContractAndWait(buyer, () => buyer.writeContract({ ...request, gas: estimate }))
				const used = (await buyer.waitForTransactionReceipt({ hash })).gasUsed
				expect(estimate).toBeGreaterThan(used)
				// Keeping the source alive requires both source and receiver tree rekeys.
				// The bound also includes allocating the receiver’s immutable FIFO request across at most 65 sum slots.
				expect(estimate).toBeLessThan(5_500_000n)
				expect((await fixture.position(id)).rep).toBe(source.rep)
				expect((await fixture.position(id)).commitment).toBeGreaterThan(0n)
				const receiver = await fixture.owner(1)
				expect(receiver.freeAttoRep).toBe(0n)
				const repaired = await fixture.position(receiver.positionId)
				expect(repaired).toMatchObject({ owner: buyer.account.address, rep: owner.freeAttoRep, batch: source.batch })
				expect(repaired.commitment + (await fixture.position(id)).commitment).toBe(source.commitment)
				expect((await buyer.readContract({ ...fixture.capital, functionName: 'totals' }))[1]).toBe(demand)
				measurements.push({ owners: count, estimate, used })
			}
			const small = measurements[0]
			const large = measurements[1]
			if (small === undefined || large === undefined) throw new Error('Missing production takeover gas populations')
			expect(large.estimate).toBeLessThan(small.estimate * 3n + 250_000n)
			if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ productionTakeoverGas: measurements, alternating })
		})
	}
})
