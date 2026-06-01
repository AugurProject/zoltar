/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { type Address, type Hash, getAddress } from 'viem'
import {
	getDeploymentSteps,
	loadDeploymentStatusOracleSnapshot,
	loadErc20Allowance,
	loadErc20Balance,
} from '../contracts.js'
import { getGenesisReputationTokenAddress } from '../lib/universe.js'

type MockWriteClient = {
	getCode: (request: { address: Address }) => Promise<`0x${string}` | undefined>
	sendTransaction: (request: { to?: Address | null | undefined; data?: `0x${string}` | undefined; value?: bigint | undefined }) => Promise<Hash>
	waitForTransactionReceipt: (request: { hash: Hash }) => Promise<{ status: 'success' | 'reverted' }>
	sendRawTransaction?: (request: { serializedTransaction: `0x${string}` }) => Promise<Hash>
	installSimulationProxyDeployer?: (request: { address: Address; runtimeCode: `0x${string}` }) => Promise<void>
	patchSimulationGenesisRepToken?: (request: { repAddress: Address; zoltarAddress: Address }) => Promise<void>
}

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'

function createDeploymentSteps() {
	return getDeploymentSteps()
}

function createMockReadClient(responses: {
	getCode: (request: { address: Address }) => Promise<`0x${string}` | undefined>
	readContract?: (request: { functionName: string }) => Promise<unknown>
}) {
	return {
		getCode: responses.getCode,
		readContract: responses.readContract ?? (async () => {
			throw new Error('readContract should be mocked')
		}),
	}
}

