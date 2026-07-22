/// <reference types='bun-types' />

import { describe, expect, mock, test } from 'bun:test'
import { type Address, type Hash, type TransactionReceipt, getAddress } from '@zoltar/shared/ethereum'
import { getDeploymentSteps, loadDeploymentStatusOracleSnapshot, loadErc20Allowance, loadErc20Balance } from '../../protocol/index.js'
import { getGenesisReputationTokenAddress } from '../../protocol/activeProtocolAddresses.js'
import type { ReadClient, WriteClient } from '../../types/contracts.js'
import { installActiveEnvironmentForTesting } from '../../lib/activeEnvironment.js'
import { createInitialTransactionTrayState, markTransactionPrepared, markTransactionRequested } from '../../lib/transactionTray.js'
import { createFakeBackend, createFakeSimulationProfile } from '../testUtils/fakeBackend.js'

type MockReadClient = Pick<ReadClient, 'getCode' | 'readContract'>
type MockWriteClient = Pick<WriteClient, 'getCode' | 'sendTransaction' | 'waitForTransactionReceipt'> & Partial<Pick<WriteClient, 'sendRawTransaction' | 'installSimulationProxyDeployer' | 'onTransactionPrepared' | 'onTransactionSubmitted' | 'patchSimulationGenesisRepToken' | 'requiresWalletConfirmation'>>

function asWriteClient(client: MockWriteClient): WriteClient {
	return client as unknown as WriteClient
}

function hashReceipt(status: TransactionReceipt['status']): TransactionReceipt {
	return { ...({} as TransactionReceipt), status }
}

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as const

function createDeploymentSteps() {
	return getDeploymentSteps()
}

