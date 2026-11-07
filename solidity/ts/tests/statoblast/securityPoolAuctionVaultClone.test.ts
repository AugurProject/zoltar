import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeFunctionData, getAddress, getCreate2Address, toHex, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { deployContract } from '../../testSupport/deployContract'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { auctionVaultCreationCode, auctionVaultRuntimeCode, decodeAuctionVaultBindings } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import {
	test_statoblast_AuctionVaultDeploymentBenchmark_AuctionVaultDeploymentBenchmark as benchmarkArtifact,
	test_statoblast_AuctionVaultDeploymentBenchmark_AuctionVaultBenchmarkAuctionMock as auctionArtifact,
	test_statoblast_AuctionVaultDeploymentBenchmark_AuctionVaultBenchmarkCapitalMock as capitalArtifact,
	statoblast_SecurityPoolAuctionVault_SecurityPoolAuctionVault as vaultArtifact,
} from '../../types/contractArtifact'

// Benchmark for the clone decision: the production minimal proxy with the four
// bindings appended to its code versus the former constructor-bound vault,
// deployed by the same factory and driven through the same owner operations.
describe('Statoblast: auction vault clones', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let owner: WriteClient
	let stranger: WriteClient
	let benchmark: Address
	let auction: Address
	let capital: Address
	let implementation: Address
	const gasOf = async (client: WriteClient, send: () => Promise<`0x${string}`>) => {
		const hash = await writeContractAndWait(client, send)
		return (await client.waitForTransactionReceipt({ hash })).gasUsed
	}
	const create = async (kind: 'createClone' | 'createReference', bidId: bigint) => {
		const simulation = await owner.simulateContract({ abi: benchmarkArtifact.abi, address: benchmark, functionName: kind, args: [owner.account.address, capital, auction, bidId] })
		const gas = await gasOf(owner, () => owner.writeContract({ abi: benchmarkArtifact.abi, address: benchmark, functionName: kind, args: [owner.account.address, capital, auction, bidId] }))
		return { vault: getAddress(simulation.result), gas }
	}
	const ping = encodeFunctionData({ abi: auctionArtifact.abi, functionName: 'ping' })
	const operate = (client: WriteClient, vault: Address) => gasOf(client, () => client.writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'execute', args: [auction, 0n, ping] }))

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		owner = createWriteClient(ethereum, TEST_ADDRESSES[0])
		stranger = createWriteClient(ethereum, TEST_ADDRESSES[1])
		benchmark = await deployContract(owner, `0x${benchmarkArtifact.evm.bytecode.object}`)
		auction = await deployContract(owner, `0x${auctionArtifact.evm.bytecode.object}`)
		capital = await deployContract(owner, `0x${capitalArtifact.evm.bytecode.object}`)
		implementation = await owner.readContract({ abi: benchmarkArtifact.abi, address: benchmark, functionName: 'implementation' })
		await setBaselineSnapshot()
	})

	test('a clone binds its owner, ledger, auction and bid immutably at an address the SDK predicts', async () => {
		const { vault } = await create('createClone', 7n)
		const sdkBindings = { implementation, owner: owner.account.address, capital, auction, bidId: 7n }
		expect(vault).toBe(getAddress(await owner.readContract({ abi: benchmarkArtifact.abi, address: benchmark, functionName: 'predictClone', args: [owner.account.address, capital, auction, 7n] })))
		const runtime = await owner.getCode({ address: vault })
		expect(runtime).toBe(await owner.readContract({ abi: benchmarkArtifact.abi, address: benchmark, functionName: 'expectedRuntime', args: [owner.account.address, capital, auction, 7n] }))
		// The SDK derives the same code; here the benchmark factory, not the auction, is the CREATE2 deployer.
		expect(runtime).toBe(auctionVaultRuntimeCode(sdkBindings))
		expect(await owner.readContract({ abi: benchmarkArtifact.abi, address: benchmark, functionName: 'expectedCreationCode', args: [owner.account.address, capital, auction, 7n] })).toBe(auctionVaultCreationCode(sdkBindings))
		expect(getCreate2Address({ from: benchmark, salt: toHex(7n, { size: 32 }), bytecode: auctionVaultCreationCode(sdkBindings) })).toBe(vault)
		expect(decodeAuctionVaultBindings(runtime)).toEqual(sdkBindings)
		expect(await owner.getCode({ address: implementation })).toBe(`0x${vaultArtifact.evm.deployedBytecode.object}`)
		expect(vaultArtifact.evm.deployedBytecode.immutableReferences).toEqual({})
		await expect(owner.readContract({ abi: vaultArtifact.abi, address: implementation, functionName: 'owner' })).rejects.toThrow('Auction vault is not a clone')
		expect(await owner.readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'owner' })).toBe(owner.account.address)
		expect(await owner.readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'initialCapital' })).toBe(capital)
		expect(await owner.readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'auction' })).toBe(auction)
		expect(await owner.readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'bidId' })).toBe(7n)
		await expect(stranger.writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'execute', args: [auction, 0n, ping] })).rejects.toThrow('Only the auction vault owner')
		await expect(owner.writeContract({ abi: benchmarkArtifact.abi, address: benchmark, functionName: 'createClone', args: [owner.account.address, capital, auction, 7n] })).rejects.toThrow('Auction vault deployment failed')
		await expect(owner.writeContract({ abi: benchmarkArtifact.abi, address: benchmark, functionName: 'createClone', args: [owner.account.address, capital, zeroAddress, 9n] })).rejects.toThrow('Auction vault dependencies missing')
		// Each clone keeps its own guard and materialization flag.
		await writeContractAndWait(owner, () => owner.writeContract({ abi: auctionArtifact.abi, address: auction, functionName: 'setFill', args: [7n, vault, 1n] }))
		await operate(owner, vault)
		expect(await owner.readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'initialPositionMaterialized' })).toBe(true)
		const { vault: second } = await create('createClone', 8n)
		expect(await owner.readContract({ abi: vaultArtifact.abi, address: second, functionName: 'initialPositionMaterialized' })).toBe(false)
	})

	test('clone deployment is far cheaper while each later operation pays only a small forwarding overhead', async () => {
		const full = await create('createReference', 1n)
		const clone = await create('createClone', 2n)
		const unfilled = { full: await operate(owner, full.vault), clone: await operate(owner, clone.vault) }
		for (const [id, vault] of [
			[1n, full.vault],
			[2n, clone.vault],
		] as const)
			await writeContractAndWait(owner, () => owner.writeContract({ abi: auctionArtifact.abi, address: auction, functionName: 'setFill', args: [id, vault, 1n] }))
		const materializing = { full: await operate(owner, full.vault), clone: await operate(owner, clone.vault) }
		const materialized = { full: await operate(owner, full.vault), clone: await operate(owner, clone.vault) }
		const report = { deployment: { full: full.gas, clone: clone.gas }, unfilledOperation: unfilled, materializingOperation: materializing, materializedOperation: materialized }
		if (process.env['COMMITMENT_REPORT_GAS'] === '1')
			console.log(
				'auctionVaultCloneGas',
				JSON.stringify(report, (_, value) => (typeof value === 'bigint' ? value.toString() : value)),
			)
		expect(clone.gas).toBeLessThan(full.gas / 5n)
		for (const pair of [unfilled, materializing, materialized]) expect(pair.clone - pair.full).toBeLessThan(10_000n)
		expect(materialized.clone).toBeLessThan(materializing.clone)
	})
})
