/// <reference types='bun-types' />

import { describe, expect, mock, test } from 'bun:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { type Address, type Hash, type Hex, type TransactionReceipt, encodeDeployData, getAddress, getCreate2Address, keccak256 } from '@zoltar/shared/ethereum'
import { getDeploymentSteps, loadDeploymentStatusOracleSnapshot, loadErc20Allowance, loadErc20Balance } from '../../protocol/index.js'
import { getGenesisReputationTokenAddress } from '../../protocol/activeProtocolAddresses.js'
import { PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from '../../protocol/deploymentHelpers.js'
import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createInitialTransactionTrayState, markTransactionPrepared, markTransactionRequested } from '@zoltar/ui-core-shared/lib/transactionTray.js'
import { createFakeBackend, createFakeSimulationProfile } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/lib/networkProfile.js'
import { SEPOLIA_GENESIS_REP_INIT_CODE, SEPOLIA_WETH_INIT_CODE } from '@zoltar/ui-core-shared/lib/sepoliaDeploymentConfig.js'
import { DeploymentStatusOracle_DeploymentStatusOracle, ScalarOutcomes_ScalarOutcomes, peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory } from '@zoltar/ui-core-shared/contractArtifact.js'
import { ATOMIC_FUNDING_BYTECODE, ATOMIC_FUNDING_SOURCE, EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES, PROXY_DEPLOYER_RUNTIME_CODE, STATIC_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID, assertStaticDeploymentArtifactRuntimeCodeHashes } from '../../protocol/deployment.js'

const require = createRequire(import.meta.url)
const rootSolcPath = fileURLToPath(new URL('../../../../../node_modules/solc/index.js', import.meta.url))
const solc: { compile: (input: string) => string; version: () => string } = require(rootSolcPath)

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string) {
	if (!isRecord(value)) throw new Error(`Expected ${label} to be an object`)
	return value
}

type MockReadClient = Pick<ReadClient, 'getCode' | 'readContract'>
type MockWriteClient = Pick<WriteClient, 'getCode' | 'sendTransaction' | 'waitForTransactionReceipt'> &
	Partial<
		Pick<
			WriteClient,
			'assertCanonicalRawTransactionCost' | 'getBalance' | 'getBlock' | 'getTransactionCount' | 'sendRawTransaction' | 'installSimulationProxyDeployer' | 'onTransactionPrepared' | 'onTransactionSubmitted' | 'patchSimulationGenesisRepToken' | 'recordCanonicalRawTransaction' | 'requiresWalletConfirmation'
		>
	>

function asWriteClient(client: MockWriteClient): WriteClient {
	return {
		getBlock: async () => ({ baseFeePerGas: 1n }) as never,
		getTransactionCount: async () => 0n,
		...client,
	} as unknown as WriteClient
}

function hashReceipt(status: TransactionReceipt['status']): TransactionReceipt {
	return { ...({} as TransactionReceipt), status }
}

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as const