function createMockReadClient({ getCode, readContract }: { getCode: MockReadClient['getCode']; readContract?: MockReadClient['readContract'] }) {
	return {
		getCode,
		readContract:
			readContract ??
			(async () => {
				throw new Error('readContract should be mocked')
			}),
	} as MockReadClient
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
				if (functionName === 'getDeploymentMask') return 5n as never
				throw new Error(`Unexpected readContract call: ${functionName}`)
			},
		})

		const snapshot = await loadDeploymentStatusOracleSnapshot(readClient as ReadClient)

		expect(readContractCalls).toEqual(['getDeploymentMask'])
		expect(snapshot.augurStatoblastDeployed).toBe(false)
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
		const preparedFunctions: string[] = []
		const txHash = `0x${'7'.repeat(64)}` as Hash
		const client = asWriteClient({
			getCode: async () => '0x1234',
			onTransactionPrepared: preview => {
				preparedFunctions.push(preview.functionName)
				expect(preview.data).toBeDefined()
				expect(preview.to).toBeDefined()
				expect(preview.toLabel).toBe('Proxy deployer')
			},
			sendTransaction: async request => {
				if (capturedProxyDeployData === undefined) {
					capturedProxyDeployData = request.data
				} else {
					capturedFactoryData = request.data
				}
				return txHash
			},
			waitForTransactionReceipt: async () => hashReceipt('success'),
		})

		const oracleHash = await oracleStep.deploy(client)
		const factoryHash = await factoryStep.deploy(client)

		expect(capturedProxyDeployData).toBeDefined()
		expect(capturedFactoryData).toBeDefined()
		expect(oracleHash).toBe(txHash)
		expect(factoryHash).toBe(txHash)
		expect(preparedFunctions).toEqual(['Deploy contract through deterministic proxy', 'Deploy contract through deterministic proxy'])
	})

	test('deployViaProxy-backed steps inherit simulation prepared-transaction copy from the write client', async () => {
		const steps = createDeploymentSteps()
		const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
		if (oracleStep === undefined) throw new Error('Expected deploymentStatusOracle step')
		let preparedPreview: Parameters<NonNullable<WriteClient['onTransactionPrepared']>>[0] | undefined
		const txHash = `0x${'8'.repeat(64)}` as Hash
		const client = asWriteClient({
			getCode: async () => '0x1234',
			onTransactionPrepared: preview => {
				preparedPreview = preview
			},
			requiresWalletConfirmation: false,
			sendTransaction: async () => txHash,
			waitForTransactionReceipt: async () => hashReceipt('success'),
		})

		await oracleStep.deploy(client)

		expect(preparedPreview?.functionName).toBe('Deploy contract through deterministic proxy')
		expect(preparedPreview?.requiresWalletConfirmation).toBe(false)
	})

	test('deployViaProxy-backed steps return the replacement hash when repriced in the wallet', async () => {
		const steps = createDeploymentSteps()
		const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
		if (oracleStep === undefined) throw new Error('Expected deploymentStatusOracle step')
		const originalHash = `0x${'1'.repeat(64)}` as Hash
		const replacementHash = `0x${'2'.repeat(64)}` as Hash
		const onTransactionSubmitted = mock(() => undefined)
		const client = asWriteClient({
			getCode: async () => '0x1234',
			onTransactionSubmitted,
			sendTransaction: async () => originalHash,
			waitForTransactionReceipt: async parameters => {
				parameters.onReplaced?.({
					reason: 'repriced',
					replacedTransaction: { hash: originalHash } as never,
					transaction: { hash: replacementHash } as never,
					transactionReceipt: hashReceipt('success'),
				})
				return hashReceipt('success')
			},
		})

		const hash = await oracleStep.deploy(client)

		expect(hash).toBe(replacementHash)
		expect(onTransactionSubmitted).toHaveBeenCalledWith(replacementHash)
	})

	test('deployViaProxy-backed steps reject cancelled replacement transactions', async () => {
		const steps = createDeploymentSteps()
		const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
		if (oracleStep === undefined) throw new Error('Expected deploymentStatusOracle step')
		const originalHash = `0x${'3'.repeat(64)}` as Hash
		const replacementHash = `0x${'4'.repeat(64)}` as Hash
		const onTransactionSubmitted = mock(() => undefined)
		const client = asWriteClient({
			getCode: async () => '0x1234',
			onTransactionSubmitted,
			sendTransaction: async () => originalHash,
			waitForTransactionReceipt: async parameters => {
				parameters.onReplaced?.({
					reason: 'cancelled',
					replacedTransaction: { hash: originalHash } as never,
					transaction: { hash: replacementHash } as never,
					transactionReceipt: hashReceipt('success'),
				})
				return hashReceipt('success')
			},
		})

		await expect(oracleStep.deploy(client)).rejects.toThrow('Transaction was cancelled in the wallet before confirmation.')
		expect(onTransactionSubmitted).toHaveBeenCalledWith(replacementHash)
	})

	test('simulation deployViaProxy preview keeps the transaction tray in preparing state', async () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: createFakeSimulationProfile() }))
		try {
			const steps = createDeploymentSteps()
			const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
			if (oracleStep === undefined) throw new Error('Expected deploymentStatusOracle step')
			let transactionState = markTransactionRequested(createInitialTransactionTrayState(), {
				action: 'deploy',
				source: 'deployment',
				submittedDetail: 'Transaction submitted.',
				submittedTitle: `Deploying ${oracleStep.label}`,
			})
			const txHash = `0x${'6'.repeat(64)}` as Hash
			const client = asWriteClient({
				getCode: async () => '0x1234',
				onTransactionPrepared: preview => {
					transactionState = markTransactionPrepared(transactionState, preview)
				},
				requiresWalletConfirmation: false,
				sendTransaction: async () => txHash,
				waitForTransactionReceipt: async () => hashReceipt('success'),
			})

			await oracleStep.deploy(client)

			expect(transactionState.active?.tone).toBe('preparing')
			expect(transactionState.active?.detail).toBe('Review the prepared transaction before it is submitted.')
			expect(transactionState.pendingIntent?.requiresWalletConfirmation).toBe(false)
		} finally {
			resetEnvironment()
		}
	})

	test('proxy deployer step returns zero hash when signer-based deploy is already installed', async () => {
		const steps = createDeploymentSteps()
		const proxyStep = steps.find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let sendTransactionCallCount = 0
		let sendRawTransactionCallCount = 0

		const client = asWriteClient({
			getCode: async () => '0x1234',
			sendTransaction: async () => {
				sendTransactionCallCount += 1
				return `0x${'9'.repeat(64)}` as Hash
			},
			waitForTransactionReceipt: async () => hashReceipt('success'),
			sendRawTransaction: async () => {
				sendRawTransactionCallCount += 1
				return `0x${'a'.repeat(64)}` as Hash
			},
		})

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

		const client = asWriteClient({
			getCode: async () => undefined,
			installSimulationProxyDeployer: async () => {
				installCalled = true
			},
			sendTransaction: async () => {
				funded = true
				return `0x${'b'.repeat(64)}` as Hash
			},
			waitForTransactionReceipt: async () => hashReceipt('success'),
			sendRawTransaction: async () => {
				throw new Error('sendRawTransaction should not be called')
			},
		})

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
		const preparedPreviews: Parameters<NonNullable<WriteClient['onTransactionPrepared']>>[0][] = []
		const fundHash = `0x${'c'.repeat(64)}` as Hash
		const deployHash = `0x${'d'.repeat(64)}` as Hash

		const client = asWriteClient({
			getCode: async () => undefined,
			onTransactionPrepared: preview => {
				preparedPreviews.push(preview)
			},
			sendTransaction: async request => {
				seen.push(request.to ?? 'none')
				return request.value === undefined ? deployHash : fundHash
			},
			waitForTransactionReceipt: async () => hashReceipt('success'),
			sendRawTransaction: async request => {
				seen.push(request.serializedTransaction)
				return deployHash
			},
		})

		const hash = await proxyStep.deploy(client)

		expect(hash).toBe(deployHash)
		expect(seen[0]).toBe(getAddress('0x4c8d290a1b368ac4728d83a9e8321fc3af2b39b1'))
		expect(seen[1]).toBe('0xf87e8085174876e800830186a08080ad601f80600e600039806000f350fe60003681823780368234f58015156014578182fd5b80825250506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222')
		expect(preparedPreviews.map(preview => preview.functionName)).toEqual(['Fund deterministic proxy deployer signer', 'Broadcast deterministic proxy deployer transaction'])
		expect(preparedPreviews[0]?.toLabel).toBe('Proxy deployer signer')
		const rawBroadcastPreview = preparedPreviews[1]
		if (rawBroadcastPreview === undefined) throw new Error('Expected raw broadcast preview')
		expect(rawBroadcastPreview.account).toBe(getAddress('0x4c8d290a1b368ac4728d83a9e8321fc3af2b39b1'))
		expect(rawBroadcastPreview.dataLabel).toBe('Raw transaction')
		expect(rawBroadcastPreview.requiresWalletConfirmation).toBe(false)
	})

	test('proxy deployer step stops when the signer-funding transaction is cancelled in the wallet', async () => {
		const steps = createDeploymentSteps()
		const proxyStep = steps.find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		const fundHash = `0x${'5'.repeat(64)}` as Hash
		let sendRawTransactionCalled = false
		const client = asWriteClient({
			getCode: async () => undefined,
			sendTransaction: async () => fundHash,
			waitForTransactionReceipt: async parameters => {
				parameters.onReplaced?.({
					reason: 'cancelled',
					replacedTransaction: { hash: fundHash } as never,
					transaction: { hash: `0x${'6'.repeat(64)}` as Hash } as never,
					transactionReceipt: hashReceipt('success'),
				})
				return hashReceipt('success')
			},
			sendRawTransaction: async () => {
				sendRawTransactionCalled = true
				return `0x${'7'.repeat(64)}` as Hash
			},
		})

		await expect(proxyStep.deploy(client)).rejects.toThrow('Transaction was cancelled in the wallet before confirmation.')
		expect(sendRawTransactionCalled).toBe(false)
	})

	test('proxy deployer step returns the replacement hash when the raw deploy transaction is repriced', async () => {
		const steps = createDeploymentSteps()
		const proxyStep = steps.find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		const fundHash = `0x${'8'.repeat(64)}` as Hash
		const rawHash = `0x${'9'.repeat(64)}` as Hash
		const replacementHash = `0x${'a'.repeat(64)}` as Hash
		const onTransactionSubmitted = mock(() => undefined)
		const client = asWriteClient({
			getCode: async () => undefined,
			onTransactionSubmitted,
			sendTransaction: async () => fundHash,
			waitForTransactionReceipt: async parameters => {
				if (parameters.hash === fundHash) return hashReceipt('success')
				parameters.onReplaced?.({
					reason: 'repriced',
					replacedTransaction: { hash: rawHash } as never,
					transaction: { hash: replacementHash } as never,
					transactionReceipt: hashReceipt('success'),
				})
				return hashReceipt('success')
			},
			sendRawTransaction: async () => rawHash,
		})

		const hash = await proxyStep.deploy(client)

		expect(hash).toBe(replacementHash)
		expect(onTransactionSubmitted).toHaveBeenCalledWith(replacementHash)
	})

	test('zoltar deployment step patches the Genesis REP token in simulation mode', async () => {
		const steps = createDeploymentSteps()
		const zoltarStep = steps.find(step => step.id === 'zoltar')
		if (zoltarStep === undefined) throw new Error('Expected zoltar step')
		let patchedParameters: { repAddress: Address; zoltarAddress: Address } | undefined

		const txHash = `0x${'e'.repeat(64)}` as Hash
		const client = asWriteClient({
			getCode: async () => '0x1234',
			sendTransaction: async () => txHash,
			waitForTransactionReceipt: async () => hashReceipt('success'),
			patchSimulationGenesisRepToken: async ({ repAddress, zoltarAddress }) => {
				patchedParameters = {
					repAddress,
					zoltarAddress,
				}
			},
		})

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
			const client = asWriteClient({
				getCode: async () => '0x1234',
				sendTransaction: async request => {
					seenData = request.data
					seenAddress = request.to === null ? undefined : request.to
					return txHash
				},
				waitForTransactionReceipt: async () => hashReceipt('success'),
			})

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
		const readClient: MockReadClient = {
			getCode: async () => '0x',
			readContract: async request => {
				if (request.address === undefined) {
					throw new Error('Expected token address')
				}
				seen.push({
					address: request.address,
					args: Array.isArray(request.args) ? request.args : [],
					functionName: request.functionName,
				})
				if (request.functionName === 'balanceOf') return 2_000n as never
				if (request.functionName === 'allowance') return 500n as never
				throw new Error(`Unexpected function name: ${request.functionName}`)
			},
		}

		expect(await loadErc20Balance(readClient as ReadClient, tokenAddress, ownerAddress)).toBe(2_000n)
		expect(await loadErc20Allowance(readClient as ReadClient, tokenAddress, ownerAddress, spenderAddress)).toBe(500n)
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
