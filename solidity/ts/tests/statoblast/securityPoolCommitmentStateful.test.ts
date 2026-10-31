import { beforeAll, describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact, test_statoblast_CommitmentIndexHarness_CommitmentIndexHarness as harnessArtifact } from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

type Position = { id: bigint; rep: bigint; commitment: bigint; price: bigint; batch: bigint; remaining: bigint; released: bigint; paid: bigint; eth: bigint; repFees: bigint; paidEth: bigint; paidRep: bigint }
const sum = (positions: Position[], value: (position: Position) => bigint) => positions.reduce((total, position) => total + value(position), 0n)
const priority = (a: Position, b: Position) => {
	if (a.batch !== b.batch) return a.batch < b.batch ? -1 : 1
	if (a.price !== b.price) return a.price > b.price ? -1 : 1
	return a.id > b.id ? -1 : 1
}

// The oracle is a flat owner list. It has no nodes, rotations, lazy fee tags,
// subtree aggregates, or production preview calls. Exact divisible fee budgets
// isolate entitlement errors from the tree's intentionally flexible rounding.
describe('Statoblast: replayable mixed retirement reference model', () => {
	const node = useIsolatedAnvilNode()
	let client: WriteClient
	let harness: Address
	let index: Address
	beforeAll(async () => {
		await setupTestAccounts(node.getAnvilWindowEthereum())
		client = createWriteClient(node.getAnvilWindowEthereum(), TEST_ADDRESSES[0])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: `0x${harnessArtifact.evm.bytecode.object}` }) })
		if (receipt.contractAddress === undefined) throw new Error('Commitment model harness missing')
		harness = receipt.contractAddress
		index = await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'index' })
		await node.setBaselineSnapshot()
	})
	const configuredSeed = process.env['CAPITAL_MODEL_SEED']
	const seeds = configuredSeed === undefined ? [19n, 0x1164n, 0xc0ffeen] : [BigInt(configuredSeed)]
	for (const initialSeed of seeds) {
		test(`mixed actions preserve independent owner accounting and priority (seed ${initialSeed})`, async () => {
			let seed = initialSeed
			const random = (maximum: bigint) => {
				seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n)
				return seed % maximum
			}
			const entries: Position[] = []
			const trace: string[] = []
			let current = 0n
			let next = 1n
			let price = 5n
			let principal = 0n
			let fundedEth = 0n
			let fundedRep = 0n
			let serviceEth = 0n
			let serviceRep = 0n
			const live = () => entries.filter(entry => entry.commitment !== 0n)
			const healthy = () => live().filter(entry => entry.price >= price)
			const queued = () =>
				live()
					.filter(entry => entry.batch !== 0n)
					.sort(priority)
			const pick = (values: Position[]) => (values.length === 0 ? undefined : values[Number(random(BigInt(values.length)))])
			const promote = () => {
				if (live().some(entry => entry.batch === current && current !== 0n)) return
				current = 0n
				if (live().some(entry => entry.batch === next)) {
					current = next
					next++
				}
			}
			const reduce = (entry: Position, amount: bigint) => {
				entry.commitment -= amount
				if (entry.commitment === 0n) {
					entry.released += entry.rep
					entry.rep = 0n
				} else if (entry.remaining !== 0n && entry.commitment === entry.remaining) {
					entry.remaining = 0n
					entry.batch = 0n
				}
			}
			const serve = (demand: bigint, target?: Position) => {
				if (target !== undefined) promote()
				const eligible = sum(healthy(), entry => entry.commitment)
				if (eligible < demand) return
				let available = eligible - demand
				if (target !== undefined) {
					const ahead = sum(
						queued().filter(entry => entry.id !== target.id && entry.price >= price && (entry.batch < target.batch || (entry.batch === target.batch && priority(entry, target) < 0))),
						entry => entry.commitment - entry.remaining,
					)
					const reduction = target.commitment - target.remaining
					if (available >= ahead + (target.price >= price ? reduction : 0n)) reduce(target, reduction)
					return
				}
				for (let group = 0; group < 2; group++) {
					promote()
					if (current === 0n) return
					const cohort = queued().filter(entry => entry.batch === current)
					const canReleaseUnhealthy =
						available >=
						sum(
							cohort.filter(entry => entry.price >= price),
							entry => entry.commitment,
						)
					for (const entry of cohort) {
						const reduction = entry.commitment - entry.remaining
						const amount = canReleaseUnhealthy || available >= reduction ? reduction : available
						if (amount === 0n) return
						const boundary = entry.remaining !== 0n || amount < entry.commitment
						if (entry.price >= price) available -= amount
						reduce(entry, amount)
						if (boundary) return
					}
					current = 0n
				}
			}
			const check = async () => {
				const actual = await Promise.all(entries.map(entry => client.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [entry.id] })))
				for (let i = 0; i < entries.length; i++) {
					const entry = entries[i]
					const state = actual[i]
					if (entry === undefined || state === undefined) throw new Error('Model entry missing')
					expect(state).toMatchObject({ rep: entry.rep, commitment: entry.commitment, releasedRep: entry.released, ethFees: entry.eth, repFees: entry.repFees })
					if (entry.commitment !== 0n) expect(state).toMatchObject({ batch: entry.batch, maxHealthyPrice: entry.price, remainingCommitment: entry.remaining })
				}
				expect([...(await client.readContract({ abi: indexArtifact.abi, address: index, functionName: 'totals' }))]).toEqual([sum(live(), entry => entry.rep), sum(live(), entry => entry.commitment)])
				expect(await client.readContract({ abi: indexArtifact.abi, address: index, functionName: 'eligibleCommitment', args: [price] })).toBe(sum(healthy(), entry => entry.commitment))
				const retained = sum(healthy(), entry => (entry.batch === 0n ? entry.commitment : entry.remaining))
				expect(await client.readContract({ abi: indexArtifact.abi, address: index, functionName: 'eligibleActiveCommitment', args: [price] })).toBe(retained)
				expect(sum(entries, entry => entry.rep + entry.released + entry.paid)).toBe(principal)
				expect(sum(entries, entry => entry.eth + entry.paidEth) + serviceEth).toBe(fundedEth)
				expect(sum(entries, entry => entry.repFees + entry.paidRep) + serviceRep).toBe(fundedRep)
				expect(await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'unassignedEth' })).toBe(serviceEth)
				expect(await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'unassignedRep' })).toBe(serviceRep)
				await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'validateAll' })
			}
			try {
				for (let step = 0; step < 100; step++) {
					const operation = step < 12 ? 0 : step % 10
					if (operation === 0 || live().length === 0) {
						const commitment = random(20n) + 2n
						const rep = commitment * (random(7n) + 1n)
						const threshold = random(12n) + 1n
						const id = BigInt(entries.length + 1)
						trace.push(`${step}:create(${id},${rep},${commitment},${threshold})`)
						await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'create', args: [addressString(0x1000n + id), rep, commitment, threshold] }))
						entries.push({ id, rep, commitment, price: threshold, batch: 0n, remaining: 0n, released: 0n, paid: 0n, eth: 0n, repFees: 0n, paidEth: 0n, paidRep: 0n })
						principal += rep
					} else if (operation === 1) {
						price = random(12n) + 1n
						trace.push(`${step}:price(${price})`)
						await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'observeHealthy', args: [price] }))
					} else if (operation === 2 || operation === 3) {
						const entry = pick(live().filter(entry => entry.batch === 0n))
						if (entry !== undefined) {
							entry.remaining = operation === 2 ? entry.commitment / 2n : 0n
							entry.batch = next
							trace.push(`${step}:request(${entry.id},${entry.remaining})`)
							await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'requestPartial', args: [entry.id, entry.remaining] }))
						}
					} else if (operation === 4) {
						const entry = pick(queued())
						if (entry !== undefined) {
							trace.push(`${step}:cancel(${entry.id})`)
							await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'cancel', args: [entry.id] }))
							entry.batch = 0n
							entry.remaining = 0n
						}
					} else if (operation === 5 || operation === 6) {
						const demand = random(sum(healthy(), entry => entry.commitment) + 2n)
						const target = operation === 6 ? pick(queued()) : undefined
						trace.push(`${step}:serve(${price},${demand},${target?.id ?? 0n})`)
						if (target !== undefined) {
							const eligible = sum(healthy(), entry => entry.commitment)
							const spare = eligible > demand ? eligible - demand : 0n
							const ahead = sum(
								queued().filter(entry => entry.id !== target.id && entry.price >= price && (entry.batch < target.batch || (entry.batch === target.batch && priority(entry, target) < 0))),
								entry => entry.commitment - entry.remaining,
							)
							const reduction = target.commitment - target.remaining
							let status = 5n
							if (eligible < demand) status = 2n
							else if (spare < ahead) status = 3n
							else if (target.price >= price && spare - ahead < reduction) status = 4n
							expect(await client.readContract({ abi: indexArtifact.abi, address: index, functionName: 'previewRetirement', args: [target.id, price, demand] })).toMatchObject({
								status,
								healthyCommitment: eligible,
								spareCommitment: spare,
								queuedAheadCommitment: ahead,
								commitmentReduction: reduction,
								releasedRep: target.remaining === 0n ? target.rep : 0n,
							})
						}
						if (target === undefined) await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'retire', args: [price, demand] }))
						else await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'retirePosition', args: [target.id, price, demand] }))
						serve(demand, target)
					} else if (operation === 7) {
						const ethRate = random(5n) + 1n
						const repRate = random(5n) + 1n
						const total = sum(live(), entry => entry.commitment)
						trace.push(`${step}:fees(${price},${total * ethRate},${total * repRate})`)
						await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'creditProportional', args: [price, total * ethRate, total * repRate] }))
						fundedEth += total * ethRate
						fundedRep += total * repRate
						for (const entry of live()) {
							if (entry.price >= price) {
								entry.eth += entry.commitment * ethRate
								entry.repFees += entry.commitment * repRate
							} else {
								serviceEth += entry.commitment * ethRate
								serviceRep += entry.commitment * repRate
							}
						}
					} else if (operation === 8) {
						const entry = pick(live())
						if (entry === undefined) throw new Error('Live rekey absent')
						entry.price = random(12n) + 1n
						const added = random(17n)
						entry.rep += added
						principal += added
						trace.push(`${step}:rekey(${entry.id},${entry.rep},${entry.price})`)
						await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'replace', args: [entry.id, entry.rep, entry.commitment, entry.price] }))
					} else {
						const entry = pick(entries)
						if (entry === undefined) throw new Error('Claim owner absent')
						trace.push(`${step}:claim(${entry.id})`)
						await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'claim', args: [entry.id] }))
						entry.paid += entry.released
						entry.released = 0n
						entry.paidEth += entry.eth
						entry.eth = 0n
						entry.paidRep += entry.repFees
						entry.repFees = 0n
						for (const [functionName, expected] of [
							['paidRep', entry.paid],
							['paidEthFees', entry.paidEth],
							['paidRepFees', entry.paidRep],
						] as const)
							expect(await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName, args: [entry.id] })).toBe(expected)
					}
					await check()
				}
			} catch (cause) {
				throw new Error(`Replay CAPITAL_MODEL_SEED=${initialSeed}\n${trace.join('\n')}`, { cause })
			}
		})
	}
})
