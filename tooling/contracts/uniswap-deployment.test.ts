import { canonicalUniswapDeployment } from '../../bots/shared/src/config/canonical-deployment.ts'
import { describe, expect, test } from 'bun:test'
import { concatHex, encodeDeployData, getAddress, getCreate2Address, keccak256, zeroAddress, type Address, type Hash, type Hex, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from '../../ui/zoltarShared/ts/protocol/zoltarDeploymentHelpers.ts'
import { statoblast_WETH9_WETH9 } from '../../solidity/ts/types/contractArtifact.ts'
import type { WriteClient } from '../../ui/coreShared/ts/wallet/chainBackend.ts'
import { SEPOLIA_NETWORK_PROFILE } from '../../ui/coreShared/ts/wallet/networkProfile.ts'
import { getUniswapNetworkDeployment } from '@zoltar/core-shared/deployment/uniswapDeployments'
import { ARACHNID_CREATE2_DEPLOYER_ADDRESS, ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE, SEPOLIA_CHAIN_ID, assertPermit2ImmutableValues, assertUniswapDeploymentArtifact, getUniswapDeployment, resolveCanonicalCreate2DeployerForPreflight } from './uniswap-deployment.mts'
import { ensurePublishedContracts } from './published-contracts.mts'

const SEPOLIA_UNISWAP = getUniswapNetworkDeployment(SEPOLIA_CHAIN_ID)
const CUSTOM_CHAIN_ID = 31_337
const WETH = SEPOLIA_UNISWAP.wethAddress

function asWriteClient(client: Partial<WriteClient>): WriteClient {
	return {
		getBlock: async () => ({ baseFeePerGas: 1n }) as never,
		...client,
	} as WriteClient
}

function successReceipt(): TransactionReceipt {
	return { ...({} as TransactionReceipt), status: 'success' }
}

// Unit doubles cannot reproduce Uniswap's bytecode, so they accept a one-byte stand-in as the expected runtime code.
async function stubbedPublishedContracts() {
	const { publishedContracts } = await getUniswapDeployment(SEPOLIA_CHAIN_ID)
	return publishedContracts.map(contract => ({ ...contract, expectedRuntimeCodeHash: keccak256('0x01') }))
}

describe('Uniswap testnet deployment', () => {
	test('resolves confirmed CREATE2 code before fee and budget preflight', async () => {
		let codeReadCount = 0
		const retryDelays: number[] = []
		const installed = await resolveCanonicalCreate2DeployerForPreflight(
			asWriteClient({
				getCode: async () => {
					codeReadCount += 1
					return codeReadCount < 3 ? undefined : ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE
				},
				getTransactionCount: async () => 1n,
			}),
			async delayMilliseconds => {
				retryDelays.push(delayMilliseconds)
			},
		)

		expect(installed).toBe(true)
		expect(retryDelays).toEqual([250])
	})
	test('accepts the pinned deployment artifact with Windows line endings', async () => {
		const artifact = await Bun.file(new URL('../../scripts/artifacts/uniswap-deployment.json', import.meta.url)).text()
		expect(() => assertUniswapDeploymentArtifact(artifact.replaceAll('\n', '\r\n'))).not.toThrow()
	})

	test('rejects a changed deployment artifact before constructing a plan', async () => {
		const artifact = await Bun.file(new URL('../../scripts/artifacts/uniswap-deployment.json', import.meta.url)).text()
		const changedArtifact = artifact.replace('"uniswapV3SwapRouter": "0x60', '"uniswapV3SwapRouter": "0x61')
		expect(changedArtifact).not.toBe(artifact)
		expect(() => assertUniswapDeploymentArtifact(changedArtifact)).toThrow('Uniswap deployment artifact is stale or changed')
	})

	test('rejects a wrong cached Permit2 chain ID even when the domain separator is current', () => {
		const chainId = `0x${'00'.repeat(31)}01` as Hex
		const wrongChainId = `0x${'00'.repeat(31)}02` as Hex
		const domainSeparator = `0x${'11'.repeat(32)}` as Hash
		const immutableReferences = [
			{ name: '_CACHED_CHAIN_ID', references: [{ length: 32, start: 0 }] },
			{ name: '_CACHED_DOMAIN_SEPARATOR', references: [{ length: 32, start: 32 }] },
		] as const

		expect(() => assertPermit2ImmutableValues(concatHex([chainId, domainSeparator]), immutableReferences, { chainId, domainSeparator })).not.toThrow()
		expect(() => assertPermit2ImmutableValues(concatHex([wrongChainId, domainSeparator]), immutableReferences, { chainId, domainSeparator })).toThrow('immutable _CACHED_CHAIN_ID')
	})

	test('lists the published Sepolia contracts as prerequisites and only installs the canonical deployers, Permit2, and a SwapRouter', async () => {
		const deployment = await getUniswapDeployment(SEPOLIA_CHAIN_ID)
		expect(deployment.kind).toBe('published')
		expect(deployment.steps.map(step => step.id)).toEqual(['arachnidCreate2Deployer', 'permit2', 'uniswapV3SwapRouter'])
		expect(deployment.steps.map(step => step.dependencies)).toEqual([[], ['arachnidCreate2Deployer'], ['proxyDeployer']])
		expect(deployment.publishedContracts.map(({ address, id, label }) => ({ address, id, label }))).toEqual([
			{ address: WETH, id: 'weth', label: 'Wrapped Ether' },
			{ address: SEPOLIA_UNISWAP.uniswapV3FactoryAddress, id: 'uniswapV3Factory', label: 'Uniswap V3 Factory' },
			{ address: SEPOLIA_UNISWAP.uniswapV3QuoterAddress, id: 'uniswapV3Quoter', label: 'Uniswap V3 QuoterV2' },
			{ address: SEPOLIA_UNISWAP.uniswapV4PoolManagerAddress, id: 'uniswapV4PoolManager', label: 'Uniswap V4 PoolManager' },
			{ address: SEPOLIA_UNISWAP.uniswapV4QuoterAddress, id: 'uniswapV4Quoter', label: 'Uniswap V4 Quoter' },
		])
		expect(deployment.publishedContracts.map(contract => contract.install.kind)).toEqual(['create', 'create', 'create', 'create', 'create2'])
		expect(deployment.publishedContracts.map(contract => contract.expectedRuntimeCodeHash)).toEqual([
			'0xc864e10689f2da18833652a3b075d43106e87f0f90d95ee64f6f0b33bc026083',
			'0xacb5afea1f8877239fadd30358add13f2f9d4fb80175402c686d392295224fef',
			'0xe4068c0e5f3f2d9980793dd4314d2222dca27d03fd999cb5dca580fd90ceea0e',
			'0x09930125a49f5b95caf8052991cc14d1240dca8b43f42b899115b86867e4bce1',
			'0xf481a751ac453d40c46d12360b85b05472028c1b113ab63749d69a5f8b0e47d1',
		])
		expect(deployment.addresses).toEqual({
			arachnidCreate2DeployerAddress: getAddress('0x4e59b44847b379578588920cA78FbF26c0B4956C'),
			permit2Address: getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3'),
			uniswapV3FactoryAddress: getAddress('0x0227628f3F023bb0B980b67D528571c95c6DaC1c'),
			uniswapV3QuoterAddress: getAddress('0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3'),
			uniswapV3SwapRouterAddress: getAddress('0xa277024D80f829d58471239f4359933Dd6f18155'),
			uniswapV4PoolManagerAddress: getAddress('0xE03A1074c86CFeDd5C142C4F04F1a1536e203543'),
			uniswapV4QuoterAddress: getAddress('0x61b3f2011a92d183c7dbadbda940a7555ccf9227'),
			wethAddress: getAddress('0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'),
		})
		expect(deployment.steps.find(step => step.id === 'uniswapV3SwapRouter')?.expectedRuntimeCodeHash).toBe('0xca7d8f5518a35dc3dae4f1a90b95c16307baec1321442b55aa82187eff242faf')
	})

	test('rejects published chains without vendored creation data', async () => {
		await expect(getUniswapDeployment(1)).rejects.toThrow('Chain 1 has a published Uniswap deployment without vendored creation transactions and runtime code hashes; only Sepolia is supported by deploy:testnet')
	})

	test('deploys the complete deterministic Uniswap set and WETH9 on chains without a published deployment', async () => {
		const deployment = await getUniswapDeployment(CUSTOM_CHAIN_ID)
		expect(deployment.kind).toBe('deterministic')
		expect(deployment.publishedContracts).toEqual([])
		expect(deployment.steps.map(step => step.id)).toEqual(['arachnidCreate2Deployer', 'permit2', 'weth', 'uniswapV3Factory', 'uniswapV3Quoter', 'uniswapV3SwapRouter', 'uniswapV4PoolManager', 'uniswapV4Quoter'])
		expect(deployment.steps.map(step => step.dependencies)).toEqual([[], ['arachnidCreate2Deployer'], ['proxyDeployer'], ['proxyDeployer'], ['proxyDeployer', 'uniswapV3Factory'], ['proxyDeployer', 'uniswapV3Factory'], ['proxyDeployer'], ['proxyDeployer', 'uniswapV4PoolManager']])
		for (const step of deployment.steps.slice(2)) expect(step.expectedRuntimeCodeHash).toMatch(/^0x[0-9a-f]{64}$/)
		expect(deployment.addresses).toEqual({
			arachnidCreate2DeployerAddress: getAddress('0x4e59b44847b379578588920cA78FbF26c0B4956C'),
			permit2Address: getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3'),
			uniswapV3FactoryAddress: getAddress('0xEf09Be426F8d6D2786cADEA7D3A8b0D09cEB79B4'),
			uniswapV3QuoterAddress: getAddress('0x6Aa53e5023fFDa81f7EEE31bdA5D35437A5DD841'),
			uniswapV3SwapRouterAddress: getAddress('0xC0a0e58Ae39603398D474BFd49d2904dE1464C99'),
			uniswapV4PoolManagerAddress: getAddress('0x9C27Fce9ad85dE98C7e95031Bf3F0B3D2CD677ad'),
			uniswapV4QuoterAddress: getAddress('0x29322b72F451C5f4eba5b3C862C76896470c059A'),
			wethAddress: getAddress('0x65156FD21726b8efcB627fa38c506E3f3542F601'),
		})
		// The registry constants must equal the CREATE2 addresses derived independently from the pinned init code.
		const registry = getUniswapNetworkDeployment(CUSTOM_CHAIN_ID)
		expect(registry.kind).toBe('deterministic')
		const artifact: unknown = await Bun.file(new URL('../../scripts/artifacts/uniswap-deployment.json', import.meta.url)).json()
		if (typeof artifact !== 'object' || artifact === null) throw new Error('Expected the Uniswap deployment artifact')
		const bytecode = (key: string) => {
			const value = Reflect.get(artifact, key)
			if (typeof value !== 'string' || !value.startsWith('0x')) throw new Error(`Expected ${key} bytecode`)
			return value as Hex
		}
		const derive = (initCode: Hex) => getCreate2Address({ bytecode: initCode, from: PROXY_DEPLOYER_ADDRESS, salt: ZERO_SALT })
		const twoAddresses = [
			{
				inputs: [
					{ name: 'a', type: 'address' },
					{ name: 'b', type: 'address' },
				],
				stateMutability: 'nonpayable',
				type: 'constructor',
			},
		] as const
		const oneAddress = [{ inputs: [{ name: 'a', type: 'address' }], stateMutability: 'nonpayable', type: 'constructor' }] as const
		expect(derive(`0x${statoblast_WETH9_WETH9.evm.bytecode.object}`)).toBe(registry.wethAddress)
		expect(derive(bytecode('uniswapV3Factory'))).toBe(registry.uniswapV3FactoryAddress)
		expect(derive(encodeDeployData({ abi: twoAddresses, args: [registry.uniswapV3FactoryAddress, registry.wethAddress], bytecode: bytecode('uniswapV3Quoter') }))).toBe(registry.uniswapV3QuoterAddress)
		expect(derive(encodeDeployData({ abi: twoAddresses, args: [registry.uniswapV3FactoryAddress, registry.wethAddress], bytecode: bytecode('uniswapV3SwapRouter') }))).toBe(registry.uniswapV3SwapRouterAddress)
		expect(derive(encodeDeployData({ abi: oneAddress, args: [zeroAddress], bytecode: bytecode('uniswapV4PoolManager') }))).toBe(registry.uniswapV4PoolManagerAddress)
		expect(derive(encodeDeployData({ abi: oneAddress, args: [registry.uniswapV4PoolManagerAddress], bytecode: bytecode('uniswapV4Quoter') }))).toBe(registry.uniswapV4QuoterAddress)
	})

	test('accepts published contracts that already have the exact runtime code without touching the node', async () => {
		const publishedContracts = await stubbedPublishedContracts()
		const rpcCalls: string[] = []
		const installed = await ensurePublishedContracts(
			asWriteClient({ getCode: async () => '0x01' }),
			async (method: string) => {
				rpcCalls.push(method)
				return undefined
			},
			SEPOLIA_CHAIN_ID,
			publishedContracts,
		)
		expect(installed).toEqual([])
		expect(rpcCalls).toEqual([])
	})

	test('rejects published addresses whose runtime code differs from the vendored deployment', async () => {
		const { publishedContracts } = await getUniswapDeployment(SEPOLIA_CHAIN_ID)
		await expect(ensurePublishedContracts(asWriteClient({ getCode: async () => '0x01' }), async () => undefined, SEPOLIA_CHAIN_ID, publishedContracts)).rejects.toThrow('Unexpected runtime code for Wrapped Ether at 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14')
	})

	test('refuses missing published contracts on a node without Anvil cheatcodes', async () => {
		const publishedContracts = await stubbedPublishedContracts()
		const missing = publishedContracts[2]
		if (missing === undefined) throw new Error('Expected published contracts')
		await expect(
			ensurePublishedContracts(
				asWriteClient({ getCode: async ({ address }) => (address === missing.address ? '0x' : '0x01') }),
				async (method: string) => {
					throw new Error(`Method ${method} not found`)
				},
				SEPOLIA_CHAIN_ID,
				publishedContracts,
			),
		).rejects.toThrow(`Uniswap V3 QuoterV2 (${missing.address}) published by Uniswap has no code on chain 11155111. Use an RPC for that network or an Anvil development node.`)
	})

	test('installs missing published contracts on a development node by replaying the vendored creation transactions', async () => {
		const publishedContracts = await stubbedPublishedContracts()
		const installedCode = new Set<string>([ARACHNID_CREATE2_DEPLOYER_ADDRESS.toLowerCase()])
		const rpcCalls: { method: string; params: readonly unknown[] }[] = []
		let pendingCreation: Address | undefined
		const rpc = async (method: string, params: readonly unknown[]) => {
			rpcCalls.push({ method, params })
			if (method === 'eth_sendTransaction') {
				const request = params[0]
				if (typeof request !== 'object' || request === null || !('from' in request)) throw new Error('Unexpected creation request')
				const creator = String(request.from)
				const target = publishedContracts.find(contract => contract.install.creator === creator && !installedCode.has(contract.address.toLowerCase()))
				if (target === undefined) throw new Error(`No pending published contract for ${creator}`)
				pendingCreation = target.address
				return `0x${'3'.repeat(64)}`
			}
			return undefined
		}
		const client = asWriteClient({
			getCode: async ({ address }) => {
				if (address.toLowerCase() === ARACHNID_CREATE2_DEPLOYER_ADDRESS.toLowerCase()) return ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE
				return installedCode.has(address.toLowerCase()) ? '0x01' : '0x'
			},
			waitForTransactionReceipt: async () => {
				if (pendingCreation === undefined) throw new Error('No pending creation')
				installedCode.add(pendingCreation.toLowerCase())
				const created = pendingCreation
				return created === SEPOLIA_UNISWAP.uniswapV4QuoterAddress ? successReceipt() : { ...successReceipt(), contractAddress: created }
			},
		})
		const installed = await ensurePublishedContracts(client, rpc, SEPOLIA_CHAIN_ID, publishedContracts)
		expect(installed).toEqual(['weth', 'uniswapV3Factory', 'uniswapV3Quoter', 'uniswapV4PoolManager', 'uniswapV4Quoter'])
		expect(rpcCalls[0]?.method).toBe('anvil_nodeInfo')
		expect(rpcCalls.slice(1, 6).map(call => call.method)).toEqual(['anvil_impersonateAccount', 'anvil_setBalance', 'anvil_setNonce', 'eth_sendTransaction', 'anvil_stopImpersonatingAccount'])
		expect(rpcCalls[3]?.params).toEqual(['0x3344BBDCeb8f6fb52de759c127E4A44EFb40432A', '0x0'])
		expect(rpcCalls.filter(call => call.method === 'anvil_setNonce').map(call => call.params[1])).toEqual(['0x0', '0x1', '0xd', '0x5b'])
		const creations = rpcCalls.filter(call => call.method === 'eth_sendTransaction').map(call => call.params[0])
		expect(creations).toHaveLength(5)
		const create2Request = creations[4]
		if (typeof create2Request !== 'object' || create2Request === null || !('to' in create2Request) || !('data' in create2Request) || !('from' in create2Request)) throw new Error('Expected a CREATE2 deployer request')
		expect(create2Request.to).toBe(ARACHNID_CREATE2_DEPLOYER_ADDRESS)
		expect(String(create2Request.data).startsWith('0x0000000000000000000000000000000000000000000000000000000000000080')).toBe(true)
		expect(create2Request.from).toBe('0x7024cc7e60D6560f0B5877DA2bb921FCbF1f4375')
		expect(rpcCalls[rpcCalls.length - 3]?.method).toBe('anvil_setBalance')
	})

	test('rejects a replayed creation that lands somewhere other than the published address', async () => {
		const { publishedContracts } = await getUniswapDeployment(SEPOLIA_CHAIN_ID)
		const client = asWriteClient({
			getCode: async () => '0x',
			waitForTransactionReceipt: async () => ({ ...successReceipt(), contractAddress: getAddress('0x00000000000000000000000000000000000000bb') }),
		})
		await expect(ensurePublishedContracts(client, async (method: string) => (method === 'eth_sendTransaction' ? `0x${'4'.repeat(64)}` : undefined), SEPOLIA_CHAIN_ID, publishedContracts)).rejects.toThrow('Wrapped Ether was created at 0x00000000000000000000000000000000000000bb instead of the published address')
	})

	test('waits for a concurrent canonical CREATE2 deployer transaction', async () => {
		const step = (await getUniswapDeployment(SEPOLIA_CHAIN_ID)).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
		if (step === undefined) throw new Error('Expected canonical CREATE2 deployer step')
		let installed = false
		let rawBroadcastCalled = false
		let accountedRawTransactions = 0
		const client = asWriteClient({
			assertCanonicalRawTransactionCost: () => undefined,
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => (installed ? ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE : undefined),
			getTransactionCount: async parameters => (parameters.blockTag === 'pending' ? 1n : 0n),
			recordCanonicalRawTransaction: () => {
				accountedRawTransactions += 1
			},
			sendRawTransaction: async () => {
				rawBroadcastCalled = true
				return `0x${'1'.repeat(64)}` as Hash
			},
			sendTransaction: async () => {
				throw new Error('Funding should not be sent')
			},
			waitForTransactionReceipt: async () => {
				installed = true
				return successReceipt()
			},
		})

		expect(await step.deploy(client)).not.toBe(`0x${'0'.repeat(64)}`)
		expect(installed).toBe(true)
		expect(rawBroadcastCalled).toBe(false)
		expect(accountedRawTransactions).toBe(1)
	})

	test('retries CREATE2 deployer code verification when RPC state lags the confirmed receipt', async () => {
		const retryDelays: number[] = []
		const step = (
			await getUniswapDeployment(SEPOLIA_CHAIN_ID, async delayMilliseconds => {
				retryDelays.push(delayMilliseconds)
			})
		).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
		if (step === undefined) throw new Error('Expected canonical CREATE2 deployer step')
		let codeReadCount = 0
		const client = asWriteClient({
			assertCanonicalRawTransactionCost: () => undefined,
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => {
				codeReadCount += 1
				return codeReadCount < 3 ? undefined : ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE
			},
			getTransactionCount: async parameters => (parameters.blockTag === 'pending' ? 1n : 0n),
			recordCanonicalRawTransaction: () => undefined,
			waitForTransactionReceipt: async () => successReceipt(),
		})

		expect(await step.deploy(client)).not.toBe(`0x${'0'.repeat(64)}`)
		expect(retryDelays).toEqual([250])
	})

	test('accepts an already-known canonical CREATE2 deployer broadcast race', async () => {
		const step = (await getUniswapDeployment(SEPOLIA_CHAIN_ID)).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
		if (step === undefined) throw new Error('Expected canonical CREATE2 deployer step')
		let installed = false
		let pending = false
		let accountedRawTransactions = 0
		const client = asWriteClient({
			assertCanonicalRawTransactionCost: () => undefined,
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => (installed ? ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE : undefined),
			getTransactionCount: async parameters => (pending && parameters.blockTag === 'pending' ? 1n : 0n),
			recordCanonicalRawTransaction: () => {
				accountedRawTransactions += 1
			},
			sendRawTransaction: async () => {
				pending = true
				throw new Error('already known')
			},
			sendTransaction: async () => {
				throw new Error('Funding should not be sent')
			},
			waitForTransactionReceipt: async () => {
				pending = false
				installed = true
				return successReceipt()
			},
		})

		expect(await step.deploy(client)).not.toBe(`0x${'0'.repeat(64)}`)
		expect(installed).toBe(true)
		expect(accountedRawTransactions).toBe(1)
	})

	test('accepts a canonical CREATE2 deployment that confirms before its broadcast returns', async () => {
		const step = (await getUniswapDeployment(SEPOLIA_CHAIN_ID)).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
		if (step === undefined) throw new Error('Expected canonical CREATE2 deployer step')
		let installed = false
		const client = asWriteClient({
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => (installed ? ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE : undefined),
			getTransactionCount: async () => 0n,
			sendRawTransaction: async () => {
				installed = true
				throw new Error('nonce too low')
			},
			sendTransaction: async () => {
				throw new Error('Funding should not be sent')
			},
			waitForTransactionReceipt: async () => {
				throw new Error('An already confirmed deployment should not be awaited')
			},
		})

		expect(await step.deploy(client)).not.toBe(`0x${'0'.repeat(64)}`)
	})

	test('retries stale CREATE2 code after a broadcast reports an already-confirmed nonce', async () => {
		const retryDelays: number[] = []
		const step = (
			await getUniswapDeployment(SEPOLIA_CHAIN_ID, async delayMilliseconds => {
				retryDelays.push(delayMilliseconds)
			})
		).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
		if (step === undefined) throw new Error('Expected canonical CREATE2 deployer step')
		let confirmed = false
		let codeReadCount = 0
		const client = asWriteClient({
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => {
				codeReadCount += 1
				return codeReadCount < 6 ? undefined : ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE
			},
			getTransactionCount: async () => (confirmed ? 1n : 0n),
			recordCanonicalRawTransaction: () => undefined,
			sendRawTransaction: async () => {
				confirmed = true
				throw new Error('nonce too low')
			},
			sendTransaction: async () => {
				throw new Error('Funding should not be sent')
			},
			waitForTransactionReceipt: async () => {
				throw new Error('An already confirmed deployment should not be awaited')
			},
		})

		expect(await step.deploy(client)).not.toBe(`0x${'0'.repeat(64)}`)
		expect(retryDelays).toEqual([250])
	})

	test('accepts delayed CREATE2 code after its signer nonce was already confirmed', async () => {
		const retryDelays: number[] = []
		const step = (
			await getUniswapDeployment(SEPOLIA_CHAIN_ID, async delayMilliseconds => {
				retryDelays.push(delayMilliseconds)
			})
		).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
		if (step === undefined) throw new Error('Expected canonical CREATE2 deployer step')
		let codeReadCount = 0
		let transactionSubmitted = false
		const client = asWriteClient({
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => {
				codeReadCount += 1
				return codeReadCount < 4 ? undefined : ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE
			},
			getTransactionCount: async () => 1n,
			recordCanonicalRawTransaction: () => undefined,
			sendRawTransaction: async () => {
				transactionSubmitted = true
				return `0x${'1'.repeat(64)}` as Hash
			},
			sendTransaction: async () => {
				transactionSubmitted = true
				return `0x${'2'.repeat(64)}` as Hash
			},
			waitForTransactionReceipt: async () => successReceipt(),
		})

		expect(await step.deploy(client)).not.toBe(`0x${'0'.repeat(64)}`)
		expect(retryDelays).toEqual([250])
		expect(transactionSubmitted).toBe(false)
	})

	test('rejects unexpected code installed during a canonical CREATE2 deployer broadcast race', async () => {
		const step = (await getUniswapDeployment(SEPOLIA_CHAIN_ID)).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
		if (step === undefined) throw new Error('Expected canonical CREATE2 deployer step')
		let code: Hex | undefined
		const client = asWriteClient({
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => code,
			getTransactionCount: async () => 0n,
			sendRawTransaction: async () => {
				code = '0x1234'
				throw new Error('nonce too low')
			},
			sendTransaction: async () => {
				throw new Error('Funding should not be sent')
			},
			waitForTransactionReceipt: async () => successReceipt(),
		})

		await expect(step.deploy(client)).rejects.toThrow('Unexpected code at canonical CREATE2 deployer')
	})

	test('rejects an incompatible canonical raw gas price without funding', async () => {
		const step = (await getUniswapDeployment(SEPOLIA_CHAIN_ID)).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
		if (step === undefined) throw new Error('Expected canonical CREATE2 deployer step')
		let writeCalled = false
		const client = asWriteClient({
			getBalance: async () => 0n,
			getBlock: async () => ({ baseFeePerGas: 100_000_000_001n }) as never,
			getCode: async () => undefined,
			getTransactionCount: async () => 0n,
			sendRawTransaction: async () => {
				writeCalled = true
				return `0x${'1'.repeat(64)}` as Hash
			},
			sendTransaction: async () => {
				writeCalled = true
				return `0x${'2'.repeat(64)}` as Hash
			},
			waitForTransactionReceipt: async () => successReceipt(),
		})

		await expect(step.deploy(client)).rejects.toThrow('below the current base fee')
		expect(writeCalled).toBe(false)
	})

	test('tests canonical raw-transaction policy before CREATE2 signer funding', async () => {
		const step = (await getUniswapDeployment(SEPOLIA_CHAIN_ID)).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
		if (step === undefined) throw new Error('Expected canonical CREATE2 deployer step')
		let fundingCalled = false
		const client = asWriteClient({
			getBalance: async () => 0n,
			getCode: async () => undefined,
			getTransactionCount: async () => 0n,
			sendRawTransaction: async () => {
				throw new Error('only replay-protected transactions allowed over RPC')
			},
			sendTransaction: async () => {
				fundingCalled = true
				return `0x${'2'.repeat(64)}` as Hash
			},
			waitForTransactionReceipt: async () => successReceipt(),
		})

		await expect(step.deploy(client)).rejects.toThrow('before signer funding')
		expect(fundingCalled).toBe(false)
	})

	test('retries delayed CREATE2 code when deployment confirms during signer funding', async () => {
		let codeVisible = false
		let funded = false
		let rawBroadcastCount = 0
		const retryDelays: number[] = []
		const step = (
			await getUniswapDeployment(SEPOLIA_CHAIN_ID, async delayMilliseconds => {
				retryDelays.push(delayMilliseconds)
				codeVisible = true
			})
		).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
		if (step === undefined) throw new Error('Expected canonical CREATE2 deployer step')
		const client = asWriteClient({
			getBalance: async () => (funded ? 10_000_000_000_000_000n : 0n),
			getCode: async () => (codeVisible ? ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE : undefined),
			getTransactionCount: async () => (funded ? 1n : 0n),
			recordCanonicalRawTransaction: () => undefined,
			sendRawTransaction: async () => {
				rawBroadcastCount += 1
				throw new Error('insufficient funds for gas')
			},
			sendTransaction: async () => {
				funded = true
				return `0x${'2'.repeat(64)}` as Hash
			},
			waitForTransactionReceipt: async () => successReceipt(),
		})

		expect(await step.deploy(client)).not.toBe(`0x${'0'.repeat(64)}`)
		expect(retryDelays).toEqual([250])
		expect(rawBroadcastCount).toBe(1)
	})

	test('enforces CREATE2 raw-transaction cost authorization before broadcast', async () => {
		const step = (await getUniswapDeployment(SEPOLIA_CHAIN_ID)).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
		if (step === undefined) throw new Error('Expected canonical CREATE2 deployer step')
		let writeCalled = false
		const client = asWriteClient({
			assertCanonicalRawTransactionCost: () => {
				throw new Error('would exceed the authorized deployment total')
			},
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => undefined,
			getTransactionCount: async () => 0n,
			sendRawTransaction: async () => {
				writeCalled = true
				return `0x${'1'.repeat(64)}` as Hash
			},
			sendTransaction: async () => {
				writeCalled = true
				return `0x${'2'.repeat(64)}` as Hash
			},
			waitForTransactionReceipt: async () => successReceipt(),
		})

		await expect(step.deploy(client)).rejects.toThrow('would exceed the authorized deployment total')
		expect(writeCalled).toBe(false)
	})
})

test('bot defaults match the Sepolia deployment plan on Sepolia and on custom chains that replay it', async () => {
	const deployment = await getUniswapDeployment(SEPOLIA_CHAIN_ID)
	for (const chainId of [SEPOLIA_CHAIN_ID, CUSTOM_CHAIN_ID]) {
		expect(canonicalUniswapDeployment(chainId)).toEqual({
			factory: deployment.addresses.uniswapV3FactoryAddress,
			quoter: deployment.addresses.uniswapV3QuoterAddress,
			router: deployment.addresses.uniswapV3SwapRouterAddress,
			v2Router: undefined,
			v4PoolManager: deployment.addresses.uniswapV4PoolManagerAddress,
			v4Quoter: deployment.addresses.uniswapV4QuoterAddress,
		})
	}
	expect(canonicalUniswapDeployment(1).v2Router).toBe(getAddress('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'))
})

test('UI Sepolia pricing uses the same published Uniswap contracts as the bots', async () => {
	expect(SEPOLIA_CHAIN_ID).toBe(SEPOLIA_NETWORK_PROFILE.chain.id)
	expect(SEPOLIA_CHAIN_ID).toBe(11155111)
	const { addresses } = await getUniswapDeployment(SEPOLIA_CHAIN_ID)
	expect(SEPOLIA_NETWORK_PROFILE.uniswapV3FactoryAddress).toBe(addresses.uniswapV3FactoryAddress)
	expect(SEPOLIA_NETWORK_PROFILE.uniswapV3QuoterAddress).toBe(addresses.uniswapV3QuoterAddress)
	expect(SEPOLIA_NETWORK_PROFILE.uniswapV4QuoterAddress).toBe(addresses.uniswapV4QuoterAddress)
})
