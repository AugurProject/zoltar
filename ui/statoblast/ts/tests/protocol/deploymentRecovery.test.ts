import { expect, test } from 'bun:test'
import { concatHex, createPublicClient, custom, encodeAbiParameters, encodeFunctionData, getCreate2Address, getCreateAddress, keccak256, parseAbi, parseAbiParameters, RpcError, type Hash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { testDouble } from '@zoltar/ui-core-shared/tests/testUtils/testDouble.js'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import * as recovery from '@zoltar/ui-statoblast-shared/protocol/deploymentRecovery.js'
import { getInfraContractAddresses, getSecurityPoolCreationCode } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { statoblast_SecurityPoolOpenAdmissionPolicy_SecurityPoolOpenAdmissionPolicy as openRules } from '@zoltar/ui-statoblast-shared/contractArtifact.js'

const owner = '0x4000000000000000000000000000000000000004'
const nonce = 9n
const head = 50n
const blockHash: Hash = `0x${'11'.repeat(32)}`
const block = (number: bigint) => testDouble<Awaited<ReturnType<ReadClient['getBlock']>>>({ number, hash: blockHash })
const unsupported = () => new RpcError('Unsupported block tag', { code: -32602 })

test('reads an exact storage word at the requested block', async () => {
	const slot: Hash = `0x${'00'.repeat(31)}07`
	const value: Hash = `0x${'00'.repeat(31)}08`
	const client = createPublicClient({
		transport: custom({
			request: async ({ method, params }) => {
				expect(method).toBe('eth_getStorageAt')
				expect(params).toEqual([owner, '0x7', '0x32'])
				return value
			},
		}),
	})
	expect(await client.getStorageAt({ address: owner, slot, blockNumber: head })).toBe(value)
})

for (const supportsSafe of [true, false]) {
	test(`recovers rules using ${supportsSafe ? 'safe' : 'a confirmed block'} when finalized is unavailable`, async () => {
		const calls: string[] = []
		const confirmed = supportsSafe ? head : head - 12n
		const client = {
			getBlock: async ({ blockNumber, blockTag } = {}) => {
				calls.push(blockNumber?.toString() ?? blockTag ?? 'latest')
				if (blockTag === 'finalized' || (blockTag === 'safe' && !supportsSafe)) throw unsupported()
				return block(blockNumber ?? head)
			},
			getTransactionCount: async ({ blockNumber }) => {
				expect(blockNumber).toBe(confirmed)
				return nonce + 1n
			},
			getCode: async ({ address, blockNumber }) => {
				expect(address).toBe(getCreateAddress({ from: owner, nonce }))
				expect(blockNumber).toBe(confirmed)
				return `0x${openRules.evm.deployedBytecode.object}`
			},
		} satisfies Partial<ReadClient>
		expect(await recovery.recoverQuestionRules(testDouble<ReadClient>(client), owner, nonce, 'open', 0n, [])).toEqual({ rules: getCreateAddress({ from: owner, nonce }) })
		expect(calls).toEqual(supportsSafe ? ['finalized', 'safe', `${head}`] : ['finalized', 'safe', 'latest', `${confirmed}`, `${confirmed}`])
	})
}

const unavailableFinalityResponses = [
	{ label: 'geth errors with context', response: (tag: string) => new RpcError(`eth_getBlockByNumber: ${tag} block not found in canonical chain`, { code: -32000 }) },
	{ label: 'plain provider errors', response: (tag: string) => new Error(`RPC upstream: ${tag} block not found`) },
	{ label: 'provider errors supplied as text', response: (tag: string) => `RPC upstream: ${tag} block not found` },
	{ label: 'null finality blocks', response: () => null },
]

for (const { label, response } of unavailableFinalityResponses) {
	test(`falls back through both finality tags for ${label}`, async () => {
		const calls: string[] = []
		const client = testDouble<ReadClient>({
			getBlock: async ({ blockNumber, blockTag }: { blockNumber?: bigint; blockTag?: string } = {}) => {
				calls.push(blockNumber?.toString() ?? blockTag ?? 'latest')
				if (blockTag === 'finalized' || blockTag === 'safe') {
					const result = response(blockTag)
					if (result !== null) throw result
					return result
				}
				return block(blockNumber ?? head)
			},
			getTransactionCount: async () => nonce + 1n,
			getCode: async () => `0x${openRules.evm.deployedBytecode.object}`,
		})
		expect(await recovery.recoverQuestionRules(client, owner, nonce, 'open', 0n, [])).toEqual({ rules: getCreateAddress({ from: owner, nonce }) })
		expect(calls).toEqual(['finalized', 'safe', 'latest', '38', '38'])
	})
}

const factorySource = 'contracts/statoblast/factories/SecurityPoolFactory.sol'
const factoryAbi = parseAbi(['function deploySecurityPool(bytes creationCode, bytes configuration) returns (address)'])
const saltParameters = parseAbiParameters('address, uint256')

for (const { initialCount, missingRead, failure, restartable } of [
	{ initialCount: undefined, missingRead: 'nonce', failure: new RpcError('missing trie node at requested block', { code: -32000 }), restartable: true },
	{ initialCount: 0n, missingRead: 'counter', failure: new RpcError('state at block #46 is pruned', { code: -32000 }), restartable: true },
	{ initialCount: undefined, missingRead: 'nonce', failure: new Error('RPC timed out'), restartable: false },
]) {
	test(`classifies legacy or wide-range recovery failure reading historical ${missingRead}: ${failure.message}`, async () => {
		const restore = installActiveEnvironmentForTesting(createFakeBackend())
		try {
			const request = {
				to: getInfraContractAddresses().securityPoolFactory,
				data: encodeFunctionData({ abi: factoryAbi, functionName: 'deploySecurityPool', args: [getSecurityPoolCreationCode(), '0x'] }),
			}
			const client = testDouble<ReadClient>({
				getBlock: async () => block(head),
				getTransactionCount: async ({ blockNumber }: { blockNumber: bigint }) => {
					if (blockNumber < head && missingRead === 'nonce') throw failure
					return blockNumber < 47n ? nonce : nonce + 1n
				},
				getStorageAt: async ({ blockNumber }: { blockNumber: bigint }) => {
					if (blockNumber < head && missingRead === 'counter') throw failure
					return encodeAbiParameters([{ type: 'uint256' }], [65n])
				},
			})
			const result = recovery.recoverSecurityPoolDeployment(client, owner, nonce, request, initialCount)
			if (restartable) await expect(result).rejects.toMatchObject({ name: 'DeploymentHistoryUnavailableError', cause: failure })
			else await expect(result).rejects.toBe(failure)
		} finally {
			restore()
		}
	})
}

for (const outcome of ['pending', 'no pool', 'unchanged counter', 'pool', 'legacy pool', 'reorg'] as const) {
	test(`checks deployment recovery with ${outcome} from the confirmed nonce and factory state`, async () => {
		const restore = installActiveEnvironmentForTesting(createFakeBackend())
		try {
			const artifact: { contracts: Record<string, { SecurityPoolFactory: { storageLayout: { storage: readonly { label: string; slot: string; type: string; offset: number }[] } } }> } = await Bun.file(new URL('../../../../../solidity/artifacts/Contracts.json', import.meta.url)).json()
			const layout = artifact.contracts[factorySource]?.SecurityPoolFactory.storageLayout.storage.find(field => field.label === 'securityPoolCreationCount')
			if (layout === undefined) throw new Error('Missing SecurityPoolFactory creator counter in compiled storage layout')
			expect(layout).toMatchObject({ type: 't_mapping(t_address,t_uint256)', offset: 0 })
			const addresses = getInfraContractAddresses()
			const creationCode = getSecurityPoolCreationCode()
			const configuration: Hex = `0x${'00'.repeat(13 * 32)}`
			const request = { to: addresses.securityPoolFactory, data: encodeFunctionData({ abi: factoryAbi, functionName: 'deploySecurityPool', args: [creationCode, configuration] }) }
			const moduleWords = [
				addresses.securityPoolFactory,
				addresses.securityPoolCapitalLedgerDeployer,
				addresses.securityPoolCommitmentIndexDeployer,
				addresses.securityPoolCapitalFeeStreamsDeployer,
				addresses.securityPoolSettlementBookDeployer,
				addresses.securityPoolSettlementDeployer,
				addresses.securityPoolReporterLedgerDeployer,
				addresses.securityPoolForkCoordinatorDeployer,
				addresses.securityPoolServicesDeployer,
				addresses.securityPoolRepairAuctionDeployer,
			]
			const bytecode = concatHex([creationCode, ...moduleWords.map(address => encodeAbiParameters([{ type: 'address' }], [address])), configuration])
			const candidate = getCreate2Address({ from: request.to, salt: keccak256(encodeAbiParameters(saltParameters, [owner, 7n])), bytecode })
			const slots: (bigint | undefined)[] = []
			const probes: unknown[] = []
			const client = testDouble<ReadClient>({
				getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => (blockNumber !== undefined && outcome === 'reorg' ? { ...block(blockNumber), hash: `0x${'22'.repeat(32)}` } : block(blockNumber ?? head)),
				getTransactionCount: async ({ blockNumber }: { blockNumber: bigint }) => (outcome === 'pending' || blockNumber < 47n ? nonce : nonce + 1n),
				getStorageAt: async ({ address, slot, blockNumber }: { address: string; slot: Hash; blockNumber?: bigint }) => {
					expect(address).toBe(request.to)
					expect(slot).toBe(keccak256(encodeAbiParameters(saltParameters, [owner, BigInt(layout.slot)])))
					slots.push(blockNumber)
					return encodeAbiParameters([{ type: 'uint256' }], [blockNumber === 46n || outcome === 'unchanged counter' ? 7n : 8n])
				},
				readContract: async ({ address, functionName, args, blockNumber }: { address: string; functionName: string; args: readonly string[]; blockNumber: bigint }) => {
					expect(address).toBe(request.to)
					expect(functionName).toBe('isSecurityPool')
					expect(blockNumber).toBe(head)
					probes.push(args[0])
					return outcome !== 'no pool' && args[0] === candidate
				},
			})
			const result = await recovery.recoverSecurityPoolDeployment(client, owner, nonce, request, outcome === 'legacy pool' ? undefined : 7n)
			const recoveredPool = outcome === 'no pool' || outcome === 'unchanged counter' ? undefined : candidate
			const slotsWhenSpent = outcome === 'legacy pool' ? [46n, 47n] : [head]
			expect(result).toEqual(outcome === 'pending' || outcome === 'reorg' ? undefined : { pool: recoveredPool })
			expect(probes).toEqual(outcome === 'pending' || outcome === 'unchanged counter' ? [] : [candidate])
			expect(slots).toEqual(outcome === 'pending' ? [] : slotsWhenSpent)
		} finally {
			restore()
		}
	})
}
