import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, getAddress, getCreate2Address, toHex, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { ensureZoltarDeployed, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { deployContract } from '../../testSupport/deployContract'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { auctionVaultCreationCode, auctionVaultRuntimeCode, decodeAuctionVaultBindings } from '@zoltar/statoblast-shared/statoblast/securityPool'
import {
	test_statoblast_RepairAuctionVaultDeploymentBenchmark_RepairAuctionVaultDeploymentBenchmark as benchmarkArtifact,
	test_statoblast_RepairAuctionVaultDeploymentBenchmark_RepairAuctionVaultBenchmarkAuctionMock as auctionArtifact,
	test_statoblast_RepairAuctionVaultDeploymentBenchmark_RepairAuctionVaultBenchmarkCapitalMock as capitalArtifact,
	statoblast_SecurityPoolRepairAuctionVault_SecurityPoolRepairAuctionVault as vaultArtifact,
	statoblast_tokens_ShareToken_ShareToken as tokenArtifact,
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
		await ensureZoltarDeployed(owner)
		benchmark = await deployContract(owner, `0x${benchmarkArtifact.evm.bytecode.object}`)
		auction = await deployContract(owner, `0x${auctionArtifact.evm.bytecode.object}`)
		capital = await deployContract(owner, `0x${capitalArtifact.evm.bytecode.object}`)
		implementation = await owner.readContract({ abi: benchmarkArtifact.abi, address: benchmark, functionName: 'implementation' })
		await setBaselineSnapshot()
	})

	test('#1394 auction vault clones advertise their receiver interfaces', async () => {
		const { vault } = await create('createClone', 19n)
		const abi = [{ type: 'function', name: 'supportsInterface', stateMutability: 'view', inputs: [{ type: 'bytes4' }], outputs: [{ type: 'bool' }] }] as const
		for (const [id, supported] of [
			['0x01ffc9a7', true],
			['0x4e2312e0', true],
			['0xffffffff', false],
		] as const) {
			expect(await owner.readContract({ abi, address: vault, functionName: 'supportsInterface', args: [id] })).toBe(supported)
		}
		expect(await owner.readContract({ abi, address: implementation, functionName: 'supportsInterface', args: ['0x4e2312e0'] })).toBe(false)
		const token = await deployContract(owner, encodeDeployData({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}`, args: [owner.account.address, getZoltarAddress(), 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mintCompleteSets', args: [0n, owner.account.address, 3n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'safeTransferFrom', args: [owner.account.address, vault, 1n, 1n, '0x'] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'safeBatchTransferFrom', args: [owner.account.address, vault, [0n, 1n, 2n], [1n, 1n, 1n], '0x'] }))
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [vault, 1n] })).toBe(2n)
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
		expect(await owner.readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'repairAuction' })).toBe(auction)
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

	// ERC-1155 safe transfers accept a deposit exactly when the recipient's hook
	// returns its selector, so calling the hooks is the deposit decision itself.
	const erc165Abi = [{ type: 'function', name: 'supportsInterface', stateMutability: 'view', inputs: [{ name: 'interfaceId', type: 'bytes4' }], outputs: [{ name: '', type: 'bool' }] }] as const
	const depositSimulations = (recipient: Address) => [
		() => owner.call({ to: recipient, value: 1n }),
		() => owner.readContract({ abi: vaultArtifact.abi, address: recipient, functionName: 'onERC1155Received', args: [owner.account.address, owner.account.address, 1n, 1n, '0x'] }),
		() => owner.readContract({ abi: vaultArtifact.abi, address: recipient, functionName: 'onERC1155BatchReceived', args: [owner.account.address, owner.account.address, [1n], [1n], '0x'] }),
	]

	test('only a clone accepts ETH and ERC-1155 deposits; the ownerless implementation refuses them (#1393)', async () => {
		const { vault } = await create('createClone', 11n)
		const [ethToClone, singleToClone, batchToClone] = depositSimulations(vault)
		await ethToClone?.()
		expect(await singleToClone?.()).toBe('0xf23a6e61')
		expect(await batchToClone?.()).toBe('0xbc197c81')
		for (const deposit of depositSimulations(implementation)) await expect(deposit()).rejects.toThrow('Auction vault is not a clone')
		await expect(owner.readContract({ abi: vaultArtifact.abi, address: implementation, functionName: 'owner' })).rejects.toThrow('Auction vault is not a clone')
	})

	test('a clone answers ERC-165 discovery for the ERC-1155 receiver interface (#1394)', async () => {
		const { vault } = await create('createClone', 12n)
		const supports = (address: Address, interfaceId: `0x${string}`) => owner.readContract({ abi: erc165Abi, address, functionName: 'supportsInterface', args: [interfaceId] })
		expect(await supports(vault, '0x01ffc9a7')).toBe(true)
		expect(await supports(vault, '0x4e2312e0')).toBe(true)
		expect(await supports(vault, '0xffffffff')).toBe(false)
		// The implementation refuses deposits, so it must not advertise the receiver interface.
		expect(await supports(implementation, '0x01ffc9a7')).toBe(true)
		expect(await supports(implementation, '0x4e2312e0')).toBe(false)
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
