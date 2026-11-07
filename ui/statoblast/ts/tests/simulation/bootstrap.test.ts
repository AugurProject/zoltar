/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { installModuleMocks } from '@zoltar/ui-core-shared/tests/testUtils/moduleMocks.js'
import { MAINNET_NETWORK_PROFILE, MAINNET_WETH_ADDRESS, type NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { bootstrapSimulationChain, mintSimulationGenesisRep, predictSimulationTokenAddresses, type BootstrapScenarioApplyParameters } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { installStatoblastScenarioProtocolForTesting } from '@zoltar/ui-statoblast-shared/simulation/statoblastScenarioProtocol.js'
import { applyStatoblastScenario } from '@zoltar/ui-statoblast-shared/simulation/statoblastScenarios.js'
import type { DeploymentStep } from '@zoltar/ui-core-shared/types/contracts.js'
import { type Address, getAddress, getCreateAddress, toHex } from '@zoltar/core-shared/evm/ethereum'

const moduleMocks = installModuleMocks(specifier => import.meta.resolve(specifier))
await moduleMocks.mockModule('@zoltar/ui-core-shared/simulation/clock.js', () => ({
	advanceSimulationTime: async () => undefined,
	getSimulationChainTimestamp: async () => 1_000n,
	initializeSimulationClock: async () => 1_000n,
}))

const MOCK_PRIMARY_ACCOUNT = getAddress('0x00000000000000000000000000000000000000a1')
const MOCK_SECONDARY_ACCOUNT = getAddress('0x00000000000000000000000000000000000000a2')

type MemoryStorageCall = {
	address: string
	index: string
	value: string
}

type RepTokenMockState = {
	balances: Map<string, bigint>
	theoreticalSupply: bigint
	totalSupply: bigint
}

function createSuccessfulReceipt(accountAddress: Address) {
	return {
		status: 'success',
		blockHash: '0x0',
		blockNumber: 0n,
		contractAddress: null,
		cumulativeGasUsed: 0n,
		from: accountAddress,
		gasUsed: 0n,
		logs: [],
		logsBloom: '0x',
		to: accountAddress,
		transactionHash: `0x${'0'.repeat(64)}`,
		transactionIndex: 0n,
		type: 'eip1559',
	} as never
}

function createRepTokenMockState(): RepTokenMockState {
	return {
		balances: new Map<string, bigint>(),
		theoreticalSupply: 0n,
		totalSupply: 0n,
	}
}

function createRepTokenWriteClient({ accountAddress, repAddress, repState, zoltarAddress }: { accountAddress: Address; repAddress: Address; repState: RepTokenMockState; zoltarAddress: Address }) {
	return {
		readContract: async ({ address, args, functionName }: { address: Address; args?: unknown[]; functionName: string }) => {
			if (address.toLowerCase() === repAddress.toLowerCase()) {
				switch (functionName) {
					case 'balanceOf': {
						const requestedAddress = args?.[0]
						if (typeof requestedAddress !== 'string') throw new Error('Missing balanceOf account argument')
						return repState.balances.get(requestedAddress.toLowerCase()) ?? 0n
					}
					case 'getTotalTheoreticalSupply':
						return repState.theoreticalSupply
					case 'totalSupply':
						return repState.totalSupply
					default:
						throw new Error(`Unexpected REP read function ${functionName}`)
				}
			}
			if (address.toLowerCase() !== zoltarAddress.toLowerCase()) throw new Error(`Unexpected contract read for ${address}`)
			switch (functionName) {
				case 'getRepToken':
					return repAddress
				case 'getUniverseTheoreticalSupplyAttoRep':
					return repState.theoreticalSupply
				default:
					throw new Error(`Unexpected Zoltar read function ${functionName}`)
			}
		},
		waitForTransactionReceipt: async () => createSuccessfulReceipt(accountAddress),
		writeContract: async ({ address, args, functionName }: { address: Address; args?: unknown[]; functionName: string }) => {
			if (address.toLowerCase() !== repAddress.toLowerCase()) throw new Error(`Unexpected contract write for ${address}`)
			if (accountAddress.toLowerCase() !== zoltarAddress.toLowerCase()) throw new Error(`Expected REP writes from ${zoltarAddress}, got ${accountAddress}`)

			switch (functionName) {
				case 'mint': {
					const recipient = args?.[0]
					const amount = args?.[1]
					if (typeof recipient !== 'string' || typeof amount !== 'bigint') throw new Error('Invalid mint arguments')
					if (repState.totalSupply + amount > repState.theoreticalSupply) throw new Error('Mint exceeds theoretical supply')
					const normalizedRecipient = recipient.toLowerCase()
					repState.balances.set(normalizedRecipient, (repState.balances.get(normalizedRecipient) ?? 0n) + amount)
					repState.totalSupply += amount
					break
				}
				default:
					throw new Error(`Unexpected write function ${functionName}`)
			}

			return '0x01'
		},
	} as never
}

function createBaselineProfile(overrides: Partial<NetworkProfile> = {}): NetworkProfile {
	return {
		...MAINNET_NETWORK_PROFILE,
		...overrides,
	}
}

function createBootstrapMemoryClient(
	overrides: Partial<{
		getBlock: () => Promise<{ timestamp: bigint }>
		getBalance: (args: { address: string }) => Promise<bigint>
		getStorageAt: (args: { address: string; index: string }) => Promise<string>
		setStorageAt: (payload: { address: string; index: string; value: string }) => Promise<void>
		getCode: (args: { address: string }) => Promise<`0x${string}`>
		getTransactionCount: (args: { address: string }) => Promise<bigint>
		tevmReady: () => Promise<void>
		impersonateAccount: (args: { address: string }) => Promise<void>
		setBalance: (args: { address: string; value: bigint }) => Promise<void>
		setNonce: (args: { address: string; nonce: bigint }) => Promise<void>
		setCode: (args: { address: string; bytecode: string }) => Promise<void>
	}> = {},
) {
	return {
		getBlock: async () => ({ timestamp: SIMULATION_INITIAL_TIMESTAMP }),
		getBalance: async () => 0n,
		getStorageAt: async () => toHex(0n, { size: 32 }),
		setStorageAt: async () => undefined,
		getCode: async () => '0x01',
		getTransactionCount: async () => 0n,
		tevmReady: async () => undefined,
		impersonateAccount: async () => undefined,
		setBalance: async () => undefined,
		setNonce: async () => undefined,
		setCode: async () => undefined,
		...overrides,
	} as never
}

const applyScenario = (parameters: BootstrapScenarioApplyParameters) => applyStatoblastScenario(parameters)
const ZOLTAR_SIMULATION_STEP: DeploymentStep = {
	id: 'zoltar',
	label: 'Zoltar',
	address: getAddress('0x00000000000000000000000000000000000000a1'),
	deploy: async () => ({ action: 'none', address: getAddress('0x00000000000000000000000000000000000000a1'), hash: '0x01' }) as never,
}
const getDeploymentSteps = () => [ZOLTAR_SIMULATION_STEP] as const satisfies ReadonlyArray<DeploymentStep>
const getZoltarAddress = () => ZOLTAR_SIMULATION_STEP.address

// The simulation clock starts at 2025-01-01T00:00:00Z.
const SIMULATION_INITIAL_TIMESTAMP = 1_735_689_600n

describe('simulation bootstrap', () => {
	afterEach(() => {
		mock.restore()
		installStatoblastScenarioProtocolForTesting(undefined)
	})

	test('predicts simulation token addresses from account nonces', () => {
		const profile = predictSimulationTokenAddresses(MOCK_PRIMARY_ACCOUNT)

		expect(profile.genesisRepTokenAddress).toBe(getCreateAddress({ from: MOCK_PRIMARY_ACCOUNT, nonce: 0n }))
		expect(profile.wethAddress).toBe(MAINNET_WETH_ADDRESS)
	})

	test('mints simulation REP with a positive-amount guard', async () => {
		const memoryClient = {
			getBlock: async () => ({ timestamp: 0n }),
			getBalance: async () => 0n,
			getTransactionCount: async () => 0n,
			impersonateAccount: async () => undefined,
			setBalance: async () => undefined,
			setNonce: async () => undefined,
		} as never
		await expect(
			mintSimulationGenesisRep({
				accountAddress: MOCK_PRIMARY_ACCOUNT,
				amount: 0n,
				createWriteClient: () => ({}) as never,
				memoryClient,
				repAddress: getAddress('0x00000000000000000000000000000000000000b1'),
				zoltarAddress: getAddress('0x00000000000000000000000000000000000000b2'),
			}),
		).rejects.toThrow('Simulation REP mint amount must be greater than zero')
	})

	test('mints mocked REP balances through the token ABI and skips Zoltar bootstrap when token code is missing', async () => {
		const repAddress = getAddress('0x00000000000000000000000000000000000000d1')
		const zoltarAddress = getAddress('0x00000000000000000000000000000000000000d2')
		const storageWrites: MemoryStorageCall[] = []
		const repState = createRepTokenMockState()
		const setStorageAt = mock(async (payload: { address: string; index: string; value: string }) => {
			storageWrites.push(payload)
			if (payload.address.toLowerCase() === repAddress.toLowerCase()) repState.theoreticalSupply = BigInt(payload.value)
		})
		const memoryClient = {
			setStorageAt,
			getCode: async () => '0x',
			getBalance: async () => 0n,
			getTransactionCount: async () => 0n,
			impersonateAccount: async () => undefined,
			setBalance: async () => undefined,
			setNonce: async () => undefined,
		} as never

		await mintSimulationGenesisRep({
			accountAddress: MOCK_PRIMARY_ACCOUNT,
			amount: 11n,
			createWriteClient: accountAddress => createRepTokenWriteClient({ accountAddress, repAddress, repState, zoltarAddress }),
			memoryClient,
			repAddress,
			zoltarAddress,
		})

		expect(repState.totalSupply).toBe(11n)
		expect(repState.theoreticalSupply).toBe(11n)
		expect(repState.balances.get(MOCK_PRIMARY_ACCOUNT.toLowerCase())).toBe(11n)
		expect(storageWrites.filter(write => write.address === zoltarAddress)).toHaveLength(0)
	})

	test('updates Zoltar genesis pointer when the REP token is already deployed', async () => {
		const repAddress = getAddress('0x00000000000000000000000000000000000000e1')
		const zoltarAddress = getAddress('0x00000000000000000000000000000000000000e2')
		const storageWrites: MemoryStorageCall[] = []
		const repState = createRepTokenMockState()
		const memoryClient = {
			setStorageAt: async (payload: { address: string; index: string; value: string }) => {
				storageWrites.push(payload)
				if (payload.address.toLowerCase() === repAddress.toLowerCase()) repState.theoreticalSupply = BigInt(payload.value)
			},
			getCode: async ({ address }: { address: string }) => (address.toLowerCase() === repAddress.toLowerCase() ? '0x01' : '0x01'),
			getBalance: async () => 0n,
			getTransactionCount: async () => 0n,
			impersonateAccount: async () => undefined,
			setBalance: async () => undefined,
			setNonce: async () => undefined,
		} as never

		await mintSimulationGenesisRep({
			accountAddress: MOCK_PRIMARY_ACCOUNT,
			amount: 11n,
			createWriteClient: accountAddress => createRepTokenWriteClient({ accountAddress, repAddress, repState, zoltarAddress }),
			memoryClient,
			repAddress,
			zoltarAddress,
		})

		const zoltarWrites = storageWrites.filter(write => write.address === zoltarAddress)

		expect(repState.totalSupply).toBe(11n)
		expect(repState.theoreticalSupply).toBe(11n)
		expect(zoltarWrites).toHaveLength(2)
	})

	test.each(['zoltar', 'openOracle'] satisfies DeploymentStep['id'][])('bootstraps a %s deployment plan using an explicit simulation token authority', async stepId => {
		const profile = createBaselineProfile()
		const progressCalls: string[] = []
		const progress = async ({ label }: { label: string; value: number }) => {
			progressCalls.push(label)
		}
		const writeCalls: Array<{ account: Address; to: Address | undefined; value: bigint | undefined }> = []
		const memoryClient = {
			tevmReady: async () => undefined,
			getBlock: async () => ({ timestamp: SIMULATION_INITIAL_TIMESTAMP }),
			getBalance: async () => 0n,
			getStorageAt: async () => toHex(0n, { size: 32 }),
			setStorageAt: async () => undefined,
			getTransactionCount: async () => 0n,
			setCode: async () => undefined,
			impersonateAccount: async () => undefined,
			setBalance: async () => undefined,
			setNonce: async () => undefined,
			getCode: async () => '0x01',
		} as never
		const createWriteClient = (accountAddress: Address) =>
			({
				sendTransaction: async (request: { to?: Address; value?: bigint }) => {
					writeCalls.push({ account: accountAddress, to: request.to, value: request.value })
					return `0x${writeCalls.length.toString(16).padStart(64, '0')}` as `0x${string}`
				},
				waitForTransactionReceipt: async () => createSuccessfulReceipt(accountAddress),
				getCode: async () => '0x01',
				writeContract: async () => '0x01',
			}) as never

		await bootstrapSimulationChain({
			applyScenario,
			accounts: [MOCK_PRIMARY_ACCOUNT, MOCK_SECONDARY_ACCOUNT],
			createReadClient: () => ({}) as never,
			createWriteClient,
			memoryClient,
			getDeploymentSteps: () => [{ ...ZOLTAR_SIMULATION_STEP, id: stepId }],
			zoltarAddress: ZOLTAR_SIMULATION_STEP.address,
			onProgress: progress,
			primaryAccount: MOCK_PRIMARY_ACCOUNT,
			profile,
			scenario: 'baseline',
		})

		expect(progressCalls).toContain('Initializing simulation engine')
		expect(progressCalls).toContain('Preparing simulation chain')
		expect(progressCalls).toContain('Using baseline simulation scenario')
		expect(progressCalls).toContain('Simulation scenario ready')
		expect(writeCalls.length).toBeGreaterThan(1)
		expect(writeCalls.some(call => call.value !== undefined)).toBe(true)
	})

	test('rejects security-pool bootstrap when the primary QA account is missing', async () => {
		const memoryClient = createBootstrapMemoryClient()
		const writeCalls: Array<{ account: Address; to: Address | undefined; value: bigint | undefined }> = []
		const createWriteClient = (accountAddress: Address) =>
			({
				sendTransaction: async (request: { to?: Address; value?: bigint }) => {
					writeCalls.push({ account: accountAddress, to: request.to, value: request.value })
					return `0x${writeCalls.length.toString(16).padStart(64, '0')}` as `0x${string}`
				},
				waitForTransactionReceipt: async () => createSuccessfulReceipt(accountAddress),
				getCode: async () => '0x01',
				writeContract: async () => '0x01',
			}) as never

		await expect(
			bootstrapSimulationChain({
				applyScenario,
				accounts: [],
				createReadClient: () => ({ kind: 'read-client' }) as never,
				createWriteClient,
				memoryClient,
				getDeploymentSteps,
				zoltarAddress: getZoltarAddress(),
				primaryAccount: MOCK_PRIMARY_ACCOUNT,
				onProgress: () => undefined,
				profile: createBaselineProfile(),
				scenario: 'security-pool',
			}),
		).rejects.toThrow('Expected simulation portfolio owner')
	})

	test('boots deployed simulation scenario when all contracts are already present', async () => {
		const memoryClient = createBootstrapMemoryClient({
			getCode: async () => '0x01',
		})
		const progressCalls: string[] = []
		const writeCalls: Array<{ account: Address; to: Address | undefined; value: bigint | undefined }> = []
		const createWriteClient = (accountAddress: Address) =>
			({
				sendTransaction: async (request: { to?: Address; value?: bigint }) => {
					writeCalls.push({ account: accountAddress, to: request.to, value: request.value })
					return `0x${writeCalls.length.toString(16).padStart(64, '0')}` as `0x${string}`
				},
				waitForTransactionReceipt: async () => createSuccessfulReceipt(accountAddress),
				getCode: async () => '0x01',
				writeContract: async () => '0x01',
			}) as never

		await bootstrapSimulationChain({
			applyScenario,
			accounts: [MOCK_PRIMARY_ACCOUNT, MOCK_SECONDARY_ACCOUNT],
			createReadClient: () => ({ kind: 'read-client' }) as never,
			createWriteClient,
			memoryClient,
			getDeploymentSteps,
			zoltarAddress: getZoltarAddress(),
			primaryAccount: MOCK_PRIMARY_ACCOUNT,
			onProgress: payload => {
				progressCalls.push(payload.label)
			},
			profile: createBaselineProfile(),
			scenario: 'deployed',
		})

		expect(progressCalls).toContain('Initializing simulation engine')
		expect(progressCalls).toContain('Simulation scenario ready')
		expect(writeCalls.length).toBeGreaterThan(1)
	})

	test('throws when simulation initialization times out', async () => {
		const originalSetTimeout = globalThis.setTimeout
		const memoryClient = createBootstrapMemoryClient({
			tevmReady: async () => new Promise(() => undefined),
			getBlock: async () => ({ timestamp: SIMULATION_INITIAL_TIMESTAMP }),
		})
		const createWriteClient = () =>
			({
				sendTransaction: async () => '0x01',
				waitForTransactionReceipt: async () => createSuccessfulReceipt(MOCK_PRIMARY_ACCOUNT),
				getCode: async () => '0x01',
				writeContract: async () => '0x01',
			}) as never

		globalThis.setTimeout = ((handler: TimerHandler) => {
			if (typeof handler === 'function') {
				handler()
			}
			return 1 as unknown as ReturnType<typeof setTimeout>
		}) as unknown as typeof globalThis.setTimeout

		try {
			await expect(
				bootstrapSimulationChain({
					applyScenario,
					accounts: [MOCK_PRIMARY_ACCOUNT, MOCK_SECONDARY_ACCOUNT],
					createReadClient: () => ({}) as never,
					createWriteClient: createWriteClient,
					memoryClient,
					getDeploymentSteps,
					zoltarAddress: getZoltarAddress(),
					onProgress: () => undefined,
					primaryAccount: MOCK_PRIMARY_ACCOUNT,
					profile: createBaselineProfile(),
					scenario: 'baseline',
				}),
			).rejects.toThrow('Simulation engine initialization timed out')
		} finally {
			globalThis.setTimeout = originalSetTimeout
		}
	})
})