describe('contract deployment internals', () => {
	test('loadDeploymentStatusOracleSnapshot reads deployment mask when the status oracle is deployed', async () => {
		const deploymentSteps = createDeploymentSteps()
		const oracleStep = deploymentSteps.find(step => step.id === 'deploymentStatusOracle')
		if (oracleStep === undefined) throw new Error('Expected deploymentStatusOracle step')
		const proxyStep = deploymentSteps.find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')

		const readContractCalls: string[] = []
		const readClient = createMockReadClient({
			getCode: async ({ address }) => {
				if (address === oracleStep.address) return '0x1234'
				if (address === proxyStep.address) return '0x1234'
				throw new Error(`Unexpected getCode address: ${address}`)
			},
			readContract: async ({ functionName }) => {
				readContractCalls.push(functionName)
				if (functionName === 'getDeploymentMask') return 5n
				throw new Error(`Unexpected readContract call: ${functionName}`)
			},
		})

		const snapshot = await loadDeploymentStatusOracleSnapshot(readClient)

		expect(readContractCalls).toEqual(['getDeploymentMask'])
		expect(snapshot.augurPlaceHolderDeployed).toBe(false)
		expect(snapshot.deploymentStatuses.find(step => step.id === 'proxyDeployer')?.deployed).toBe(true)
		expect(snapshot.deploymentStatuses.find(step => step.id === 'deploymentStatusOracle')?.deployed).toBe(true)
		expect(snapshot.deploymentStatuses.find(step => step.id === 'multicall3')?.deployed).toBe(false)
		expect(snapshot.deploymentStatuses.find(step => step.id === 'uniformPriceDualCapBatchAuctionFactory')?.deployed).toBe(true)
	})

	test('deployViaProxy-backed steps execute with a transaction through the proxy deployer', async () => {
		const steps = createDeploymentSteps()
		const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
		if (oracleStep === undefined) throw new Error('Expected deploymentStatusOracle step')
		const factoryStep = steps.find(step => step.id === 'securityPoolFactory')
		if (factoryStep === undefined) throw new Error('Expected securityPoolFactory step')

		let capturedProxyDeployData: `0x${string}` | undefined
		let capturedFactoryData: `0x${string}` | undefined
		const txHash = `0x${'7'.repeat(64)}` as Hash
		const client = {
			getCode: async () => '0x1234',
			sendTransaction: async request => {
				if (capturedProxyDeployData === undefined) {
					capturedProxyDeployData = request.data
				} else {
					capturedFactoryData = request.data
				}
				return txHash
			},
			waitForTransactionReceipt: async () => ({ status: 'success' }),
		} as MockWriteClient

		const oracleHash = await oracleStep.deploy(client)
		const factoryHash = await factoryStep.deploy(client)

		expect(capturedProxyDeployData).toBeDefined()
		expect(capturedFactoryData).toBeDefined()
		expect(oracleHash).toBe(txHash)
		expect(factoryHash).toBe(txHash)
	})

	test('proxy deployer step returns zero hash when signer-based deploy is already installed', async () => {
		const steps = createDeploymentSteps()
		const proxyStep = steps.find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let sendTransactionCallCount = 0
		let sendRawTransactionCallCount = 0

		const client = {
			getCode: async () => '0x1234',
			sendTransaction: async () => {
				sendTransactionCallCount += 1
				return `0x${'9'.repeat(64)}` as Hash
			},
			waitForTransactionReceipt: async () => ({ status: 'success' }),
			sendRawTransaction: async () => {
				sendRawTransactionCallCount += 1
				return `0x${'a'.repeat(64)}` as Hash
			},
		} as MockWriteClient

		const hash = await proxyStep.deploy(client)

		expect(hash).toBe(ZERO_HASH)
		expect(sendTransactionCallCount).toBe(0)
		expect(sendRawTransactionCallCount).toBe(0)
	})

	test('proxy deployer step uses simulation deployer when available', async () => {
		const steps = createDeploymentSteps()
		const proxyStep = steps.find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let installCalled = false
		let funded = false

		const client = {
			getCode: async () => undefined,
			installSimulationProxyDeployer: async () => {
				installCalled = true
			},
			sendTransaction: async () => {
				funded = true
				return `0x${'b'.repeat(64)}` as Hash
			},
			waitForTransactionReceipt: async () => ({ status: 'success' }),
			sendRawTransaction: async () => {
				throw new Error('sendRawTransaction should not be called')
			},
		} as MockWriteClient

		const hash = await proxyStep.deploy(client)

		expect(installCalled).toBe(true)
		expect(hash).toBe(ZERO_HASH)
		expect(funded).toBe(false)
	})

	test('proxy deployer step funds signer and submits raw transaction when simulation helper is unavailable', async () => {
		const steps = createDeploymentSteps()
		const proxyStep = steps.find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		const seen: string[] = []
		const fundHash = `0x${'c'.repeat(64)}` as Hash
		const deployHash = `0x${'d'.repeat(64)}` as Hash

		const client = {
			getCode: async () => undefined,
			sendTransaction: async request => {
				seen.push(request.to ?? 'none')
				return request.value === undefined ? deployHash : fundHash
			},
			waitForTransactionReceipt: async () => ({ status: 'success' }),
			sendRawTransaction: async request => {
				seen.push(request.serializedTransaction)
				return deployHash
			},
		} as MockWriteClient

		const hash = await proxyStep.deploy(client)

		expect(hash).toBe(deployHash)
		expect(seen[0]).toBe(getAddress('0x4c8d290a1b368ac4728d83a9e8321fc3af2b39b1'))
		expect(seen[1]).toBe(
			'0xf87e8085174876e800830186a08080ad601f80600e600039806000f350fe60003681823780368234f58015156014578182fd5b80825250506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222',
		)
	})

	test('zoltar deployment step patches the Genesis REP token in simulation mode', async () => {
		const steps = createDeploymentSteps()
		const zoltarStep = steps.find(step => step.id === 'zoltar')
		if (zoltarStep === undefined) throw new Error('Expected zoltar step')
		let patchedParameters: { repAddress: Address; zoltarAddress: Address } | undefined

		const txHash = `0x${'e'.repeat(64)}` as Hash
		const client = {
			getCode: async () => '0x1234',
			sendTransaction: async () => txHash,
			waitForTransactionReceipt: async () => ({ status: 'success' }),
			patchSimulationGenesisRepToken: async ({ repAddress, zoltarAddress }) => {
				patchedParameters = {
					repAddress,
					zoltarAddress,
				}
			},
		} as MockWriteClient

		const hash = await zoltarStep.deploy(client)

		expect(hash).toBe(txHash)
		expect(patchedParameters).toEqual({
			repAddress: getGenesisReputationTokenAddress(),
			zoltarAddress: getAddress(steps.find(step => step.id === 'zoltar')?.address ?? '0x0000000000000000000000000000000000000000'),
		})
	})

	test('all deployable steps use the proxy deployer write path when executed', async () => {
		const steps = createDeploymentSteps()
		const txHash = `0x${'f'.repeat(64)}` as Hash
		const orderedStepIds = steps.map(step => step.id).filter(id => id !== 'proxyDeployer')

		for (const stepId of orderedStepIds) {
			const step = steps.find(candidate => candidate.id === stepId)
			if (step === undefined) throw new Error(`Expected step ${stepId}`)

			let seenData: `0x${string}` | undefined
			let seenAddress: Address | undefined
			const client = {
				getCode: async () => '0x1234',
				sendTransaction: async request => {
					seenData = request.data
					seenAddress = request.to
					return txHash
				},
				waitForTransactionReceipt: async () => ({ status: 'success' }),
			} as MockWriteClient

			const hash = await step.deploy(client)

			expect(hash).toBe(txHash)
			expect(seenData).toBeDefined()
			expect(seenAddress).not.toBeUndefined()
			expect(seenAddress?.length).toBe(42)
		}
	})

	test('ERC20 helper readers call the expected contract methods', async () => {
		const tokenAddress = getAddress('0x1111111111111111111111111111111111111111')
		const ownerAddress = getAddress('0x2222222222222222222222222222222222222222')
		const spenderAddress = getAddress('0x3333333333333333333333333333333333333333')
		const seen: Array<{ functionName: string; address: Address; args: readonly unknown[] }> = []
		const readClient = {
			getCode: async () => '0x',
			readContract: async request => {
				seen.push({
					address: request.address,
					args: request.args ?? [],
					functionName: request.functionName,
				})
				if (request.functionName === 'balanceOf') return 2_000n
				if (request.functionName === 'allowance') return 500n
				throw new Error(`Unexpected function name: ${request.functionName}`)
			},
		} as ReadClient

		expect(await loadErc20Balance(readClient, tokenAddress, ownerAddress)).toBe(2_000n)
		expect(await loadErc20Allowance(readClient, tokenAddress, ownerAddress, spenderAddress)).toBe(500n)
		expect(seen).toEqual([
			{
				functionName: 'balanceOf',
				address: tokenAddress,
				args: [ownerAddress],
			},
			{
				functionName: 'allowance',
				address: tokenAddress,
				args: [ownerAddress, spenderAddress],
			},
		])
	})
})
