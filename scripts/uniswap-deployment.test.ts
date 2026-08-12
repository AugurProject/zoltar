import { describe, expect, test } from 'bun:test'
import { concatHex, getAddress, type Hash, type Hex, type TransactionReceipt } from '@zoltar/shared/ethereum'
import { SEPOLIA_NETWORK_PROFILE } from '../ui/ts/lib/networkProfile.ts'
import type { WriteClient } from '../ui/ts/lib/chainBackend.ts'
import { ARACHNID_CREATE2_DEPLOYER_ADDRESS, ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE, PERMIT2_ADDRESS, assertPermit2ImmutableValues, assertUniswapDeploymentArtifact, getUniswapDeployment, resolveCanonicalCreate2DeployerForPreflight } from './uniswap-deployment.mts'

const WETH = getAddress('0x65156FD21726b8efcB627fa38c506E3f3542F601')

function asWriteClient(client: Partial<WriteClient>): WriteClient {
	return {
		getBlock: async () => ({ baseFeePerGas: 1n }) as never,
		...client,
	} as WriteClient
}

function successReceipt(): TransactionReceipt {
	return { ...({} as TransactionReceipt), status: 'success' }
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
		const artifact = await Bun.file(new URL('./artifacts/uniswap-deployment.json', import.meta.url)).text()
		expect(() => assertUniswapDeploymentArtifact(artifact.replaceAll('\n', '\r\n'))).not.toThrow()
	})

	test('rejects a changed deployment artifact before constructing a plan', async () => {
		const artifact = await Bun.file(new URL('./artifacts/uniswap-deployment.json', import.meta.url)).text()
		const changedArtifact = artifact.replace('"uniswapV3Factory": "0x60', '"uniswapV3Factory": "0x61')
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

	test('builds the complete deterministic core and quoting dependency graph', async () => {
		const deployment = await getUniswapDeployment(WETH)
		expect(deployment.steps.map(step => step.id)).toEqual(['arachnidCreate2Deployer', 'permit2', 'uniswapV3Factory', 'uniswapV3Quoter', 'uniswapV3SwapRouter', 'uniswapV4PoolManager', 'uniswapV4Quoter'])
		expect(deployment.steps.map(step => step.dependencies)).toEqual([[], ['arachnidCreate2Deployer'], ['proxyDeployer'], ['proxyDeployer', 'uniswapV3Factory'], ['proxyDeployer', 'uniswapV3Factory'], ['proxyDeployer'], ['proxyDeployer', 'uniswapV4PoolManager']])
		expect(new Set(deployment.steps.map(step => step.address)).size).toBe(deployment.steps.length)
		const addressById = new Map(deployment.steps.map(step => [step.id, step.address]))
		expect(addressById.get('arachnidCreate2Deployer')).toBe(ARACHNID_CREATE2_DEPLOYER_ADDRESS)
		expect(addressById.get('permit2')).toBe(PERMIT2_ADDRESS)
		expect(addressById.get('uniswapV3Factory')).toBe(deployment.addresses.uniswapV3FactoryAddress)
		expect(addressById.get('uniswapV3Quoter')).toBe(deployment.addresses.uniswapV3QuoterAddress)
		expect(addressById.get('uniswapV3SwapRouter')).toBe(deployment.addresses.uniswapV3SwapRouterAddress)
		expect(addressById.get('uniswapV4PoolManager')).toBe(deployment.addresses.uniswapV4PoolManagerAddress)
		expect(addressById.get('uniswapV4Quoter')).toBe(deployment.addresses.uniswapV4QuoterAddress)
		expect(deployment.addresses).toEqual({
			arachnidCreate2DeployerAddress: getAddress('0x4e59b44847b379578588920cA78FbF26c0B4956C'),
			permit2Address: getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3'),
			uniswapV3FactoryAddress: getAddress('0xEf09Be426F8d6D2786cADEA7D3A8b0D09cEB79B4'),
			uniswapV3QuoterAddress: getAddress('0x6Aa53e5023fFDa81f7EEE31bdA5D35437A5DD841'),
			uniswapV3SwapRouterAddress: getAddress('0xC0a0e58Ae39603398D474BFd49d2904dE1464C99'),
			uniswapV4PoolManagerAddress: getAddress('0x9C27Fce9ad85dE98C7e95031Bf3F0B3D2CD677ad'),
			uniswapV4QuoterAddress: getAddress('0x29322b72F451C5f4eba5b3C862C76896470c059A'),
		})
		expect(deployment.addresses.uniswapV3FactoryAddress).not.toBe(SEPOLIA_NETWORK_PROFILE.uniswapV3FactoryAddress)
		expect(deployment.addresses.uniswapV3QuoterAddress).not.toBe(SEPOLIA_NETWORK_PROFILE.uniswapV3QuoterAddress)
		expect(deployment.addresses.uniswapV3SwapRouterAddress).not.toBe(SEPOLIA_NETWORK_PROFILE.uniswapV3QuoterAddress)
		expect(deployment.addresses.uniswapV4QuoterAddress).not.toBe(SEPOLIA_NETWORK_PROFILE.uniswapV4QuoterAddress)
	})

	test('keeps core addresses stable while binding the V3 quoter to the selected WETH', async () => {
		const first = await getUniswapDeployment(WETH)
		const second = await getUniswapDeployment(getAddress('0x0000000000000000000000000000000000000001'))
		expect(second.addresses.uniswapV3FactoryAddress).toBe(first.addresses.uniswapV3FactoryAddress)
		expect(second.addresses.uniswapV4PoolManagerAddress).toBe(first.addresses.uniswapV4PoolManagerAddress)
		expect(second.addresses.uniswapV4QuoterAddress).toBe(first.addresses.uniswapV4QuoterAddress)
		expect(second.addresses.uniswapV3QuoterAddress).not.toBe(first.addresses.uniswapV3QuoterAddress)
		expect(second.addresses.uniswapV3SwapRouterAddress).not.toBe(first.addresses.uniswapV3SwapRouterAddress)
	})

	test('waits for a concurrent canonical CREATE2 deployer transaction', async () => {
		const step = (await getUniswapDeployment(WETH)).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
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
			await getUniswapDeployment(WETH, async delayMilliseconds => {
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
		const step = (await getUniswapDeployment(WETH)).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
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
		const step = (await getUniswapDeployment(WETH)).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
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
			await getUniswapDeployment(WETH, async delayMilliseconds => {
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
			await getUniswapDeployment(WETH, async delayMilliseconds => {
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
		const step = (await getUniswapDeployment(WETH)).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
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
		const step = (await getUniswapDeployment(WETH)).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
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
		const step = (await getUniswapDeployment(WETH)).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
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
			await getUniswapDeployment(WETH, async delayMilliseconds => {
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
		const step = (await getUniswapDeployment(WETH)).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
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
