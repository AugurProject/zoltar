import { beforeAll, describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as artifact, test_statoblast_CommitmentIndexHarness_CommitmentIndexHarness as harnessArtifact } from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

const owner = (id: number) => addressString(BigInt(id) + 0x1000n)

describe('Statoblast: exact shared commitment and retirement index', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	let harness: Address
	const account = (id: bigint) => client.readContract({ abi: artifact.abi, address, functionName: 'accountOf', args: [id] })
	const eligible = (price: bigint) => client.readContract({ abi: artifact.abi, address, functionName: 'eligibleCommitment', args: [price] })
	const totals = async () => [...(await client.readContract({ abi: artifact.abi, address, functionName: 'totals' }))]
	const validate = () => client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'validateAll' })
	const create = async (rep: bigint, commitment: bigint, price: bigint, holder = owner(1)) => {
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'create', args: [holder, rep, commitment, price] }))
		return client.readContract({ abi: artifact.abi, address, functionName: 'lastPositionId' })
	}
	const replace = (id: bigint, rep: bigint, commitment: bigint, price: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'replace', args: [id, rep, commitment, price] }))
	const request = (id: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'request', args: [id] }))
	const cancel = (id: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'cancel', args: [id] }))
	const observe = (price: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'observeHealthy', args: [price] }))
	const healthEpoch = (id: bigint) => client.readContract({ abi: artifact.abi, address, functionName: 'healthEpoch', args: [id] })
	const credit = (price: bigint, eth: bigint, rep: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'credit', args: [price, eth, rep] }))
	const retire = (price: bigint, demand: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'retire', args: [price, demand] }))
	const claim = (id: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'claim', args: [id] }))
	const split = async (id: bigint, rep: bigint, commitment: bigint, oldPrice: bigint, newPrice: bigint) => {
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'split', args: [id, owner(2), rep, commitment, oldPrice, newPrice] }))
		return client.readContract({ abi: artifact.abi, address, functionName: 'lastPositionId' })
	}
	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: `0x${harnessArtifact.evm.bytecode.object}` }) })
		if (receipt.contractAddress === undefined) throw new Error('Commitment harness deployment address missing')
		harness = receipt.contractAddress
		address = await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'index' })
		await setBaselineSnapshot()
	})

	test('exact boundary prices, identical thresholds and full-width keys select only healthy commitments', async () => {
		const maximum = 2n ** 256n - 1n
		await create(5n, 5n, 0n)
		await create(11n, 11n, 10n)
		await create(17n, 17n, 10n)
		await create(23n, 23n, maximum)
		expect(await totals()).toEqual([56n, 56n])
		expect(await eligible(0n)).toBe(56n)
		expect(await eligible(1n)).toBe(51n)
		expect(await eligible(10n)).toBe(51n)
		expect(await eligible(11n)).toBe(23n)
		expect(await eligible(maximum)).toBe(23n)
		await replace(2n, 11n, 11n, maximum)
		await replace(3n, 0n, 0n, 0n)
		expect(await eligible(10n)).toBe(34n)
		expect(await eligible(maximum)).toBe(34n)
		expect(await totals()).toEqual([39n, 39n])
	})

	test('historical dual-token fees never enter new positions or move to takeover receivers', async () => {
		await create(100n, 10n, 20n)
		await create(200n, 20n, 10n)
		await credit(15n, 70n, 110n)
		await create(400n, 40n, 20n)
		await credit(15n, 150n, 250n)
		expect(await account(1n)).toMatchObject({ ethFees: 100n, repFees: 160n })
		expect(await account(2n)).toMatchObject({ ethFees: 0n, repFees: 0n })
		expect(await account(3n)).toMatchObject({ ethFees: 120n, repFees: 200n })
		const receiver = await split(1n, 50n, 5n, 20n, 20n)
		expect(await account(1n)).toMatchObject({ rep: 50n, commitment: 5n, ethFees: 100n, repFees: 160n })
		expect(await account(receiver)).toMatchObject({ rep: 50n, commitment: 5n, ethFees: 0n, repFees: 0n })
		await credit(15n, 100n, 50n)
		expect(await account(1n)).toMatchObject({ ethFees: 110n, repFees: 165n })
		expect(await account(receiver)).toMatchObject({ ethFees: 10n, repFees: 5n })
		await claim(1n)
		expect(await account(1n)).toMatchObject({ rep: 50n, commitment: 5n, ethFees: 0n, repFees: 0n })
		await claim(1n)
		expect(await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'paidEthFees', args: [1n] })).toBe(110n)
	})

	test('retirement closes exact subtrees, retains deferred fees and releases only healthy spare capacity', async () => {
		await create(100n, 10n, 30n)
		await create(200n, 20n, 20n)
		await create(300n, 30n, 5n)
		for (const id of [1n, 2n, 3n]) await request(id)
		expect(await client.readContract({ abi: artifact.abi, address, functionName: 'eligibleActiveCommitment', args: [10n] })).toBe(0n)
		expect(await eligible(10n)).toBe(30n)
		await credit(0n, 120n, 180n)
		await retire(10n, 25n)
		expect(await totals()).toEqual([550n, 55n])
		expect(await eligible(10n)).toBe(25n)
		expect(await account(1n)).toMatchObject({ rep: 50n, commitment: 5n, releasedRep: 50n, ethFees: 20n, repFees: 30n })
		await retire(10n, 26n)
		expect(await totals()).toEqual([550n, 55n])
		await retire(10n, 0n)
		expect(await totals()).toEqual([0n, 0n])
		let rep = 0n
		let eth = 0n
		let repFees = 0n
		for (const id of [3n, 1n, 2n]) {
			const before = await account(id)
			expect(before.commitment).toBe(0n)
			rep += before.releasedRep
			eth += before.ethFees
			repFees += before.repFees
			await claim(id)
			expect(await account(id)).toMatchObject({ releasedRep: 0n, ethFees: 0n, repFees: 0n })
		}
		expect([rep, eth, repFees]).toEqual([600n, 120n, 180n])
	})

	test('recycled capital cannot refill the closed cohort or jump its residual commitment', async () => {
		await create(100n, 10n, 30n)
		await create(100n, 10n, 20n)
		await request(1n)
		await request(2n)
		await retire(10n, 15n)
		const originalBatch = (await account(1n)).batch
		await expect(replace(1n, 100n, 10n, 30n)).rejects.toThrow('Closed retirement commitment cannot increase')
		await create(500n, 5n, 100n)
		await request(3n)
		expect((await account(3n)).batch).not.toBe(originalBatch)
		await retire(10n, 15n)
		expect(await account(1n)).toMatchObject({ commitment: 0n, releasedRep: 100n })
		expect(await account(2n)).toMatchObject({ commitment: 10n })
		expect(await account(3n)).toMatchObject({ commitment: 5n })
		const receiver = await split(2n, 50n, 5n, 20n, 90n)
		expect((await account(receiver)).batch).toBe(originalBatch)
		await create(500n, 5n, 100n)
		await retire(10n, 15n)
		expect(await account(receiver)).toMatchObject({ commitment: 0n, releasedRep: 50n })
		expect(await account(2n)).toMatchObject({ commitment: 5n })
		expect(await account(3n)).toMatchObject({ commitment: 5n })
		await cancel(2n)
		await request(2n)
		expect((await account(2n)).batch).not.toBe(originalBatch)
	})

	test('old closed claims survive many later cohorts and repeated near-total retirements', async () => {
		const amount = 10n ** 30n
		await create(amount, amount, 100n)
		await request(1n)
		await credit(100n, 101n, 103n)
		await retire(100n, 1n)
		for (let i = 0; i < 12; i++) {
			const id = await create(amount, amount, 100n)
			await request(id)
			await retire(100n, 1n)
		}
		expect(await totals()).toEqual([1n, 1n])
		expect(await account(1n)).toMatchObject({ rep: 0n, commitment: 0n, releasedRep: amount, ethFees: 101n, repFees: 103n })
		const hash = await claim(1n)
		expect((await client.waitForTransactionReceipt({ hash })).gasUsed).toBeLessThan(500_000n)
	})

	test('existing takeover recipients retain cohort and each original fee entitlement', async () => {
		await create(100n, 10n, 20n)
		await create(200n, 20n, 20n, owner(2))
		await request(1n)
		await request(2n)
		await retire(20n, 30n)
		await credit(20n, 300n, 600n)
		const batch = (await account(1n)).batch
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'transferTo', args: [1n, 2n, 50n, 5n, 20n, 20n] }))
		expect(await totals()).toEqual([300n, 30n])
		expect(await account(1n)).toMatchObject({ rep: 50n, commitment: 5n, ethFees: 100n, repFees: 200n, batch })
		expect(await account(2n)).toMatchObject({ rep: 250n, commitment: 25n, ethFees: 200n, repFees: 400n, batch })
		await create(100n, 10n, 20n)
		await expect(writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'transferTo', args: [1n, 3n, 50n, 5n, 20n, 20n] }))).rejects.toThrow('Commitment cohorts differ')
	})

	test('fee budget conservation survives point changes, rekeys and retirement with one-base-unit rounding', async () => {
		for (let i = 1; i <= 12; i++) await create(BigInt(i * 10), BigInt(i), BigInt(i))
		let fundedEth = 0n
		let fundedRep = 0n
		for (let step = 0; step < 25; step++) {
			const eth = BigInt((step % 5) + 1)
			const rep = BigInt((step % 7) + 1)
			await credit(BigInt((step % 12) + 1), eth, rep)
			fundedEth += eth
			fundedRep += rep
			if (step % 3 === 0) await claim(BigInt((step % 12) + 1))
			if (step === 10) await replace(1n, 10n, 1n, 20n)
			if (step === 15) await request(5n)
			if (step === 19) await retire(1n, 70n)
		}
		let accountedEth = 0n
		let accountedRep = 0n
		for (let i = 1; i <= 12; i++) {
			const id = BigInt(i)
			const state = await account(id)
			accountedEth += state.ethFees + (await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'paidEthFees', args: [id] }))
			accountedRep += state.repFees + (await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'paidRepFees', args: [id] }))
		}
		expect([accountedEth, accountedRep]).toEqual([fundedEth, fundedRep])
	})

	test('equal-health positions use bounded unique keys and whole-cohort retirement stays constant cost', async () => {
		for (let i = 0; i < 8; i++) await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'createIdentical', args: [8n, 3n, 2n, 10n, true] }))
		expect(await eligible(10n)).toBe(128n)
		await credit(10n, 127n, 129n)
		const hash = await retire(10n, 0n)
		expect((await client.waitForTransactionReceipt({ hash })).gasUsed).toBeLessThan(250_000n)
		let rep = 0n
		let eth = 0n
		let repFees = 0n
		for (let id = 1n; id <= 64n; id++) {
			const state = await account(id)
			rep += state.releasedRep
			eth += state.ethFees
			repFees += state.repFees
		}
		expect([rep, eth, repFees]).toEqual([192n, 127n, 129n])
	})

	test('mixed full-width rekeys and exact fee funding agree with a naive live ledger', async () => {
		type Entry = { id: bigint; rep: bigint; commitment: bigint; price: bigint; healthEpoch: bigint }
		const entries: Entry[] = []
		let seed = 19n
		let fundedEth = 0n
		let fundedRep = 0n
		let epoch = 0n
		for (let step = 0; step < 80; step++) {
			seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n)
			const price = (seed % 101n) << BigInt(step % 192)
			const commitment = (seed % 97n) + 1n
			const rep = commitment * 7n
			if (step < 20 || step % 5 === 0) {
				const id = await create(rep, commitment, price)
				entries.push({ id, rep, commitment, price, healthEpoch: 0n })
			} else {
				const entry = entries[Number(seed % BigInt(entries.length))]
				if (entry === undefined) throw new Error('Missing commitment model entry')
				await replace(entry.id, rep, commitment, price)
				Object.assign(entry, { rep, commitment, price })
			}
			const cutoff = step % 2 === 0 ? price : 0n
			expect(await eligible(cutoff)).toBe(entries.reduce((sum, entry) => sum + (entry.price >= cutoff ? entry.commitment : 0n), 0n))
			expect(await totals()).toEqual([entries.reduce((sum, entry) => sum + entry.rep, 0n), entries.reduce((sum, entry) => sum + entry.commitment, 0n)])
			await validate()
			// Observe after checking inherited stamps: a new member cannot receive
			// the old subtree observation merely by joining or rotating into it.
			for (const entry of entries) expect(await healthEpoch(entry.id)).toBe(entry.healthEpoch)
			if (step % 3 === 0) {
				await observe(cutoff)
				epoch++
				for (const entry of entries) if (entry.price >= cutoff) entry.healthEpoch = epoch
			}
			if (step % 7 === 0) {
				const eth = (seed % 101n) + 1n
				const repFee = (seed % 83n) + 1n
				await credit(cutoff, eth, repFee)
				fundedEth += eth
				fundedRep += repFee
			}
		}
		let actualEth = 0n
		let actualRep = 0n
		for (const entry of entries) {
			const state = await account(entry.id)
			expect(await healthEpoch(entry.id)).toBe(entry.healthEpoch)
			expect(state).toMatchObject({ rep: entry.rep, commitment: entry.commitment, maxHealthyPrice: entry.price })
			actualEth += state.ethFees
			actualRep += state.repFees
		}
		expect([actualEth, actualRep]).toEqual([fundedEth, fundedRep])
	})

	test('adversarial full-width health prefixes have bounded point and fee gas', async () => {
		for (let i = 0; i < 256; i += 16) await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'createSparse', args: [BigInt(i), 16n, false] }))
		const creditHash = await credit(1n, 256n, 512n)
		const creditGas = (await client.waitForTransactionReceipt({ hash: creditHash })).gasUsed
		expect(creditGas).toBeLessThan(750_000n)
		const cutoffHash = await credit(2n, 255n, 510n)
		const cutoffGas = (await client.waitForTransactionReceipt({ hash: cutoffHash })).gasUsed
		expect(cutoffGas).toBeLessThan(750_000n)
		const claimHash = await claim(1n)
		const claimGas = (await client.waitForTransactionReceipt({ hash: claimHash })).gasUsed
		expect(claimGas).toBeLessThan(750_000n)
		const replaceHash = await replace(1n, 10n, 1n, 0n)
		expect((await client.waitForTransactionReceipt({ hash: replaceHash })).gasUsed).toBeLessThan(1_000_000n)
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ creditGas, cutoffGas, claimGas })
	})

	test('768 adversarial full-width keys fit a composed three-registry checkpoint and owner settlement', async () => {
		for (let group = 0; group < 3; group++) {
			for (let i = 0; i < 256; i += 8) await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'createSparse', args: [BigInt(i), 8n, group < 2] }))
			if (group === 0) await retire(0n, 256n)
		}
		expect(await eligible(2n)).toBe(765n)
		await credit(1n, 768n, 1536n)
		await observe(1n)
		const hash = await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'creditAndClaim', args: [2n, 765n, 1530n, [1n, 257n, 513n]] }))
		const gas = (await client.waitForTransactionReceipt({ hash })).gasUsed
		expect(gas).toBeLessThan(2_000_000n)
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ composedThreeRegistryGas: gas })
	})

	test('bulk retirement uses balanced joins and preserves all detached claims', async () => {
		for (let i = 0; i < 128; i += 8) await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'createSparse', args: [BigInt(i), 8n, true] }))
		await credit(0n, 129n, 131n)
		await observe(0n)
		const epochs = new Map(Array.from({ length: 128 }, (_, i) => [BigInt(i + 1), 1n]))
		let epoch = 1n
		let remaining = 128n
		for (const amount of [1n, 2n, 31n, 17n, 48n, 28n]) {
			remaining -= amount
			await retire(0n, remaining)
			await validate()
			expect(await totals()).toEqual([remaining * 10n, remaining])
			await observe(0n)
			epoch++
			for (let id = 1n; id <= remaining; id++) epochs.set(id, epoch)
		}
		let feesEth = 0n
		let feesRep = 0n
		let releasedRep = 0n
		for (let id = 1n; id <= 128n; id++) {
			const state = await account(id)
			const expectedEpoch = epochs.get(id)
			if (expectedEpoch === undefined) throw new Error('Missing retired position epoch')
			expect(await healthEpoch(id)).toBe(expectedEpoch)
			await claim(id)
			expect(await healthEpoch(id)).toBe(expectedEpoch)
			feesEth += state.ethFees
			feesRep += state.repFees
			releasedRep += state.releasedRep
			expect(state.commitment).toBe(id === 1n ? 1n : 0n)
		}
		expect([feesEth, feesRep, releasedRep]).toEqual([129n, 131n, 1270n])
	})

	test('health observations survive cohort moves, splitting, merging and detached retirement claims', async () => {
		await create(100n, 10n, 20n)
		await create(100n, 10n, 10n)
		await create(100n, 10n, 30n)
		await observe(0n)
		await observe(20n)
		expect(await Promise.all([1n, 2n, 3n].map(healthEpoch))).toEqual([2n, 1n, 2n])
		await request(1n)
		await request(2n)
		await retire(0n, 30n)
		await request(3n)
		await observe(25n)
		const receiver = await split(2n, 50n, 5n, 10n, 10n)
		expect(await healthEpoch(receiver)).toBe(0n)
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'transferTo', args: [1n, receiver, 50n, 5n, 20n, 10n] }))
		expect(await Promise.all([1n, 2n, 3n, receiver].map(healthEpoch))).toEqual([2n, 1n, 3n, 0n])
		await credit(0n, 90n, 120n)
		await retire(0n, 0n)
		await create(100n, 10n, 30n)
		await observe(0n)
		for (const [id, expected] of [
			[1n, 2n],
			[2n, 1n],
			[3n, 3n],
			[receiver, 0n],
		]) {
			if (id === undefined || expected === undefined) throw new Error('Missing epoch expectation')
			expect(await healthEpoch(id)).toBe(expected)
			await claim(id)
			expect(await healthEpoch(id)).toBe(expected)
		}
		expect(await healthEpoch(5n)).toBe(4n)
		await validate()
	})

	test('same-block healthy observations use epochs and never replace a newer child stamp with an older parent', async () => {
		await create(10n, 1n, 10n)
		await create(10n, 1n, 20n)
		await create(10n, 1n, 30n)
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'observeHealthyTwice', args: [0n, 20n] }))
		expect(await Promise.all([1n, 2n, 3n].map(healthEpoch))).toEqual([1n, 2n, 2n])
		await replace(1n, 10n, 1n, 40n)
		await create(10n, 1n, 25n)
		expect(await Promise.all([1n, 2n, 3n, 4n].map(healthEpoch))).toEqual([1n, 2n, 2n, 0n])
		await validate()
	})

	test('only the owning portfolio can mutate or collect the index', async () => {
		await expect(writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'create', args: [owner(1), 10n, 10n, 10n] }))).rejects.toThrow('Only portfolio')
		await create(10n, 10n, 10n)
		await expect(writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'claim', args: [1n] }))).rejects.toThrow('Only portfolio')
		await expect(writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'observeHealthy', args: [0n] }))).rejects.toThrow('Only portfolio')
	})

	test('fork imports preserve cohorts and cannot refill a sealed child retirement group', async () => {
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'initCohorts', args: [1n, 2n] }))
		for (const batch of [0n, 1n, 2n]) await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importPosition', args: [owner(1), 100n, 10n, 20n, batch] }))
		expect(await totals()).toEqual([300n, 30n])
		expect((await account(2n)).batch).toBe(1n)
		await expect(create(100n, 10n, 20n)).rejects.toThrow('Commitment imports are open')
		await expect(retire(20n, 20n)).rejects.toThrow('Commitment imports are open')
		await expect(credit(20n, 10n, 10n)).rejects.toThrow('Commitment imports are open')
		await expect(observe(20n)).rejects.toThrow('Commitment imports are open')
		await expect(writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importPosition', args: [owner(1), 100n, 10n, 20n, 3n] }))).rejects.toThrow('Unknown imported cohort')
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importAdd', args: [1n, 50n, 5n, 30n] }))
		expect(await account(1n)).toMatchObject({ rep: 150n, commitment: 15n, maxHealthyPrice: 30n })
		await expect(writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importAdd', args: [2n, 50n, 5n, 30n] }))).rejects.toThrow('Import receiver is not active')
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'sealImports' }))
		await expect(writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importAdd', args: [1n, 50n, 5n, 30n] }))).rejects.toThrow('Commitment imports are sealed')
		await expect(writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importPosition', args: [owner(1), 100n, 10n, 20n, 1n] }))).rejects.toThrow('Commitment imports are sealed')
		await expect(writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'initCohorts', args: [1n, 2n] }))).rejects.toThrow('Commitment imports already initialized')
		await expect(replace(2n, 200n, 20n, 20n)).rejects.toThrow('Closed retirement commitment cannot increase')
		await retire(20n, 25n)
		expect(await account(2n)).toMatchObject({ commitment: 0n, releasedRep: 100n })
		expect(await account(3n)).toMatchObject({ commitment: 10n })
		await validate()
	})
})
