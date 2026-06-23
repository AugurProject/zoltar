/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { MAINNET_NETWORK_PROFILE, MAINNET_WETH_ADDRESS, type NetworkProfile } from '../lib/networkProfile.js'
import { SIMULATION_INITIAL_TIMESTAMP } from '../simulation/clock.js'
import { bootstrapSimulationChain, mintSimulationGenesisRep, predictSimulationTokenAddresses } from '../simulation/bootstrap.js'
import { type Address, getAddress, getCreateAddress, toHex } from 'viem'

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
				case 'getUniverseTheoreticalSupply':
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
					const normalizedRecipient = recipient.toLowerCase()
					repState.balances.set(normalizedRecipient, (repState.balances.get(normalizedRecipient) ?? 0n) + amount)
					repState.totalSupply += amount
					break
				}
				case 'setMaxTheoreticalSupply': {
					const nextTheoreticalSupply = args?.[0]
					if (typeof nextTheoreticalSupply !== 'bigint') throw new Error('Invalid theoretical supply argument')
					repState.theoreticalSupply = nextTheoreticalSupply
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

function createMockedBootstrapDependencies({ accounts, scenario, profile }: { accounts: readonly string[]; scenario: 'security-pool' | 'securitypoolx2' | 'securitypoolx2-auction'; profile: NetworkProfile }) {
	const eth = 10n ** 18n
	const primaryVaultRepDeposit = 10_000n * eth
	const x2PrimaryVaultRepDeposit = 12_000n * eth
	const x2SecondaryVaultRepDeposit = primaryVaultRepDeposit
	const openOracleAddress = getAddress('0x0000000000000000000000000000000000000ab1')
	const token1Address = profile.genesisRepTokenAddress
	const token2Address = profile.wethAddress
	const deployments = [
		{
			deployed: true,
			id: 'zoltar',
			label: 'Zoltar',
			address: getAddress('0x00000000000000000000000000000000000000a1'),
		},
		{
			id: 'securityPoolFactory',
			label: 'Security Pool Factory',
			address: getAddress('0x00000000000000000000000000000000000000a2'),
			deployed: false,
		},
	]
	const poolAddresses: Address[] = [getAddress('0x00000000000000000000000000000000000000b1'), getAddress('0x00000000000000000000000000000000000000b2')]
	const firstDeploymentAddress = deployments[0]?.address ?? getAddress('0x00000000000000000000000000000000000000a1')
	const zoltarAddress = firstDeploymentAddress
	const primaryPoolAddress = poolAddresses[0] ?? getAddress('0x00000000000000000000000000000000000000b1')
	const secondaryPoolAddress = poolAddresses[1] ?? getAddress('0x00000000000000000000000000000000000000b2')
	const yesChildPoolAddress = getAddress('0x00000000000000000000000000000000000000c1')
	const deployedCodes = new Map<string, string>([[firstDeploymentAddress, '0x01']])
	const managerByPool = new Map<Address, Address>()
	const openOracleByManager = new Map<Address, Address>()
	const managerToPool = new Map<Address, Address>()
	const repState = createRepTokenMockState()
	const vaultAddressByPool: Record<Address, Address[]> = {}
	if (scenario === 'security-pool') {
		vaultAddressByPool[primaryPoolAddress] = [getAddress(accounts[0] ?? MOCK_PRIMARY_ACCOUNT)]
	} else {
		vaultAddressByPool[primaryPoolAddress] = [getAddress(accounts[0] ?? MOCK_PRIMARY_ACCOUNT), getAddress(accounts[1] ?? MOCK_SECONDARY_ACCOUNT)]
		vaultAddressByPool[secondaryPoolAddress] = [getAddress(accounts[0] ?? MOCK_PRIMARY_ACCOUNT), getAddress(accounts[1] ?? MOCK_SECONDARY_ACCOUNT)]
	}
	const poolPlan = scenario === 'security-pool' ? [{ question: 'Will this resolve?' }] : [{ question: 'Will this resolve? (securitypoolx2 #1)' }, { question: 'Will this resolve? (securitypoolx2 #2)' }]
	const repDeposits: Record<Address, Record<Address, bigint>> = {}
	const securityBondAllowances: Record<Address, Record<Address, bigint>> = {}
	const pendingOperations: Record<Address, { targetVault: Address; amount: bigint; operationId: bigint }> = {}
	let marketCount = 0
	let securityPoolCount = 0

	for (const poolAddress of poolAddresses) {
		const [primaryVault, secondaryVault] = vaultAddressByPool[poolAddress] ?? []
		if (primaryVault === undefined) continue
		repDeposits[poolAddress] = {
			[primaryVault]: scenario === 'security-pool' ? primaryVaultRepDeposit : x2PrimaryVaultRepDeposit,
		}
		securityBondAllowances[poolAddress] = {
			[primaryVault]: 0n,
		}
		if (secondaryVault !== undefined) {
			repDeposits[poolAddress][secondaryVault] = x2SecondaryVaultRepDeposit
			securityBondAllowances[poolAddress][secondaryVault] = 0n
		}
	}

	const state = {
		callLog: {
			approveErc20: 0,
			createMarket: 0,
			createSecurityPool: 0,
			createCompleteSetInSecurityPool: 0,
			depositRepToSecurityPool: 0,
			loadAllSecurityPools: 0,
			loadErc20Balance: 0,
			loadForkAuctionDetails: 0,
			loadOracleManagerDetails: 0,
			loadOpenOracleReportDetails: 0,
			loadReportingDetails: 0,
			loadSecurityVaultDetails: 0,
			loadZoltarUniverseSummary: 0,
			migrateRepToZoltarFromSecurityPool: 0,
			queueOracleManagerOperation: 0,
			reportOutcomeInSecurityPool: 0,
			settleOracleReport: 0,
			startTruthAuctionForSecurityPool: 0,
			submitInitialOracleReport: 0,
			submitTruthAuctionBid: 0,
			writeContract: 0,
			setSecurityPoolDeployCalls: 0,
			setSimulationCodeCalls: 0,
		},
		deploymentCodeRequests: [] as string[],
	}
	const seededReportDistribution = new Map<string, boolean>()
	const getReportKey = (openOracleAddress: string, reportId: bigint) => `${openOracleAddress}-${reportId.toString()}`

	const getPoolAddressForMarket = (index: number): Address => poolAddresses[index] ?? primaryPoolAddress
	const getManagerForPool = (poolAddress: Address) => {
		const existingManager = managerByPool.get(poolAddress)
		if (existingManager !== undefined) return existingManager
		const nextManager = getAddress(`0x00000000000000000000000000000000000001${poolAddress.slice(-2)}`)
		managerByPool.set(poolAddress, nextManager)
		openOracleByManager.set(nextManager, openOracleAddress)
		managerToPool.set(nextManager, poolAddress)
		return nextManager
	}

	const settleSecurityBondAllowance = (managerAddress: Address, accountAddress: Address) => {
		const operation = pendingOperations[managerAddress]
		if (operation === undefined || operation.targetVault !== accountAddress) return
		const ownerPool = managerToPool.get(managerAddress)
		if (ownerPool === undefined) return
		securityBondAllowances[ownerPool] ??= {}
		securityBondAllowances[ownerPool][accountAddress] = operation.amount
		delete pendingOperations[managerAddress]
	}

	mock.module('../contracts.js', () => ({
		approveErc20: mock(async () => {
			state.callLog.approveErc20 += 1
			return {
				action: 'approveRep',
				hash: '0x01',
			} as never
		}),
		createMarket: mock(async () => {
			state.callLog.createMarket += 1
			const questionId = `0x${(marketCount + 1).toString(16).padStart(2, '0')}`
			marketCount += 1
			return {
				createQuestionHash: `0x${marketCount.toString(16)}`,
				marketType: 'binary',
				questionId,
			}
		}),
		createSecurityPool: mock(async (_client: never, input: { questionId: bigint; securityMultiplier: bigint }) => {
			state.callLog.createSecurityPool += 1
			const poolAddress = getPoolAddressForMarket(securityPoolCount)
			const managerAddress = getManagerForPool(poolAddress)
			securityPoolCount += 1
			return {
				deployPoolHash: `0x${securityPoolCount.toString(16)}`,
				questionId: input.questionId.toString(16),
				securityPoolAddress: poolAddress,
				securityMultiplier: input.securityMultiplier,
				universeId: 0n,
				managerAddress,
			} as never
		}),
		createCompleteSetInSecurityPool: mock(async () => {
			state.callLog.createCompleteSetInSecurityPool += 1
			return {
				action: 'createCompleteSet',
				hash: '0x01',
				securityPoolAddress: primaryPoolAddress,
				universeId: 0n,
			} as never
		}),
		createChildUniverseFromSecurityPool: mock(
			async () =>
				({
					action: 'createChildUniverse',
					hash: '0x01',
					securityPoolAddress: primaryPoolAddress,
					universeId: 1n,
				}) as never,
		),
		depositRepToSecurityPool: mock(async (client: { account?: Address }, poolAddress: Address, amount: bigint) => {
			state.callLog.depositRepToSecurityPool += 1
			const vaultAddress = vaultAddressByPool[poolAddress]?.find((vaultAddressCandidate: Address) => vaultAddressCandidate === client.account) ?? vaultAddressByPool[poolAddress]?.[0]
			if (vaultAddress !== undefined) {
				repDeposits[poolAddress] ??= {}
				repDeposits[poolAddress][vaultAddress] = amount
			}
			return {
				action: 'depositRep',
				hash: '0x01',
			} as never
		}),
		forkZoltarWithOwnEscalation: mock(
			async () =>
				({
					action: 'forkWithOwnEscalation',
					hash: '0x01',
					securityPoolAddress: primaryPoolAddress,
					universeId: 0n,
				}) as never,
		),
		getDeploymentSteps: mock(() =>
			deployments.map(step => ({
				id: step.id,
				label: step.label,
				address: step.address,
				deploy: async () => {
					state.callLog.setSecurityPoolDeployCalls += 1
					deployedCodes.set(step.address, '0x01')
					return {
						address: step.address,
						action: 'none',
						hash: `0x${Math.random().toString(16).slice(2)}`,
					} as never
				},
			})),
		),
		loadAllSecurityPools: mock(async () => {
			state.callLog.loadAllSecurityPools += 1
			const parentPools = poolPlan.map((_pool, index) => {
				const securityPoolAddress = getPoolAddressForMarket(index)
				const vaultAddresses = vaultAddressByPool[securityPoolAddress] ?? []
				const vaultRows: Array<{ vaultAddress: Address; repDepositShare: bigint; securityBondAllowance: bigint }> = vaultAddresses.map(vaultAddress => ({
					vaultAddress,
					repDepositShare: repDeposits[securityPoolAddress]?.[vaultAddress] ?? 0n,
					securityBondAllowance: securityBondAllowances[securityPoolAddress]?.[vaultAddress] ?? 0n,
				}))
				return {
					marketDetails: {
						title: poolPlan[index]?.question ?? `Pool ${index + 1}`,
					},
					parent: getAddress('0x0000000000000000000000000000000000000000'),
					questionOutcome: 'none',
					securityPoolAddress,
					vaultCount: BigInt(vaultRows.length),
					totalRepDeposit: vaultRows.reduce<bigint>((sum, row) => sum + row.repDepositShare, 0n),
					totalSecurityBondAllowance: vaultRows.reduce<bigint>((sum, row) => sum + row.securityBondAllowance, 0n),
					vaults: vaultRows,
				} as never
			})
			if (scenario !== 'securitypoolx2-auction') return parentPools
			return [
				...parentPools,
				{
					parent: primaryPoolAddress,
					questionOutcome: 'yes',
					securityPoolAddress: yesChildPoolAddress,
					systemState: 'forkTruthAuction',
					totalRepDeposit: 0n,
					totalSecurityBondAllowance: 0n,
					vaultCount: 0n,
					vaults: [],
				} as never,
			]
		}),
		loadErc20Balance: mock(async () => {
			state.callLog.loadErc20Balance += 1
			return 0n
		}),
		loadForkAuctionDetails: mock(async () => {
			state.callLog.loadForkAuctionDetails += 1
			return {
				currentTime: SIMULATION_INITIAL_TIMESTAMP,
				migratedRep: 1n,
				securityPoolAddress: primaryPoolAddress,
				systemState: 'forkTruthAuction',
				truthAuction: {
					finalized: false,
				},
				truthAuctionAddress: getAddress('0x0000000000000000000000000000000000000aa1'),
				truthAuctionStartedAt: 1n,
				universeId: 1n,
			} as never
		}),
		loadOracleManagerDetails: mock(async (_client: never, managerAddress: Address) => {
			state.callLog.loadOracleManagerDetails += 1
			const pendingOperation = pendingOperations[managerAddress]
			return {
				callbackStateHash: pendingOperation === undefined ? undefined : (`0x${'11'.repeat(31)}aa` as `0x${string}`),
				exactToken1Report: pendingOperation === undefined ? undefined : 100n,
				isPriceValid: true,
				lastPrice: 0n,
				lastSettlementTimestamp: 1n,
				managerAddress,
				openOracleAddress: openOracleByManager.get(managerAddress) ?? openOracleAddress,
				pendingOperation: pendingOperation
					? {
							amount: pendingOperation.amount,
							initiatorVault: pendingOperation.targetVault,
							operation: 'setSecurityBondsAllowance',
							operationId: pendingOperation.operationId,
							targetVault: pendingOperation.targetVault,
						}
					: undefined,
				pendingOperationSlotId: pendingOperation === undefined ? 0n : 1n,
				pendingSettlementOperationIds: pendingOperation === undefined ? [] : [1n],
				pendingReportId: pendingOperation === undefined ? 0n : 1n,
				priceValidUntilTimestamp: 0n,
				requestPriceEthCost: 0n,
				token1: token1Address,
				token2: token2Address,
			} as never
		}),
		loadOpenOracleReportDetails: mock(async (_client: never, openOracleAddress: string, reportId: bigint) => {
			state.callLog.loadOpenOracleReportDetails += 1
			const reportKey = getReportKey(openOracleAddress, reportId)
			return {
				isDistributed: seededReportDistribution.get(reportKey) ?? reportId === 0n,
			} as never
		}),
		loadReportingDetails: mock(async () => {
			state.callLog.loadReportingDetails += 1
			return {
				currentTime: SIMULATION_INITIAL_TIMESTAMP,
				marketDetails: {
					endTime: SIMULATION_INITIAL_TIMESTAMP - 1n,
				},
			} as never
		}),
		loadSecurityVaultDetails: mock(async (_client: never, securityPoolAddress: Address, vaultAddress: Address) => {
			state.callLog.loadSecurityVaultDetails += 1
			return {
				currentRetentionRate: 0n,
				escalationEscrowedRep: 0n,
				managerAddress: getManagerForPool(securityPoolAddress),
				poolOwnershipDenominator: 0n,
				repDepositShare: repDeposits[securityPoolAddress]?.[vaultAddress] ?? 0n,
				repToken: profile.genesisRepTokenAddress,
				securityBondAllowance: securityBondAllowances[securityPoolAddress]?.[vaultAddress] ?? 0n,
				securityPoolAddress,
				totalSecurityBondAllowance: Object.values(securityBondAllowances[securityPoolAddress] ?? {}).reduce<bigint>((sum, amount) => sum + (typeof amount === 'bigint' ? amount : 0n), 0n),
				unpaidEthFees: 0n,
				universeId: 0n,
				vaultAddress,
			} as never
		}),
		loadZoltarUniverseSummary: mock(async () => {
			state.callLog.loadZoltarUniverseSummary += 1
			return {
				forkThreshold: 100n,
			} as never
		}),
		migrateRepToZoltarFromSecurityPool: mock(async () => {
			state.callLog.migrateRepToZoltarFromSecurityPool += 1
			return {
				action: 'migrateRepToZoltar',
				hash: '0x01',
				securityPoolAddress: primaryPoolAddress,
				universeId: 0n,
			} as never
		}),
		queueOracleManagerOperation: mock(async (_client: never, managerAddress: Address, operation: string, targetVault: Address, amount: bigint, _validForSeconds: bigint) => {
			state.callLog.queueOracleManagerOperation += 1
			if (operation === 'setSecurityBondsAllowance') {
				pendingOperations[managerAddress] = {
					targetVault,
					amount,
					operationId: BigInt(Object.keys(pendingOperations).length + 1),
				}
			}
			return {
				stagedExecution: {
					action: 'queueOperation',
					success: true,
					errorMessage: undefined,
				},
				hash: '0x01',
			} as never
		}),
		reportOutcomeInSecurityPool: mock(async () => {
			state.callLog.reportOutcomeInSecurityPool += 1
			return {
				action: 'reportOutcome',
				hash: '0x01',
				securityPoolAddress: primaryPoolAddress,
			} as never
		}),
		settleOracleReport: mock(async (_client: never, openOracleAddress: string, reportId: bigint) => {
			state.callLog.settleOracleReport += 1
			seededReportDistribution.set(getReportKey(openOracleAddress, reportId), true)
			return { hash: '0x01' } as never
		}),
		startTruthAuctionForSecurityPool: mock(async () => {
			state.callLog.startTruthAuctionForSecurityPool += 1
			return {
				action: 'startTruthAuction',
				hash: '0x01',
				securityPoolAddress: primaryPoolAddress,
				universeId: 1n,
			} as never
		}),
		submitInitialOracleReport: mock(async () => {
			state.callLog.submitInitialOracleReport += 1
			return { action: 'submitInitialReport', hash: '0x01' } as never
		}),
		submitTruthAuctionBid: mock(async () => {
			state.callLog.submitTruthAuctionBid += 1
			return {
				action: 'submitBid',
				hash: '0x01',
				securityPoolAddress: primaryPoolAddress,
				universeId: 1n,
			} as never
		}),
	}))

	mock.module('../simulation/clock.js', () => ({
		advanceSimulationTime: async () => undefined,
		getSimulationChainTimestamp: async () => 1_000n,
		initializeSimulationClock: async () => 1_000n,
	}))

	const memoryClient = {
		getBlock: async () => ({ timestamp: 1_000n }),
		getBalance: async () => 0n,
		getStorageAt: async () => toHex(0n, { size: 32 }),
		setStorageAt: async () => undefined,
		getCode: async ({ address }: { address: Address }) => {
			state.deploymentCodeRequests.push(address)
			return deployedCodes.get(address) ?? '0x'
		},
		getTransactionCount: async () => 0n,
		setCode: async ({ address, bytecode }: { address: Address; bytecode: string }) => {
			state.callLog.setSimulationCodeCalls += 1
			deployedCodes.set(address, bytecode === '' ? '0x' : '0x01')
		},
		impersonateAccount: async () => undefined,
		setBalance: async () => undefined,
		setNonce: async () => undefined,
		tevmReady: async () => undefined,
	} as never

	const writeCalls: Array<{ account: Address; to: Address | undefined; value: bigint | undefined }> = []
	const createWriteClient = (accountAddress: Address) =>
		({
			readContract: async ({ address, args, functionName }: { address: Address; args?: unknown[]; functionName: string }) => {
				if (address.toLowerCase() !== profile.genesisRepTokenAddress.toLowerCase()) throw new Error(`Unexpected contract read for ${address}`)
				switch (functionName) {
					case 'getTotalTheoreticalSupply':
						return repState.theoreticalSupply
					case 'totalSupply':
						return repState.totalSupply
					case 'balanceOf': {
						const requestedAddress = args?.[0]
						if (typeof requestedAddress !== 'string') throw new Error('Missing balanceOf account argument')
						return repState.balances.get(requestedAddress.toLowerCase()) ?? 0n
					}
					default:
						throw new Error(`Unexpected read function ${functionName}`)
				}
			},
			account: accountAddress,
			sendTransaction: async (request: { to?: Address; value?: bigint }) => {
				writeCalls.push({ account: accountAddress, to: request.to, value: request.value })
				return `0x${writeCalls.length.toString(16).padStart(64, '0')}` as `0x${string}`
			},
			waitForTransactionReceipt: async () => createSuccessfulReceipt(accountAddress),
			getCode: async () => '0x01',
			writeContract: async ({ address, args, functionName }: { address: Address; args?: unknown[]; functionName: string }) => {
				if (address.toLowerCase() === profile.genesisRepTokenAddress.toLowerCase()) {
					if (accountAddress.toLowerCase() !== zoltarAddress.toLowerCase()) throw new Error(`Expected REP writes from Zoltar, got ${accountAddress}`)
					if (functionName === 'mint') {
						const recipient = args?.[0]
						const amount = args?.[1]
						if (typeof recipient !== 'string' || typeof amount !== 'bigint') throw new Error('Invalid mint arguments')
						const normalizedRecipient = recipient.toLowerCase()
						repState.balances.set(normalizedRecipient, (repState.balances.get(normalizedRecipient) ?? 0n) + amount)
						repState.totalSupply += amount
						return '0x01'
					}
					if (functionName === 'setMaxTheoreticalSupply') {
						const nextTheoreticalSupply = args?.[0]
						if (typeof nextTheoreticalSupply !== 'bigint') throw new Error('Invalid theoretical supply argument')
						repState.theoreticalSupply = nextTheoreticalSupply
						return '0x01'
					}
					throw new Error(`Unexpected REP write function ${functionName}`)
				}
				state.callLog.writeContract += 1
				const pending = pendingOperations[address]
				if (pending !== undefined) {
					settleSecurityBondAllowance(address, pending.targetVault)
				}
				return '0x01'
			},
		}) as never

	return { createWriteClient, memoryClient, state, writeCalls }
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

describe('simulation bootstrap', () => {
	afterEach(() => {
		mock.restore()
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
		expect(storageWrites).toHaveLength(0)
	})

	test('updates Zoltar genesis pointer when the REP token is already deployed', async () => {
		const repAddress = getAddress('0x00000000000000000000000000000000000000e1')
		const zoltarAddress = getAddress('0x00000000000000000000000000000000000000e2')
		const storageWrites: MemoryStorageCall[] = []
		const repState = createRepTokenMockState()
		const memoryClient = {
			setStorageAt: async (payload: { address: string; index: string; value: string }) => {
				storageWrites.push(payload)
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

	test('bootstraps baseline simulation chain using seeded progress and mocked clients', async () => {
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
			accounts: [MOCK_PRIMARY_ACCOUNT, MOCK_SECONDARY_ACCOUNT],
			createReadClient: () => ({}) as never,
			createWriteClient,
			memoryClient,
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

	test('mirrors seeded REP supply at the Zoltar constructor genesis address for simulation profiles', async () => {
		const profile = createBaselineProfile({
			genesisRepTokenAddress: getAddress('0x00000000000000000000000000000000000000d1'),
		})
		const storageWrites: MemoryStorageCall[] = []
		const setCodeCalls: Array<{ address: string; bytecode: string }> = []
		const writeCalls: Array<{ account: Address; to: Address | undefined; value: bigint | undefined }> = []
		const memoryClient = {
			tevmReady: async () => undefined,
			getBlock: async () => ({ timestamp: SIMULATION_INITIAL_TIMESTAMP }),
			getBalance: async () => 0n,
			getStorageAt: async () => toHex(0n, { size: 32 }),
			setStorageAt: async (payload: { address: string; index: string; value: string }) => {
				storageWrites.push(payload)
			},
			getTransactionCount: async () => 0n,
			setCode: async (payload: { address: string; bytecode: string }) => {
				setCodeCalls.push(payload)
			},
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
			accounts: [MOCK_PRIMARY_ACCOUNT, MOCK_SECONDARY_ACCOUNT],
			createReadClient: () => ({}) as never,
			createWriteClient,
			memoryClient,
			onProgress: () => undefined,
			primaryAccount: MOCK_PRIMARY_ACCOUNT,
			profile,
			scenario: 'baseline',
		})

		const constructorRepAddress = MAINNET_NETWORK_PROFILE.genesisRepTokenAddress.toLowerCase()
		const expectedSupply = 2n * 100_000_000n * 10n ** 18n
		const constructorCodeWrite = setCodeCalls.find(call => call.address.toLowerCase() === constructorRepAddress)
		const constructorSupplyWrite = storageWrites.find(write => write.address.toLowerCase() === constructorRepAddress)

		expect(constructorCodeWrite).toBeDefined()
		expect(constructorSupplyWrite).toEqual({
			address: MAINNET_NETWORK_PROFILE.genesisRepTokenAddress,
			index: toHex(5n, { size: 32 }),
			value: toHex(expectedSupply, { size: 32 }),
		})
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
				accounts: [],
				createReadClient: () => ({ kind: 'read-client' }) as never,
				createWriteClient,
				memoryClient,
				primaryAccount: MOCK_PRIMARY_ACCOUNT,
				onProgress: () => undefined,
				profile: createBaselineProfile(),
				scenario: 'security-pool',
			}),
		).rejects.toThrow('Expected seeded simulation QA account A1')
	})

	test('rejects securitypoolx2 bootstrap when the secondary QA account is missing', async () => {
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
				accounts: [MOCK_PRIMARY_ACCOUNT],
				createReadClient: () => ({ kind: 'read-client' }) as never,
				createWriteClient,
				memoryClient,
				primaryAccount: MOCK_PRIMARY_ACCOUNT,
				onProgress: () => undefined,
				profile: createBaselineProfile(),
				scenario: 'securitypoolx2',
			}),
		).rejects.toThrow('Expected simulation QA account B2 for securitypoolx2')
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
			accounts: [MOCK_PRIMARY_ACCOUNT, MOCK_SECONDARY_ACCOUNT],
			createReadClient: () => ({ kind: 'read-client' }) as never,
			createWriteClient,
			memoryClient,
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
					accounts: [MOCK_PRIMARY_ACCOUNT, MOCK_SECONDARY_ACCOUNT],
					createReadClient: () => ({}) as never,
					createWriteClient: createWriteClient,
					memoryClient,
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

	test('boots the security-pool simulation path with seeded pool construction and oracle report settling', async () => {
		const profile = createBaselineProfile()
		const { createWriteClient, memoryClient, state, writeCalls } = createMockedBootstrapDependencies({
			accounts: [MOCK_PRIMARY_ACCOUNT],
			scenario: 'security-pool',
			profile,
		})

		const { bootstrapSimulationChain } = await import(`../simulation/bootstrap.js?case=${crypto.randomUUID()}`)

		const progressCalls: string[] = []
		await bootstrapSimulationChain({
			accounts: [MOCK_PRIMARY_ACCOUNT],
			createReadClient: () => ({}) as never,
			createWriteClient,
			memoryClient,
			onProgress: async (payload: { label: string; value: number }) => {
				progressCalls.push(payload.label)
			},
			primaryAccount: MOCK_PRIMARY_ACCOUNT,
			profile,
			scenario: 'security-pool',
		})

		expect(state.callLog.createMarket).toBe(1)
		expect(state.callLog.createSecurityPool).toBe(1)
		expect(progressCalls).toContain('Seeded security-pool scenario is ready')
		expect(state.callLog.setSecurityPoolDeployCalls).toBe(1)
		expect(state.callLog.loadAllSecurityPools).toBe(1)
		expect(state.callLog.settleOracleReport).toBe(1)
		expect(state.callLog.submitInitialOracleReport).toBe(1)
		expect(state.callLog.writeContract).toBe(1)
		expect(writeCalls.length).toBeGreaterThan(0)
	})

	test('boots the securitypoolx2 simulation path with secondary vault security-bond allowance execution', async () => {
		const profile = createBaselineProfile()
		const { createWriteClient, memoryClient, state, writeCalls } = createMockedBootstrapDependencies({
			accounts: [MOCK_PRIMARY_ACCOUNT, MOCK_SECONDARY_ACCOUNT],
			scenario: 'securitypoolx2',
			profile,
		})
		const { bootstrapSimulationChain } = await import(`../simulation/bootstrap.js?case=${crypto.randomUUID()}`)

		await bootstrapSimulationChain({
			accounts: [MOCK_PRIMARY_ACCOUNT, MOCK_SECONDARY_ACCOUNT],
			createReadClient: () => ({}) as never,
			createWriteClient,
			memoryClient,
			onProgress: async () => undefined,
			primaryAccount: MOCK_PRIMARY_ACCOUNT,
			profile,
			scenario: 'securitypoolx2',
		})

		expect(state.callLog.createMarket).toBe(2)
		expect(state.callLog.createSecurityPool).toBe(2)
		expect(state.callLog.settleOracleReport).toBe(1)
		expect(state.callLog.submitInitialOracleReport).toBe(2)
		expect(state.callLog.loadOpenOracleReportDetails).toBe(8)
		expect(state.callLog.writeContract).toBe(4)
		expect(state.callLog.queueOracleManagerOperation).toBe(4)
		expect(state.callLog.setSecurityPoolDeployCalls).toBe(1)
		expect(writeCalls.length).toBeGreaterThan(0)
	})

	test('boots the securitypoolx2-auction simulation path with forked child-auction seeding and ten bids', async () => {
		const profile = createBaselineProfile()
		const { createWriteClient, memoryClient, state, writeCalls } = createMockedBootstrapDependencies({
			accounts: [MOCK_PRIMARY_ACCOUNT, MOCK_SECONDARY_ACCOUNT],
			scenario: 'securitypoolx2-auction',
			profile,
		})
		const { bootstrapSimulationChain } = await import(`../simulation/bootstrap.js?case=${crypto.randomUUID()}`)

		await bootstrapSimulationChain({
			accounts: [MOCK_PRIMARY_ACCOUNT, MOCK_SECONDARY_ACCOUNT],
			createReadClient: () => ({}) as never,
			createWriteClient,
			memoryClient,
			onProgress: async () => undefined,
			primaryAccount: MOCK_PRIMARY_ACCOUNT,
			profile,
			scenario: 'securitypoolx2-auction',
		})

		expect(state.callLog.createMarket).toBe(2)
		expect(state.callLog.createSecurityPool).toBe(2)
		expect(state.callLog.reportOutcomeInSecurityPool).toBe(2)
		expect(state.callLog.migrateRepToZoltarFromSecurityPool).toBe(1)
		expect(state.callLog.startTruthAuctionForSecurityPool).toBe(1)
		expect(state.callLog.submitTruthAuctionBid).toBe(10)
		expect(state.callLog.loadForkAuctionDetails).toBeGreaterThanOrEqual(2)
		expect(writeCalls.length).toBeGreaterThan(0)
	})
})
