import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as artifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	test_statoblast_CapitalLedgerHarness_CapitalLedgerHarness as harnessArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { deployCapitalTestComponents } from './securityPoolCapitalTestComponents'

const E = 10n ** 18n

describe('Statoblast: owner health policy', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let alice: WriteClient
	let bob: WriteClient
	let keeper: WriteClient
	let ledger: Address
	let index: Address
	let harness: Address
	let token: Address
	const account = (client: WriteClient) => alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'ownerAccount', args: [client.account.address] })
	const position = (id: bigint) => alice.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })
	const price = async (amount: bigint, duration = 100_000) => {
		const now = (await alice.getBlock()).timestamp
		return writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setPrice', args: [amount, Number(now) + duration] }))
	}
	const demand = (amount: bigint) => writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setDemand', args: [amount] }))
	const deposit = (client: WriteClient, amount: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'depositFor', args: [client.account.address, amount] }))
	const authorize = async (client: WriteClient, commitment: bigint) => {
		await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'authorize', args: [commitment] }))
		const owner = await account(client)
		if (owner.positionId === 0n) throw new Error('Authorized position missing')
		return owner.positionId
	}
	const withdraw = (client: WriteClient, amount: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'withdrawPrincipal', args: [amount, client.account.address] }))

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		alice = createWriteClient(ethereum, TEST_ADDRESSES[0])
		bob = createWriteClient(ethereum, TEST_ADDRESSES[1])
		keeper = createWriteClient(ethereum, TEST_ADDRESSES[2])
		const componentsReceipt = await deployCapitalTestComponents(alice)
		if (componentsReceipt.contractAddress === undefined) throw new Error('Capital test components address missing')
		const receipt = await alice.waitForTransactionReceipt({ hash: await alice.sendTransaction({ data: encodeDeployData({ abi: harnessArtifact.abi, bytecode: `0x${harnessArtifact.evm.bytecode.object}`, args: [componentsReceipt.contractAddress] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('Capital harness address missing')
		harness = receipt.contractAddress
		ledger = await alice.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'ledger' })
		token = await alice.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'token' })
		index = await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'commitmentIndex' })
		for (const client of [alice, bob, keeper]) {
			await writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [client.account.address, 10_000n * E] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [ledger, 10_000n * E] }))
		}
		await price(E)
		await setBaselineSnapshot()
	})

	const target = (client: WriteClient, health: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'setHealthTarget', args: [health] }))
	const collateral = (client: WriteClient) => alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'ownerCollateral', args: [client.account.address] })
	const retire = (client: WriteClient, id: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'requestRetirement', args: [id, 0n] }))
	const cancel = (client: WriteClient, id: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'cancelRetirement', args: [id] }))

	test('withdrawal quote preserves the saved target and excludes earned REP', async () => {
		await target(alice, 12_000n)
		await deposit(alice, 126n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'fundRepFees', args: [21n * E] }))
		await getAnvilWindowEthereum().advanceTime(86_401n)
		await writeContractAndWait(alice, () => alice.writeContract({ abi: artifact.abi, address: ledger, functionName: 'checkpoint' }))
		expect((await account(alice)).feesAttoRep + (await position(id)).repFees).toBe(21n * E)
		expect([...(await collateral(alice))]).toEqual([126n * E, 100n * E, 0n])
	})

	test('withdrawals cannot cross the saved target even while above the protocol floor', async () => {
		await target(alice, 12_000n)
		await deposit(alice, 130n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await expect(withdraw(alice, 4n * E + 1n)).rejects.toThrow('Owner collateral too low')
		await withdraw(alice, 4n * E)
		expect((await position(id)).rep).toBe(126n * E)
	})

	test('a target raise requires adequate pledged principal and leaves the commitment unchanged', async () => {
		await deposit(alice, 105n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await expect(target(alice, 12_000n)).rejects.toThrow('Chosen health target unmet')
		await deposit(alice, 21n * E)
		await target(alice, 12_000n)
		expect((await account(alice)).targetHealthFactorBps).toBe(12_000n)
		expect(await position(id)).toMatchObject({ rep: 126n * E, commitment: 100n * E })
	})

	test('stale prices block target raises but permit lowering without expanding commitment', async () => {
		await target(alice, 12_000n)
		await deposit(alice, 200n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await price(E, 5)
		await getAnvilWindowEthereum().advanceTime(6n)
		await expect(target(alice, 13_000n)).rejects.toThrow('Capital price stale')
		await target(alice, 11_000n)
		await target(alice, 11_000n)
		expect((await account(alice)).targetHealthFactorBps).toBe(11_000n)
		expect((await position(id)).commitment).toBe(100n * E)
		await expect(target(alice, 9_999n)).rejects.toThrow('Health below protocol floor')
	})

	test('lowering a breached target remains possible without reducing or expanding live obligations', async () => {
		await target(alice, 12_000n)
		await deposit(alice, 126n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await price(2n * E, 5)
		await getAnvilWindowEthereum().advanceTime(6n)
		await target(alice, 11_000n)
		expect((await account(alice)).targetHealthFactorBps).toBe(11_000n)
		expect(await position(id)).toMatchObject({ rep: 126n * E, commitment: 100n * E })
	})

	test('cancelling retirement cannot reopen capacity below the chosen target', async () => {
		await target(alice, 12_000n)
		await deposit(alice, 126n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await retire(alice, id)
		await price((E * 11n) / 10n)
		await expect(cancel(alice, id)).rejects.toThrow('Chosen health target unmet')
		await deposit(alice, (E * 126n) / 10n)
		await cancel(alice, id)
		expect(await position(id)).toMatchObject({ batch: 0n, commitment: 100n * E })
	})

	test('cancelling retirement needs a fresh price even with abundant collateral', async () => {
		await deposit(alice, 200n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await retire(alice, id)
		await price(E, 5)
		await getAnvilWindowEthereum().advanceTime(6n)
		await expect(cancel(alice, id)).rejects.toThrow('Capital price stale')
	})

	test('breaching the chosen buffer alone does not permit liquidation or keeper rewards', async () => {
		await target(alice, 12_000n)
		await deposit(alice, 126n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await price((E * 11n) / 10n)
		await writeContractAndWait(keeper, () => keeper.writeContract({ abi: artifact.abi, address: ledger, functionName: 'cure', args: [id] }))
		expect((await position(id)).commitment).toBe(100n * E)
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBe(0n)
		expect((await account(keeper)).feesAttoEth).toBe(0n)
		expect((await account(keeper)).feesAttoRep).toBe(0n)
		await expect(authorize(alice, 101n * E)).rejects.toThrow('Chosen health target unmet')
	})

	test('an atomic deposit and target raise requires the exact rounded backing and rolls back failed deposits', async () => {
		await deposit(alice, 105n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		const depositAndRaise = (amount: bigint) => writeContractAndWait(alice, () => alice.writeContract({ abi: artifact.abi, address: ledger, functionName: 'depositAndSetHealthTarget', args: [amount, 12_000n] }))
		const balance = await alice.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [alice.account.address] })
		await expect(depositAndRaise(21n * E - 1n)).rejects.toThrow('Chosen health target unmet')
		expect((await position(id)).rep).toBe(105n * E)
		expect(await alice.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [alice.account.address] })).toBe(balance)
		await depositAndRaise(21n * E)
		expect(await position(id)).toMatchObject({ rep: 126n * E, commitment: 100n * E })
		expect((await account(alice)).targetHealthFactorBps).toBe(12_000n)
	})

	test('a stale target raise rejects the combined deposit while a protective deposit remains available', async () => {
		await deposit(alice, 105n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await price(E, 5)
		await getAnvilWindowEthereum().advanceTime(6n)
		await expect(writeContractAndWait(alice, () => alice.writeContract({ abi: artifact.abi, address: ledger, functionName: 'depositAndSetHealthTarget', args: [21n * E, 12_000n] }))).rejects.toThrow('Capital price stale')
		expect((await position(id)).rep).toBe(105n * E)
		await deposit(alice, 21n * E)
		expect(await position(id)).toMatchObject({ rep: 126n * E, commitment: 100n * E })
	})

	test('settling a completed retirement permits idle target changes without an oracle', async () => {
		await deposit(alice, 105n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await retire(alice, id)
		await demand(0n)
		await price(E, 5)
		await getAnvilWindowEthereum().advanceTime(6n)
		await target(alice, 15_000n)
		expect(await account(alice)).toMatchObject({ positionId: 0n, freeAttoRep: 105n * E, targetHealthFactorBps: 15_000n })
		await withdraw(alice, 105n * E)
	})

	test('idle principal stays withdrawable during stale prices and after a fork', async () => {
		await target(alice, 15_000n)
		await deposit(alice, 100n * E)
		await price(E, 5)
		await getAnvilWindowEthereum().advanceTime(6n)
		expect([...(await collateral(alice))]).toEqual([100n * E, 0n, 100n * E])
		await withdraw(alice, 40n * E)
		const now = (await alice.getBlock()).timestamp
		await writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setFork', args: [now] }))
		expect([...(await collateral(alice))]).toEqual([60n * E, 0n, 60n * E])
		await withdraw(alice, 60n * E)
		expect((await account(alice)).freeAttoRep).toBe(0n)
	})
	test('retiring to a fixed commitment permits a backed target raise without exiting the position', async () => {
		await target(alice, 12_000n)
		await deposit(alice, 126n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await writeContractAndWait(alice, () => alice.writeContract({ abi: artifact.abi, address: ledger, functionName: 'requestRetirement', args: [id, 80n * E] }))
		expect(await position(id)).toMatchObject({ commitment: 100n * E, remainingCommitment: 80n * E })
		await expect(target(alice, 15_000n)).rejects.toThrow('Chosen health target unmet')
		await demand(80n * E)
		expect(await position(id)).toMatchObject({ rep: 126n * E, commitment: 80n * E, remainingCommitment: 0n, batch: 0n, releasedRep: 0n })
		await target(alice, 15_000n)
		expect([...(await collateral(alice))]).toEqual([126n * E, 80n * E, 0n])
		await demand(0n)
		await writeContractAndWait(bob, () => bob.writeContract({ abi: artifact.abi, address: ledger, functionName: 'serveRetirement', args: [0n] }))
		expect(await position(id)).toMatchObject({ rep: 126n * E, commitment: 80n * E, batch: 0n })
	})

	test('new partial retirement requests require economic minimums on both reduction and residual', async () => {
		await deposit(alice, 126n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		const request = (remaining: bigint) => writeContractAndWait(alice, () => alice.writeContract({ abi: artifact.abi, address: ledger, functionName: 'requestRetirement', args: [id, remaining] }))
		await expect(request(100n * E)).rejects.toThrow('Retirement must reduce commitment')
		await expect(request(10n ** 15n - 1n)).rejects.toThrow('Retirement below economic minimum')
		await expect(request(100n * E - 10n ** 15n + 1n)).rejects.toThrow('Retirement below economic minimum')
		await request(100n * E - 10n ** 15n)
		expect((await position(id)).remainingCommitment).toBe(100n * E - 10n ** 15n)
	})

	test('an owner completes their own retirement without processing older requests or spending their reserved capacity', async () => {
		await deposit(alice, 126n * E)
		await deposit(bob, 126n * E)
		const first = await authorize(alice, 100n * E)
		const second = await authorize(bob, 100n * E)
		await demand(200n * E)
		for (const [client, id] of [
			[alice, first],
			[bob, second],
		] as const) {
			await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'requestRetirement', args: [id, 80n * E] }))
		}
		await deposit(keeper, 42n * E)
		await authorize(keeper, 40n * E)
		await writeContractAndWait(bob, () => bob.writeContract({ abi: artifact.abi, address: ledger, functionName: 'serveRetirement', args: [second] }))
		expect(await position(first)).toMatchObject({ rep: 126n * E, commitment: 100n * E, remainingCommitment: 80n * E })
		expect(await position(second)).toMatchObject({ rep: 126n * E, commitment: 80n * E, remainingCommitment: 0n, batch: 0n })
		expect(await alice.readContract({ abi: indexArtifact.abi, address: index, functionName: 'eligibleActiveCommitment', args: [E] })).toBe(200n * E)
		await writeContractAndWait(alice, () => alice.writeContract({ abi: artifact.abi, address: ledger, functionName: 'serveRetirement', args: [first] }))
		expect(await position(first)).toMatchObject({ commitment: 80n * E, remainingCommitment: 0n, batch: 0n })
	})

	test('targeted completion makes no partial progress when an earlier request needs the spare backing', async () => {
		await deposit(alice, 126n * E)
		await deposit(bob, 126n * E)
		const first = await authorize(alice, 100n * E)
		const second = await authorize(bob, 100n * E)
		await demand(200n * E)
		for (const [client, id] of [
			[alice, first],
			[bob, second],
		] as const) {
			await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'requestRetirement', args: [id, 80n * E] }))
		}
		await deposit(keeper, 21n * E)
		await authorize(keeper, 20n * E)
		await writeContractAndWait(bob, () => bob.writeContract({ abi: artifact.abi, address: ledger, functionName: 'serveRetirement', args: [second] }))
		expect(await position(first)).toMatchObject({ commitment: 100n * E, remainingCommitment: 80n * E })
		expect(await position(second)).toMatchObject({ commitment: 100n * E, remainingCommitment: 80n * E })
	})
})
