import { describe, expect, test } from 'bun:test'
import { getAddress, type Hash, type Hex, type TransactionReceipt } from '@zoltar/shared/ethereum'
import { SEPOLIA_NETWORK_PROFILE } from '../ui/ts/lib/networkProfile.ts'
import type { WriteClient } from '../ui/ts/lib/chainBackend.ts'
import { ARACHNID_CREATE2_DEPLOYER_ADDRESS, ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE, PERMIT2_ADDRESS, getUniswapDeployment } from './uniswap-deployment.mts'

const WETH = getAddress('0x65156FD21726b8efcB627fa38c506E3f3542F601')

function asWriteClient(client: Partial<WriteClient>): WriteClient {
	return client as WriteClient
}

function successReceipt(): TransactionReceipt {
	return { ...({} as TransactionReceipt), status: 'success' }
}

describe('Uniswap testnet deployment', () => {
	test('builds the complete deterministic core and quoting dependency graph', async () => {
		const deployment = await getUniswapDeployment(WETH)
		expect(deployment.steps.map(step => step.id)).toEqual(['arachnidCreate2Deployer', 'permit2', 'uniswapV3Factory', 'uniswapV3Quoter', 'uniswapV4PoolManager', 'uniswapV4Quoter'])
		expect(deployment.steps.map(step => step.dependencies)).toEqual([[], ['arachnidCreate2Deployer'], ['proxyDeployer'], ['proxyDeployer', 'uniswapV3Factory'], ['proxyDeployer'], ['proxyDeployer', 'uniswapV4PoolManager']])
		expect(new Set(deployment.steps.map(step => step.address)).size).toBe(deployment.steps.length)
		const addressById = new Map(deployment.steps.map(step => [step.id, step.address]))
		expect(addressById.get('arachnidCreate2Deployer')).toBe(ARACHNID_CREATE2_DEPLOYER_ADDRESS)
		expect(addressById.get('permit2')).toBe(PERMIT2_ADDRESS)
		expect(addressById.get('uniswapV3Factory')).toBe(deployment.addresses.uniswapV3FactoryAddress)
		expect(addressById.get('uniswapV3Quoter')).toBe(deployment.addresses.uniswapV3QuoterAddress)
		expect(addressById.get('uniswapV4PoolManager')).toBe(deployment.addresses.uniswapV4PoolManagerAddress)
		expect(addressById.get('uniswapV4Quoter')).toBe(deployment.addresses.uniswapV4QuoterAddress)
		expect(deployment.addresses.uniswapV3FactoryAddress).toBe(SEPOLIA_NETWORK_PROFILE.uniswapV3FactoryAddress)
		expect(deployment.addresses.uniswapV3QuoterAddress).toBe(SEPOLIA_NETWORK_PROFILE.uniswapV3QuoterAddress)
		expect(deployment.addresses.uniswapV4QuoterAddress).toBe(SEPOLIA_NETWORK_PROFILE.uniswapV4QuoterAddress)
	})

	test('keeps core addresses stable while binding the V3 quoter to the selected WETH', async () => {
		const first = await getUniswapDeployment(WETH)
		const second = await getUniswapDeployment(getAddress('0x0000000000000000000000000000000000000001'))
		expect(second.addresses.uniswapV3FactoryAddress).toBe(first.addresses.uniswapV3FactoryAddress)
		expect(second.addresses.uniswapV4PoolManagerAddress).toBe(first.addresses.uniswapV4PoolManagerAddress)
		expect(second.addresses.uniswapV4QuoterAddress).toBe(first.addresses.uniswapV4QuoterAddress)
		expect(second.addresses.uniswapV3QuoterAddress).not.toBe(first.addresses.uniswapV3QuoterAddress)
	})

	test('waits for a concurrent canonical CREATE2 deployer transaction', async () => {
		const step = (await getUniswapDeployment(WETH)).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
		if (step === undefined) throw new Error('Expected canonical CREATE2 deployer step')
		let installed = false
		let rawBroadcastCalled = false
		const client = asWriteClient({
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => (installed ? ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE : undefined),
			getTransactionCount: async parameters => (parameters.blockTag === 'pending' ? 1n : 0n),
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
	})

	test('accepts an already-known canonical CREATE2 deployer broadcast race', async () => {
		const step = (await getUniswapDeployment(WETH)).steps.find(candidate => candidate.id === 'arachnidCreate2Deployer')
		if (step === undefined) throw new Error('Expected canonical CREATE2 deployer step')
		let installed = false
		let pending = false
		const client = asWriteClient({
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => (installed ? ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE : undefined),
			getTransactionCount: async parameters => (pending && parameters.blockTag === 'pending' ? 1n : 0n),
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
})