function createDeploymentSteps(wait?: (milliseconds: number) => Promise<void>) {
	return getDeploymentSteps(undefined, wait)
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
	test('rejects generated deployment artifacts that do not match the pinned runtime hashes', () => {
		expect(Object.keys(STATIC_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID).sort()).toEqual(['deploymentStatusOracle', 'escalationGameClaimDelegate', 'multicall3', 'openOracle', 'scalarOutcomes', 'uniformPriceDualCapBatchAuctionFactory', 'weth', 'zoltarQuestionData'])
		expect(() => assertStaticDeploymentArtifactRuntimeCodeHashes()).not.toThrow()
		expect(() =>
			assertStaticDeploymentArtifactRuntimeCodeHashes({
				expectedRuntimeCodeHashes: { openOracle: keccak256('0x01') },
				runtimeCodeByStepId: { openOracle: '0x02' },
			}),
		).toThrow('Local runtime code for openOracle does not match its pinned expected hash')
	})

	test('atomic canonical-signer funding bytecode matches its pinned source and compiler settings', () => {
		const output = requireRecord(
			JSON.parse(
				solc.compile(
					JSON.stringify({
						language: 'Solidity',
						sources: { 'AtomicFunding.sol': { content: ATOMIC_FUNDING_SOURCE } },
						settings: {
							metadata: { bytecodeHash: 'none' },
							optimizer: { enabled: true, runs: 200 },
							outputSelection: { '*': { '*': ['evm.bytecode.object'] } },
						},
					}),
				),
			),
			'Solidity compiler output',
		)
		const contracts = requireRecord(output['contracts'], 'compiled contracts')
		const sourceContracts = requireRecord(contracts['AtomicFunding.sol'], 'AtomicFunding.sol contracts')
		const contract = requireRecord(sourceContracts['AtomicFunding'], 'AtomicFunding contract')
		const evm = requireRecord(contract['evm'], 'AtomicFunding EVM output')
		const bytecode = requireRecord(evm['bytecode'], 'AtomicFunding bytecode')
		expect(solc.version()).toStartWith('0.8.17')
		expect(Array.isArray(output['errors']) ? output['errors'].filter(error => requireRecord(error, 'compiler diagnostic')['severity'] === 'error') : []).toEqual([])
		expect(bytecode['object']).toBe(ATOMIC_FUNDING_BYTECODE.slice(2))
	})

	test('adds WETH and allocated genesis REP ahead of Sepolia protocol dependencies', () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: SEPOLIA_NETWORK_PROFILE }))
		try {
			const steps = createDeploymentSteps()
			const wethStep = steps.find(step => step.id === 'weth')
			const repStep = steps.find(step => step.id === 'reputationToken')
			const zoltarStep = steps.find(step => step.id === 'zoltar')
			const priceFactoryStep = steps.find(step => step.id === 'priceOracleManagerAndOperatorQueuerFactory')

			expect(wethStep?.address).toBe(SEPOLIA_NETWORK_PROFILE.wethAddress)
			expect(repStep?.address).toBe(SEPOLIA_NETWORK_PROFILE.genesisRepTokenAddress)
			expect(zoltarStep?.dependencies).toContain('reputationToken')
			expect(priceFactoryStep?.dependencies).toContain('weth')
			expect(SEPOLIA_WETH_INIT_CODE).toStartWith('0x')
			expect(SEPOLIA_GENESIS_REP_INIT_CODE).toStartWith('0x')
		} finally {
			resetEnvironment()
		}
	})

	test('status oracle constructor order matches the deployment-step order on every public network', () => {
		for (const profile of [MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE]) {
			const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile }))
			try {
				const steps = getDeploymentSteps()
				const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
				if (oracleStep === undefined) throw new Error(`Expected ${profile.displayName} deploymentStatusOracle step`)
				const trackedAddresses = steps.filter(step => step.id !== 'deploymentStatusOracle').map(step => step.address)
				const expectedBytecode = encodeDeployData({
					abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
					bytecode: `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.bytecode.object}`,
					args: [trackedAddresses],
				})
				const expectedAddress = getCreate2Address({
					bytecode: expectedBytecode,
					from: PROXY_DEPLOYER_ADDRESS,
					salt: ZERO_SALT,
				})

				expect(oracleStep.address).toBe(expectedAddress)
			} finally {
				resetEnvironment()
			}
		}
	})

	test('provides exact runtime verification for every mainnet deployment step', () => {
		const steps = getDeploymentSteps(MAINNET_NETWORK_PROFILE)
		expect(steps.filter(step => step.expectedRuntimeCodeHash === undefined).map(step => step.id)).toEqual([])
	})

	test('pins the compiled auction factory runtime code for every public network', () => {
		const runtimeCode = `0x${peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.deployedBytecode.object}` as Hex
		expect(EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES.uniformPriceDualCapBatchAuctionFactory).toBe(keccak256(runtimeCode))
		for (const profile of [MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE]) {
			const factoryStep = getDeploymentSteps(profile).find(step => step.id === 'uniformPriceDualCapBatchAuctionFactory')
			expect(factoryStep?.expectedRuntimeCodeHash).toBe(keccak256(runtimeCode))
		}
	})

	test('loads mainnet status with exact code verification and deploys a non-proxy step', async () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: MAINNET_NETWORK_PROFILE }))
		try {
			const steps = getDeploymentSteps(MAINNET_NETWORK_PROFILE)
			const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
			const scalarStep = steps.find(step => step.id === 'scalarOutcomes')
			if (oracleStep === undefined || scalarStep === undefined) throw new Error('Expected mainnet oracle and scalar deployment steps')
			const oracleRuntimeCode = `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.deployedBytecode.object}` as Hex
			const scalarRuntimeCode = `0x${ScalarOutcomes_ScalarOutcomes.evm.deployedBytecode.object}` as Hex
			const snapshot = await loadDeploymentStatusOracleSnapshot(
				createMockReadClient({
					getCode: async ({ address }) => {
						if (address === oracleStep.address) return oracleRuntimeCode
						if (address === PROXY_DEPLOYER_ADDRESS) return PROXY_DEPLOYER_RUNTIME_CODE
						throw new Error(`Unexpected mainnet status code address: ${address}`)
					},
					readContract: async ({ functionName }) => {
						if (functionName === 'getDeploymentMask') return 1n as never
						throw new Error(`Unexpected mainnet status read: ${functionName}`)
					},
				}) as ReadClient,
			)
			expect(snapshot.deploymentStatuses.find(step => step.id === 'proxyDeployer')?.deployed).toBe(true)
			expect(snapshot.deploymentStatuses.find(step => step.id === 'deploymentStatusOracle')?.deployed).toBe(true)

			let transactionTarget: Address | null | undefined
			const transactionHash = `0x${'8'.repeat(64)}` as Hash
			expect(
				await scalarStep.deploy(
					asWriteClient({
						getCode: async () => PROXY_DEPLOYER_RUNTIME_CODE,
						sendTransaction: async request => {
							transactionTarget = request.to
							return transactionHash
						},
						waitForTransactionReceipt: async () => hashReceipt('success'),
					}),
				),
			).toBe(transactionHash)
			expect(transactionTarget).toBe(PROXY_DEPLOYER_ADDRESS)
			expect(scalarStep.expectedRuntimeCodeHash).toBe(keccak256(scalarRuntimeCode))
		} finally {
			resetEnvironment()
		}
	})

	test('explicit public profiles produce isolated addresses and init code when runtime uses the opposite network', async () => {
		const captureDeployData = async (steps: ReturnType<typeof getDeploymentSteps>, stepId: 'priceOracleManagerAndOperatorQueuerFactory' | 'zoltar') => {
			const step = steps.find(candidate => candidate.id === stepId)
			if (step === undefined) throw new Error(`Expected ${stepId} deployment step`)
			let deployData: `0x${string}` | undefined
			const txHash = `0x${'9'.repeat(64)}` as Hash
			const client = asWriteClient({
				getCode: async () => '0x1234',
				sendTransaction: async request => {
					deployData = request.data
					return txHash
				},
				waitForTransactionReceipt: async () => hashReceipt('success'),
			})
			await step.deploy(client)
			if (deployData === undefined) throw new Error(`Expected ${stepId} deployment data`)
			return deployData
		}

		for (const [requestedProfile, oppositeProfile] of [
			[MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE],
			[SEPOLIA_NETWORK_PROFILE, MAINNET_NETWORK_PROFILE],
		] as const) {
			const resetOppositeEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: oppositeProfile }))
			const oppositeRuntimeSteps = getDeploymentSteps(requestedProfile)
			resetOppositeEnvironment()

			const resetAlignedEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: requestedProfile }))
			const alignedRuntimeSteps = getDeploymentSteps(requestedProfile)
			resetAlignedEnvironment()

			expect(oppositeRuntimeSteps.map(step => [step.id, step.address])).toEqual(alignedRuntimeSteps.map(step => [step.id, step.address]))

			const oracleStep = oppositeRuntimeSteps.find(step => step.id === 'deploymentStatusOracle')
			if (oracleStep === undefined) throw new Error(`Expected ${requestedProfile.displayName} deploymentStatusOracle step`)
			const trackedAddresses = oppositeRuntimeSteps.filter(step => step.id !== 'deploymentStatusOracle').map(step => step.address)
			const expectedOracleBytecode = encodeDeployData({
				abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
				bytecode: `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.bytecode.object}`,
				args: [trackedAddresses],
			})
			expect(oracleStep.address).toBe(
				getCreate2Address({
					bytecode: expectedOracleBytecode,
					from: PROXY_DEPLOYER_ADDRESS,
					salt: ZERO_SALT,
				}),
			)

			for (const stepId of ['zoltar', 'priceOracleManagerAndOperatorQueuerFactory'] as const) {
				expect(await captureDeployData(oppositeRuntimeSteps, stepId)).toBe(await captureDeployData(alignedRuntimeSteps, stepId))
			}
		}
	})

	test('loadDeploymentStatusOracleSnapshot reads deployment mask when the status oracle is deployed', async () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: createFakeSimulationProfile() }))
		try {
			const oracleStep = createDeploymentSteps().find(step => step.id === 'deploymentStatusOracle')
			if (oracleStep === undefined) throw new Error('Expected deploymentStatusOracle step')
			const readContractCalls: string[] = []
			const readClient = createMockReadClient({
				getCode: async ({ address }) => {
					if (address === oracleStep.address) return '0x1234'
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
			expect(snapshot.applicationDeploymentComplete).toBe(false)
			expect(snapshot.deploymentStatuses.find(step => step.id === 'proxyDeployer')?.deployed).toBe(true)
			expect(snapshot.deploymentStatuses.find(step => step.id === 'deploymentStatusOracle')?.deployed).toBe(true)
			expect(snapshot.deploymentStatuses.find(step => step.id === 'multicall3')?.deployed).toBe(false)
			expect(snapshot.deploymentStatuses.find(step => step.id === 'uniformPriceDualCapBatchAuctionFactory')?.deployed).toBe(true)
		} finally {
			resetEnvironment()
		}
	})

	test('loadDeploymentStatusOracleSnapshot rejects unexpected status-oracle code', async () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: SEPOLIA_NETWORK_PROFILE }))
		try {
			const oracleStep = createDeploymentSteps().find(step => step.id === 'deploymentStatusOracle')
			if (oracleStep === undefined) throw new Error('Expected deploymentStatusOracle step')
			const readClient = createMockReadClient({
				getCode: async ({ address }) => (address === oracleStep.address ? '0x1234' : undefined),
			})

			await expect(loadDeploymentStatusOracleSnapshot(readClient as ReadClient)).rejects.toThrow('Unexpected runtime code for deploymentStatusOracle')
		} finally {
			resetEnvironment()
		}
	})

	test('deployViaProxy-backed steps execute with a transaction through the proxy deployer', async () => {
		const steps = createDeploymentSteps()
		const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
		if (oracleStep === undefined) throw new Error('Expected deploymentStatusOracle step')
		const factoryStep = steps.find(step => step.id === 'openOracle')
		if (factoryStep === undefined) throw new Error('Expected openOracle step')

		let capturedProxyDeployData: `0x${string}` | undefined
		let capturedFactoryData: `0x${string}` | undefined
		const preparedFunctions: string[] = []
		const txHash = `0x${'7'.repeat(64)}` as Hash
		const client = asWriteClient({
			getCode: async () => PROXY_DEPLOYER_RUNTIME_CODE,
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
			getCode: async () => PROXY_DEPLOYER_RUNTIME_CODE,
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
			getBalance: async () => 0n,
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
		let proxyInstalled = false
		let rawBroadcastCount = 0

		const client = asWriteClient({
			getBalance: async () => 0n,
			getCode: async () => (proxyInstalled ? PROXY_DEPLOYER_RUNTIME_CODE : undefined),
			onTransactionPrepared: preview => {
				preparedPreviews.push(preview)
			},
			sendTransaction: async request => {
				seen.push(request.to ?? 'none')
				return request.value === undefined ? deployHash : fundHash
			},
			waitForTransactionReceipt: async () => hashReceipt('success'),
			sendRawTransaction: async request => {
				rawBroadcastCount += 1
				seen.push(request.serializedTransaction)
				if (rawBroadcastCount === 1) throw new Error('insufficient funds for gas')
				proxyInstalled = true
				return deployHash
			},
		})

		const hash = await proxyStep.deploy(client)

		expect(hash).toBe(deployHash)
		expect(seen).toEqual([
			'0xf87e8085174876e800830186a08080ad601f80600e600039806000f350fe60003681823780368234f58015156014578182fd5b80825250506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222',
			'none',
			'0xf87e8085174876e800830186a08080ad601f80600e600039806000f350fe60003681823780368234f58015156014578182fd5b80825250506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222',
		])
		expect(preparedPreviews.map(preview => preview.functionName)).toEqual(['Broadcast deterministic proxy deployer transaction', 'Fund deterministic proxy deployer signer without surplus', 'Broadcast deterministic proxy deployer transaction'])
		expect(preparedPreviews[1]?.value).toBe(10_000_000_000_000_000n)
		const rawBroadcastPreview = preparedPreviews[2]
		if (rawBroadcastPreview === undefined) throw new Error('Expected raw broadcast preview')
		expect(rawBroadcastPreview.account).toBe(getAddress('0x4c8d290a1b368ac4728d83a9e8321fc3af2b39b1'))
		expect(rawBroadcastPreview.dataLabel).toBe('Raw transaction')
		expect(rawBroadcastPreview.requiresWalletConfirmation).toBe(false)
	})

	for (const { balance, rawInitiallyFunded, expectedFunding } of [
		{ balance: 10_000_000_000_000_000n, rawInitiallyFunded: true, expectedFunding: undefined },
		{ balance: 4_000_000_000_000_000n, rawInitiallyFunded: false, expectedFunding: 10_000_000_000_000_000n },
	]) {
		test(`proxy deployer retry atomically funds the signer when its balance is ${balance.toString()}`, async () => {
			const proxyStep = createDeploymentSteps().find(step => step.id === 'proxyDeployer')
			if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
			const fundingValues: bigint[] = []
			let proxyInstalled = false
			const client = asWriteClient({
				getBalance: async () => balance,
				getCode: async () => (proxyInstalled ? PROXY_DEPLOYER_RUNTIME_CODE : undefined),
				sendTransaction: async request => {
					if (request.value !== undefined) fundingValues.push(request.value)
					return `0x${'1'.repeat(64)}` as Hash
				},
				sendRawTransaction: async () => {
					if (!rawInitiallyFunded && fundingValues.length === 0) throw new Error('insufficient funds for gas')
					proxyInstalled = true
					return `0x${'2'.repeat(64)}` as Hash
				},
				waitForTransactionReceipt: async () => hashReceipt('success'),
			})

			await proxyStep.deploy(client)

			expect(fundingValues).toEqual(expectedFunding === undefined ? [] : [expectedFunding])
		})
	}

	test('proxy deployer retry refuses duplicate funding while signer funding is pending', async () => {
		const proxyStep = createDeploymentSteps().find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let sendCalled = false
		const client = asWriteClient({
			getBalance: async parameters => (parameters.blockTag === 'pending' ? 10_000_000_000_000_000n : 0n),
			getCode: async () => undefined,
			sendTransaction: async () => {
				sendCalled = true
				return `0x${'1'.repeat(64)}` as Hash
			},
			waitForTransactionReceipt: async () => hashReceipt('success'),
		})

		await expect(proxyStep.deploy(client)).rejects.toThrow('pending funding or deployment activity')
		expect(sendCalled).toBe(false)
	})

	test('proxy deployer retry refuses funding after its signer nonce was consumed without installing the proxy', async () => {
		const proxyStep = createDeploymentSteps(async () => undefined).find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let sendCalled = false
		const client = asWriteClient({
			getBalance: async () => 0n,
			getCode: async () => undefined,
			getTransactionCount: async () => 1n,
			sendTransaction: async () => {
				sendCalled = true
				return `0x${'1'.repeat(64)}` as Hash
			},
			waitForTransactionReceipt: async () => hashReceipt('success'),
		})

		await expect(proxyStep.deploy(client)).rejects.toThrow('signer nonce has already been consumed')
		expect(sendCalled).toBe(false)
	})

	test('proxy deployer accepts delayed code after its signer nonce was already confirmed', async () => {
		const retryDelays: number[] = []
		const proxyStep = createDeploymentSteps(async delayMilliseconds => {
			retryDelays.push(delayMilliseconds)
		}).find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let codeReadCount = 0
		let transactionSubmitted = false
		const client = asWriteClient({
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => {
				codeReadCount += 1
				return codeReadCount < 4 ? undefined : PROXY_DEPLOYER_RUNTIME_CODE
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
			waitForTransactionReceipt: async () => hashReceipt('success'),
		})

		expect(await proxyStep.deploy(client)).not.toBe(ZERO_HASH)
		expect(retryDelays).toEqual([250])
		expect(transactionSubmitted).toBe(false)
	})

	test('proxy deployer rejects an incompatible base fee without sending or funding', async () => {
		const proxyStep = createDeploymentSteps().find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let writeCalled = false
		const client = asWriteClient({
			getBalance: async () => 0n,
			getBlock: async () => ({ baseFeePerGas: 100_000_000_001n }) as never,
			getCode: async () => undefined,
			sendRawTransaction: async () => {
				writeCalled = true
				return `0x${'1'.repeat(64)}` as Hash
			},
			sendTransaction: async () => {
				writeCalled = true
				return `0x${'2'.repeat(64)}` as Hash
			},
			waitForTransactionReceipt: async () => hashReceipt('success'),
		})

		await expect(proxyStep.deploy(client)).rejects.toThrow('below the current base fee')
		expect(writeCalled).toBe(false)
	})

	test('proxy deployer tests RPC raw-transaction policy before signer funding', async () => {
		const proxyStep = createDeploymentSteps().find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let fundingCalled = false
		const client = asWriteClient({
			getBalance: async () => 0n,
			getCode: async () => undefined,
			sendRawTransaction: async () => {
				throw new Error('only replay-protected transactions allowed over RPC')
			},
			sendTransaction: async () => {
				fundingCalled = true
				return `0x${'2'.repeat(64)}` as Hash
			},
			waitForTransactionReceipt: async () => hashReceipt('success'),
		})

		await expect(proxyStep.deploy(client)).rejects.toThrow('before signer funding')
		expect(fundingCalled).toBe(false)
	})

	test('proxy deployer enforces raw-transaction cost authorization before broadcast', async () => {
		const proxyStep = createDeploymentSteps().find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let writeCalled = false
		const client = asWriteClient({
			assertCanonicalRawTransactionCost: () => {
				throw new Error('would exceed the authorized deployment total')
			},
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => undefined,
			sendRawTransaction: async () => {
				writeCalled = true
				return `0x${'1'.repeat(64)}` as Hash
			},
			sendTransaction: async () => {
				writeCalled = true
				return `0x${'2'.repeat(64)}` as Hash
			},
			waitForTransactionReceipt: async () => hashReceipt('success'),
		})

		await expect(proxyStep.deploy(client)).rejects.toThrow('would exceed the authorized deployment total')
		expect(writeCalled).toBe(false)
	})

	test('proxy deployer retry notices a raw deployment that confirms during preflight', async () => {
		const proxyStep = createDeploymentSteps().find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let codeReadCount = 0
		let sendCalled = false
		const client = asWriteClient({
			getBalance: async () => 0n,
			getCode: async () => {
				codeReadCount += 1
				return codeReadCount < 3 ? undefined : PROXY_DEPLOYER_RUNTIME_CODE
			},
			sendTransaction: async () => {
				sendCalled = true
				return `0x${'1'.repeat(64)}` as Hash
			},
			waitForTransactionReceipt: async () => hashReceipt('success'),
		})

		expect(await proxyStep.deploy(client)).not.toBe(ZERO_HASH)
		expect(sendCalled).toBe(false)
	})

	test('proxy deployer retry broadcasts the raw deployment after funding confirms during preflight', async () => {
		const proxyStep = createDeploymentSteps().find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let balanceReadCount = 0
		let rawBroadcastCount = 0
		let proxyInstalled = false
		const deployHash = `0x${'2'.repeat(64)}` as Hash
		const client = asWriteClient({
			getBalance: async () => {
				balanceReadCount += 1
				return balanceReadCount < 4 ? 0n : 10_000_000_000_000_000n
			},
			getCode: async () => (proxyInstalled ? PROXY_DEPLOYER_RUNTIME_CODE : undefined),
			sendTransaction: async () => {
				throw new Error('A stale funding transaction must not be sent')
			},
			sendRawTransaction: async () => {
				rawBroadcastCount += 1
				proxyInstalled = true
				return deployHash
			},
			waitForTransactionReceipt: async () => hashReceipt('success'),
		})

		expect(await proxyStep.deploy(client)).toBe(deployHash)
		expect(rawBroadcastCount).toBe(1)
		expect(proxyInstalled).toBe(true)
	})

	test('proxy deployer retry waits for a concurrent canonical raw deployment', async () => {
		const proxyStep = createDeploymentSteps().find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let installed = false
		let rawBroadcastCalled = false
		let accountedRawTransactions = 0
		const client = asWriteClient({
			assertCanonicalRawTransactionCost: () => undefined,
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => (installed ? PROXY_DEPLOYER_RUNTIME_CODE : undefined),
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
				return hashReceipt('success')
			},
		})

		expect(await proxyStep.deploy(client)).not.toBe(ZERO_HASH)
		expect(installed).toBe(true)
		expect(rawBroadcastCalled).toBe(false)
		expect(accountedRawTransactions).toBe(1)
	})

	test('proxy deployer retries code verification when RPC state lags the confirmed receipt', async () => {
		const retryDelays: number[] = []
		const proxyStep = createDeploymentSteps(async delayMilliseconds => {
			retryDelays.push(delayMilliseconds)
		}).find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let codeReadCount = 0
		const client = asWriteClient({
			assertCanonicalRawTransactionCost: () => undefined,
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => {
				codeReadCount += 1
				return codeReadCount < 3 ? undefined : PROXY_DEPLOYER_RUNTIME_CODE
			},
			getTransactionCount: async parameters => (parameters.blockTag === 'pending' ? 1n : 0n),
			recordCanonicalRawTransaction: () => undefined,
			sendTransaction: async () => {
				throw new Error('Funding should not be sent')
			},
			waitForTransactionReceipt: async () => hashReceipt('success'),
		})

		expect(await proxyStep.deploy(client)).not.toBe(ZERO_HASH)
		expect(retryDelays).toEqual([250])
	})

	test('proxy deployer still rejects a confirmed transaction that never exposes code', async () => {
		const retryDelays: number[] = []
		const proxyStep = createDeploymentSteps(async delayMilliseconds => {
			retryDelays.push(delayMilliseconds)
		}).find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		const client = asWriteClient({
			assertCanonicalRawTransactionCost: () => undefined,
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => undefined,
			getTransactionCount: async parameters => (parameters.blockTag === 'pending' ? 1n : 0n),
			recordCanonicalRawTransaction: () => undefined,
			sendTransaction: async () => {
				throw new Error('Funding should not be sent')
			},
			waitForTransactionReceipt: async () => hashReceipt('success'),
		})

		await expect(proxyStep.deploy(client)).rejects.toThrow('confirmed without installing code')
		expect(retryDelays).toEqual([250, 500, 1_000, 2_000, 4_000])
	})

	test('proxy deployer retry accepts an already-known canonical broadcast race', async () => {
		const proxyStep = createDeploymentSteps().find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let installed = false
		let pending = false
		let accountedRawTransactions = 0
		const client = asWriteClient({
			assertCanonicalRawTransactionCost: () => undefined,
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => (installed ? PROXY_DEPLOYER_RUNTIME_CODE : undefined),
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
				return hashReceipt('success')
			},
		})

		expect(await proxyStep.deploy(client)).not.toBe(ZERO_HASH)
		expect(installed).toBe(true)
		expect(accountedRawTransactions).toBe(1)
	})

	test('proxy deployer retry accepts a canonical deployment that confirms before its broadcast returns', async () => {
		const proxyStep = createDeploymentSteps().find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let installed = false
		const client = asWriteClient({
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => (installed ? PROXY_DEPLOYER_RUNTIME_CODE : undefined),
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

		expect(await proxyStep.deploy(client)).not.toBe(ZERO_HASH)
	})

	test('proxy deployer retries stale code after a broadcast reports an already-confirmed nonce', async () => {
		const retryDelays: number[] = []
		const proxyStep = createDeploymentSteps(async delayMilliseconds => {
			retryDelays.push(delayMilliseconds)
		}).find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let confirmed = false
		let codeReadCount = 0
		const client = asWriteClient({
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => {
				codeReadCount += 1
				return codeReadCount < 5 ? undefined : PROXY_DEPLOYER_RUNTIME_CODE
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

		expect(await proxyStep.deploy(client)).not.toBe(ZERO_HASH)
		expect(retryDelays).toEqual([250])
	})

	test('proxy deployer retry rechecks canonical state after funding confirms', async () => {
		const proxyStep = createDeploymentSteps().find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let funded = false
		let installed = false
		let rawBroadcastCalled = false
		const client = asWriteClient({
			getBalance: async () => (funded ? 10_000_000_000_000_000n : 0n),
			getCode: async () => (installed ? PROXY_DEPLOYER_RUNTIME_CODE : undefined),
			sendRawTransaction: async () => {
				rawBroadcastCalled = true
				throw new Error('insufficient funds for gas')
			},
			sendTransaction: async () => {
				funded = true
				return `0x${'2'.repeat(64)}` as Hash
			},
			waitForTransactionReceipt: async () => {
				installed = true
				return hashReceipt('success')
			},
		})

		expect(await proxyStep.deploy(client)).not.toBe(ZERO_HASH)
		expect(rawBroadcastCalled).toBe(true)
	})

	test('proxy deployer retries delayed code when deployment confirms during signer funding', async () => {
		let codeVisible = false
		let funded = false
		let rawBroadcastCount = 0
		const retryDelays: number[] = []
		const proxyStep = createDeploymentSteps(async delayMilliseconds => {
			retryDelays.push(delayMilliseconds)
			codeVisible = true
		}).find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		const client = asWriteClient({
			getBalance: async () => (funded ? 10_000_000_000_000_000n : 0n),
			getCode: async () => (codeVisible ? PROXY_DEPLOYER_RUNTIME_CODE : undefined),
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
			waitForTransactionReceipt: async () => hashReceipt('success'),
		})

		expect(await proxyStep.deploy(client)).not.toBe(ZERO_HASH)
		expect(retryDelays).toEqual([250])
		expect(rawBroadcastCount).toBe(1)
	})

	test('proxy deployer broadcast races reject unexpected installed code', async () => {
		const proxyStep = createDeploymentSteps().find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let code: Hex | undefined
		const client = asWriteClient({
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => code,
			sendRawTransaction: async () => {
				code = '0x1234'
				throw new Error('nonce too low')
			},
			sendTransaction: async () => {
				throw new Error('Funding should not be sent')
			},
			waitForTransactionReceipt: async () => hashReceipt('success'),
		})

		await expect(proxyStep.deploy(client)).rejects.toThrow('Unexpected code at canonical proxy deployer')
	})

	test('proxy deployer successful broadcasts reject unexpected installed code immediately', async () => {
		const proxyStep = createDeploymentSteps().find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		let code: Hex | undefined
		const client = asWriteClient({
			getBalance: async () => 10_000_000_000_000_000n,
			getCode: async () => code,
			sendRawTransaction: async () => `0x${'1'.repeat(64)}` as Hash,
			sendTransaction: async () => {
				throw new Error('Funding should not be sent')
			},
			waitForTransactionReceipt: async () => {
				code = '0x1234'
				return hashReceipt('success')
			},
		})

		await expect(proxyStep.deploy(client)).rejects.toThrow('Unexpected code at canonical proxy deployer')
	})

	test('proxy deployer step stops when the signer-funding transaction is cancelled in the wallet', async () => {
		const steps = createDeploymentSteps()
		const proxyStep = steps.find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		const fundHash = `0x${'5'.repeat(64)}` as Hash
		let sendRawTransactionCalled = false
		const client = asWriteClient({
			getBalance: async () => 0n,
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
				throw new Error('insufficient funds for gas')
			},
		})

		await expect(proxyStep.deploy(client)).rejects.toThrow('Transaction was cancelled in the wallet before confirmation.')
		expect(sendRawTransactionCalled).toBe(true)
	})

	test('proxy deployer step returns the replacement hash when the raw deploy transaction is repriced', async () => {
		const steps = createDeploymentSteps()
		const proxyStep = steps.find(step => step.id === 'proxyDeployer')
		if (proxyStep === undefined) throw new Error('Expected proxyDeployer step')
		const fundHash = `0x${'8'.repeat(64)}` as Hash
		const rawHash = `0x${'9'.repeat(64)}` as Hash
		const replacementHash = `0x${'a'.repeat(64)}` as Hash
		const onTransactionSubmitted = mock(() => undefined)
		let proxyInstalled = false
		const client = asWriteClient({
			getBalance: async () => 0n,
			getCode: async () => (proxyInstalled ? PROXY_DEPLOYER_RUNTIME_CODE : undefined),
			onTransactionSubmitted,
			sendTransaction: async () => fundHash,
			waitForTransactionReceipt: async parameters => {
				if (parameters.hash === fundHash) return hashReceipt('success')
				proxyInstalled = true
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
