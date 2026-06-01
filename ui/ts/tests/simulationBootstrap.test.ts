/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { MAINNET_WETH_ADDRESS, type NetworkProfile } from '../lib/networkProfile.js'
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

function createMockedBootstrapDependencies({ accounts, scenario, profile }: { accounts: readonly string[]; scenario: 'security-pool' | 'securitypoolx2'; profile: NetworkProfile }) {
	const eth = 10n ** 18n
	const primaryVaultRepDeposit = 10_000n * eth
	const primaryVaultSecurityBondAllowance = 2_500n * eth
	const x2PrimaryVaultRepDeposit = 12_000n * eth
	const x2PrimaryVaultSecurityBondAllowance = 1_000n * eth
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
	const deployedCodes = new Map<string, string>([
		[deployments[0].address, '0x01'],
	])
	const managerByPool = new Map<Address, Address>()
	const openOracleByManager = new Map<Address, Address>()
	const managerToPool = new Map<Address, string>()
	const poolAddresses: Address[] = [
		getAddress('0x00000000000000000000000000000000000000b1'),
		getAddress('0x00000000000000000000000000000000000000b2'),
	]
	const vaultAddressByPool: Record<string, Address[]> = scenario === 'security-pool'
		? {
				[poolAddresses[0]]: [getAddress(accounts[0] ?? MOCK_PRIMARY_ACCOUNT)],
			}
		: {
				[poolAddresses[0]]: [getAddress(accounts[0] ?? MOCK_PRIMARY_ACCOUNT), getAddress(accounts[1] ?? MOCK_SECONDARY_ACCOUNT)],
				[poolAddresses[1]]: [getAddress(accounts[0] ?? MOCK_PRIMARY_ACCOUNT), getAddress(accounts[1] ?? MOCK_SECONDARY_ACCOUNT)],
			}
	const poolPlan = scenario === 'security-pool'
		? [{ question: 'Will this resolve?' }]
		: [{ question: 'Will this resolve? (securitypoolx2 #1)' }, { question: 'Will this resolve? (securitypoolx2 #2)' }]
	const repDeposits: Record<string, Record<string, bigint>> = {}
	const securityBondAllowances: Record<string, Record<string, bigint>> = {}
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
			[primaryVault]: scenario === 'security-pool' ? primaryVaultSecurityBondAllowance : x2PrimaryVaultSecurityBondAllowance,
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
			depositRepToSecurityPool: 0,
			loadAllSecurityPools: 0,
			loadErc20Balance: 0,
			loadOracleManagerDetails: 0,
			loadOpenOracleReportDetails: 0,
			loadSecurityVaultDetails: 0,
			queueOracleManagerOperation: 0,
			settleOracleReport: 0,
			submitInitialOracleReport: 0,
			writeContract: 0,
			setSecurityPoolDeployCalls: 0,
			setSimulationCodeCalls: 0,
		},
		deploymentCodeRequests: [] as string[],
	}

	const getPoolAddressForMarket = (index: number) => poolAddresses[index] ?? poolAddresses[0]
	const getManagerForPool = (poolAddress: string) => {
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
		createSecurityPool: mock(async (_client: never, input: { currentRetentionRate: bigint; questionId: bigint; securityMultiplier: bigint }) => {
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
		depositRepToSecurityPool: mock(async (client: { account?: Address }, poolAddress: string, amount: bigint) => {
			state.callLog.depositRepToSecurityPool += 1
			const vaultAddress = vaultAddressByPool[poolAddress]?.find(vaultAddressCandidate => vaultAddressCandidate === client.account) ?? vaultAddressByPool[poolAddress]?.[0]
			if (vaultAddress !== undefined) {
				repDeposits[poolAddress] ??= {}
				repDeposits[poolAddress][vaultAddress] = amount
			}
			return {
				action: 'depositRep',
				hash: '0x01',
			} as never
		}),
		getDeploymentSteps: mock(() => deployments.map(step => ({
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
		}))),
		loadAllSecurityPools: mock(async () => {
			state.callLog.loadAllSecurityPools += 1
			return poolPlan.map((_pool, index) => {
				const securityPoolAddress = getPoolAddressForMarket(index)
				const vaultAddresses = vaultAddressByPool[securityPoolAddress] ?? []
				const vaultRows = vaultAddresses.map(vaultAddress => ({
					vaultAddress,
					repDepositShare: repDeposits[securityPoolAddress]?.[vaultAddress] ?? 0n,
					securityBondAllowance: securityBondAllowances[securityPoolAddress]?.[vaultAddress] ?? 0n,
				}))
				return {
					securityPoolAddress,
					vaultCount: BigInt(vaultRows.length),
					totalRepDeposit: vaultRows.reduce((sum, row) => sum + row.repDepositShare, 0n),
					totalSecurityBondAllowance: vaultRows.reduce((sum, row) => sum + row.securityBondAllowance, 0n),
					vaults: vaultRows,
				} as never
			})
		}),
		loadErc20Balance: mock(async () => {
			state.callLog.loadErc20Balance += 1
			return 0n
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
				pendingReportId: pendingOperation === undefined ? 0n : 1n,
				priceValidUntilTimestamp: 0n,
				requestPriceEthCost: 0n,
				token1: token1Address,
				token2: token2Address,
			} as never
		}),
		loadOpenOracleReportDetails: mock(async () => {
			state.callLog.loadOpenOracleReportDetails += 1
			return {
				isDistributed: true,
			} as never
		}),
		loadSecurityVaultDetails: mock(async (_client: never, securityPoolAddress: string, vaultAddress: string) => {
			state.callLog.loadSecurityVaultDetails += 1
			return {
				currentRetentionRate: 0n,
				lockedRepInEscalationGame: 0n,
				managerAddress: getManagerForPool(securityPoolAddress),
				poolOwnershipDenominator: 0n,
				repDepositShare: repDeposits[securityPoolAddress]?.[vaultAddress] ?? 0n,
				repToken: profile.genesisRepTokenAddress,
				securityBondAllowance: securityBondAllowances[securityPoolAddress]?.[vaultAddress] ?? 0n,
				securityPoolAddress,
				totalSecurityBondAllowance: Object.values(securityBondAllowances[securityPoolAddress] ?? {}).reduce((sum, amount) => sum + amount, 0n),
				unpaidEthFees: 0n,
				universeId: 0n,
				vaultAddress,
			} as never
		}),
		queueOracleManagerOperation: mock(async (_client: never, managerAddress: Address, operation: string, targetVault: Address, amount: bigint) => {
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
		settleOracleReport: mock(async () => {
			state.callLog.settleOracleReport += 1
			return { hash: '0x01' } as never
		}),
		submitInitialOracleReport: mock(async () => {
			state.callLog.submitInitialOracleReport += 1
			return { action: 'submitInitialReport', hash: '0x01' } as never
		}),
	}))

    mock.module('../simulation/clock.js', () => ({
        advanceSimulationTime: async () => undefined,
        getSimulationChainTimestamp: async () => 1_000n,
        initializeSimulationClock: async () => 1_000n,
    }))

    const memoryClient = {
        getBlock: async () => ({ timestamp: 1_000n }),
        getStorageAt: async () => toHex(0n, { size: 32 }),
        setStorageAt: async () => undefined,
        getCode: async ({ address }: { address: string }) => {
            state.deploymentCodeRequests.push(address)
            return deployedCodes.get(address) ?? '0x'
        },
        setCode: async ({ address, bytecode }: { address: string; bytecode: string }) => {
            state.callLog.setSimulationCodeCalls += 1
            deployedCodes.set(address, bytecode === '' ? '0x' : '0x01')
        },
        impersonateAccount: async () => undefined,
        setBalance: async () => undefined,
        tevmReady: async () => undefined,
    } as never

	const writeCalls: Array<{ account: string; to: string | undefined; value: bigint | undefined }> = []
	const createWriteClient = (accountAddress: string) => ({
		account: accountAddress,
		sendTransaction: async (request: { to?: string; value?: bigint }) => {
			writeCalls.push({ account: accountAddress, to: request.to, value: request.value })
			return `0x${writeCalls.length.toString(16).padStart(64, '0')}` as `0x${string}`
        },
        waitForTransactionReceipt: async () => ({ status: 'success' }),
        getCode: async () => '0x01',
        writeContract: async ({ address }: { address: string }) => {
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

function createBaselineProfile() {
    return {
        chainId: '1',
        genesisRepTokenAddress: getAddress('0x00000000000000000000000000000000000000f2'),
        id: 'mainnet',
        label: 'Mainnet',
        repPrices: {
            ethUsd: 1800n,
            repEth: 0n,
            repUsdc: 0n,
        },
        rpcUrls: [],
        wethAddress: getAddress('0x00000000000000000000000000000000000000f3'),
    } as const
}

function createBootstrapMemoryClient(
    overrides: Partial<{
    getBlock: () => Promise<{ timestamp: bigint }>
    getStorageAt: (args: { address: string; index: string }) => Promise<string>
    setStorageAt: (payload: { address: string; index: string; value: string }) => Promise<void>
    getCode: (args: { address: string }) => Promise<`0x${string}`>
    tevmReady: () => Promise<void>
    impersonateAccount: (args: { address: string }) => Promise<void>
    setBalance: (args: { address: string; value: bigint }) => Promise<void>
    setCode: (args: { address: string; bytecode: string }) => Promise<void>
    }>,
) {
    return {
        getBlock: async () => ({ timestamp: SIMULATION_INITIAL_TIMESTAMP }),
        getStorageAt: async () => toHex(0n, { size: 32 }),
        setStorageAt: async () => undefined,
        getCode: async () => '0x01',
        tevmReady: async () => undefined,
        impersonateAccount: async () => undefined,
        setBalance: async () => undefined,
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
        const memoryClient = { getBlock: async () => ({ timestamp: 0n }) } as never
    	await expect(
    		mintSimulationGenesisRep({
    		    accountAddress: MOCK_PRIMARY_ACCOUNT,
    		    amount: 0n,
    		    memoryClient,
    		    repAddress: getAddress('0x00000000000000000000000000000000000000b1'),
    		    zoltarAddress: getAddress('0x00000000000000000000000000000000000000b2'),
            }),
        ).rejects.toThrow('Simulation REP mint amount must be greater than zero')
    })

    test('updates mocked REP balances and skips Zoltar bootstrap when token code is missing', async () => {
        const repAddress = getAddress('0x00000000000000000000000000000000000000d1')
        const zoltarAddress = getAddress('0x00000000000000000000000000000000000000d2')
        const storageWrites: MemoryStorageCall[] = []
        const getStorageAt = mock(async () => '0x')
        const setStorageAt = mock(async (payload: { address: string; index: string; value: string }) => {
            storageWrites.push(payload)
        })
        const memoryClient = {
            getStorageAt,
            setStorageAt,
            getCode: async () => '0x',
        } as never

        await mintSimulationGenesisRep({
            accountAddress: MOCK_PRIMARY_ACCOUNT,
            amount: 11n,
            memoryClient,
            repAddress,
            zoltarAddress,
        })

        const repWrites = storageWrites.filter(write => write.address === repAddress)
        const zoltarWrites = storageWrites.filter(write => write.address === zoltarAddress)
        const repValues = repWrites.map(write => BigInt(write.value))

        expect(repWrites).toHaveLength(3)
        expect(new Set(repValues)).toEqual(new Set([11n]))
        expect(zoltarWrites).toHaveLength(0)
    })

    test('updates Zoltar genesis pointer when the REP token is already deployed', async () => {
        const repAddress = getAddress('0x00000000000000000000000000000000000000e1')
        const zoltarAddress = getAddress('0x00000000000000000000000000000000000000e2')
        const storageWrites: MemoryStorageCall[] = []
        const memoryClient = {
            getStorageAt: async () => toHex(0n, { size: 32 }),
            setStorageAt: async (payload: { address: string; index: string; value: string }) => {
                storageWrites.push(payload)
            },
            getCode: async ({ address }: { address: string }) => (address.toLowerCase() === repAddress.toLowerCase() ? '0x01' : '0x01'),
        } as never

        await mintSimulationGenesisRep({
            accountAddress: MOCK_PRIMARY_ACCOUNT,
            amount: 11n,
            memoryClient,
            repAddress,
            zoltarAddress,
        })

        const repWrites = storageWrites.filter(write => write.address === repAddress)
        const zoltarWrites = storageWrites.filter(write => write.address === zoltarAddress)

        expect(repWrites).toHaveLength(3)
        expect(zoltarWrites).toHaveLength(2)
    })

    test('bootstraps baseline simulation chain using seeded progress and mocked clients', async () => {
        const profile: NetworkProfile = {
            id: 'mainnet',
            label: 'Mainnet',
            chainId: '1',
            rpcUrls: ['https://ethereum.dark.florist'],
            repPrices: {
                ethUsd: 1800n,
                repUsdc: 0n,
                repEth: 0n,
            },
            genesisRepTokenAddress: getAddress('0x00000000000000000000000000000000000000f2'),
            wethAddress: getAddress('0x00000000000000000000000000000000000000f3'),
        }
        const progressCalls: string[] = []
        const progress = async (payload: { label: string }) => {
            progressCalls.push(payload.label)
        }
        const writeCalls: Array<{ account: string; to: string | undefined; value: bigint | undefined }> = []
        const memoryClient = {
            tevmReady: async () => undefined,
            getBlock: async () => ({ timestamp: SIMULATION_INITIAL_TIMESTAMP }),
            getStorageAt: async () => toHex(0n, { size: 32 }),
            setStorageAt: async () => undefined,
            setCode: async () => undefined,
            impersonateAccount: async () => undefined,
            setBalance: async () => undefined,
            getCode: async () => '0x01',
        } as never
        const createWriteClient = (accountAddress: string) => ({
            sendTransaction: async (request: { to?: string; value?: bigint }) => {
                writeCalls.push({ account: accountAddress, to: request.to, value: request.value })
                return `0x${writeCalls.length.toString(16).padStart(64, '0')}` as `0x${string}`
            },
            waitForTransactionReceipt: async () => ({ status: 'success' }),
            getCode: async () => '0x01',
        }) as never

        await bootstrapSimulationChain({
            accounts: [MOCK_PRIMARY_ACCOUNT, MOCK_SECONDARY_ACCOUNT],
            createReadClient: () => ({} as never),
            createWriteClient,
            memoryClient,
            onProgress: async payload => {
                await progress(payload)
            },
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
        const writeCalls: Array<{ account: string; to: string | undefined; value: bigint | undefined }> = []
        const createWriteClient = (accountAddress: string) => ({
            sendTransaction: async (request: { to?: string; value?: bigint }) => {
                writeCalls.push({ account: accountAddress, to: request.to, value: request.value })
                return `0x${writeCalls.length.toString(16).padStart(64, '0')}` as `0x${string}`
            },
            waitForTransactionReceipt: async () => ({ status: 'success' }),
            getCode: async () => '0x01',
        }) as never

        await expect(
            bootstrapSimulationChain({
                accounts: [],
                createReadClient: () => ({ kind: 'read-client' } as never),
                createWriteClient,
                memoryClient,
                primaryAccount: MOCK_PRIMARY_ACCOUNT,
                onProgress: () => undefined,
                profile: {
                    chainId: '1',
                    genesisRepTokenAddress: getAddress('0x00000000000000000000000000000000000000f2'),
                    id: 'mainnet',
                    label: 'Mainnet',
                    repPrices: {
                        ethUsd: 1800n,
                        repEth: 0n,
                        repUsdc: 0n,
                    },
                    rpcUrls: [],
                    wethAddress: getAddress('0x00000000000000000000000000000000000000f3'),
                },
                scenario: 'security-pool',
            }),
        ).rejects.toThrow('Expected seeded simulation QA account A1')
    })

    test('rejects securitypoolx2 bootstrap when the secondary QA account is missing', async () => {
        const memoryClient = createBootstrapMemoryClient()
        const writeCalls: Array<{ account: string; to: string | undefined; value: bigint | undefined }> = []
        const createWriteClient = (accountAddress: string) => ({
            sendTransaction: async (request: { to?: string; value?: bigint }) => {
                writeCalls.push({ account: accountAddress, to: request.to, value: request.value })
                return `0x${writeCalls.length.toString(16).padStart(64, '0')}` as `0x${string}`
            },
            waitForTransactionReceipt: async () => ({ status: 'success' }),
            getCode: async () => '0x01',
        }) as never

        await expect(
            bootstrapSimulationChain({
                accounts: [MOCK_PRIMARY_ACCOUNT],
                createReadClient: () => ({ kind: 'read-client' } as never),
                createWriteClient,
                memoryClient,
                primaryAccount: MOCK_PRIMARY_ACCOUNT,
                onProgress: () => undefined,
                profile: {
                    chainId: '1',
                    genesisRepTokenAddress: getAddress('0x00000000000000000000000000000000000000f2'),
                    id: 'mainnet',
                    label: 'Mainnet',
                    repPrices: {
                        ethUsd: 1800n,
                        repEth: 0n,
                        repUsdc: 0n,
                    },
                    rpcUrls: [],
                    wethAddress: getAddress('0x00000000000000000000000000000000000000f3'),
                },
                scenario: 'securitypoolx2',
            }),
        ).rejects.toThrow('Expected simulation QA account B2 for securitypoolx2')
    })

    test('boots deployed simulation scenario when all contracts are already present', async () => {
        const memoryClient = createBootstrapMemoryClient({
            getCode: async () => '0x01',
        })
        const progressCalls: string[] = []
        const writeCalls: Array<{ account: string; to: string | undefined; value: bigint | undefined }> = []
        const createWriteClient = (accountAddress: string) => ({
            sendTransaction: async (request: { to?: string; value?: bigint }) => {
                writeCalls.push({ account: accountAddress, to: request.to, value: request.value })
                return `0x${writeCalls.length.toString(16).padStart(64, '0')}` as `0x${string}`
            },
            waitForTransactionReceipt: async () => ({ status: 'success' }),
            getCode: async () => '0x01',
        }) as never

        await bootstrapSimulationChain({
            accounts: [MOCK_PRIMARY_ACCOUNT, MOCK_SECONDARY_ACCOUNT],
            createReadClient: () => ({ kind: 'read-client' } as never),
            createWriteClient,
            memoryClient,
            primaryAccount: MOCK_PRIMARY_ACCOUNT,
            onProgress: payload => progressCalls.push(payload.label),
            profile: {
                chainId: '1',
                genesisRepTokenAddress: getAddress('0x00000000000000000000000000000000000000f2'),
                id: 'mainnet',
                label: 'Mainnet',
                repPrices: {
                    ethUsd: 1800n,
                    repEth: 0n,
                    repUsdc: 0n,
                },
                rpcUrls: [],
                wethAddress: getAddress('0x00000000000000000000000000000000000000f3'),
            },
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
                waitForTransactionReceipt: async () => ({ status: 'success' }),
                getCode: async () => '0x01',
            }) as never

        globalThis.setTimeout = ((handler: TimerHandler) => {
            if (typeof handler === 'function') {
                handler()
            }
            return 1 as ReturnType<typeof setTimeout>
        }) as typeof globalThis.setTimeout

        try {
            await expect(
                bootstrapSimulationChain({
                    accounts: [MOCK_PRIMARY_ACCOUNT, MOCK_SECONDARY_ACCOUNT],
                    createReadClient: () => ({} as never),
                    createWriteClient: createWriteClient,
                    memoryClient,
                    onProgress: () => undefined,
                    primaryAccount: MOCK_PRIMARY_ACCOUNT,
                    profile: {
                        chainId: '1',
                        genesisRepTokenAddress: getAddress('0x00000000000000000000000000000000000000f2'),
                        id: 'mainnet',
                        label: 'Mainnet',
                        repPrices: {
                            ethUsd: 1800n,
                            repEth: 0n,
                            repUsdc: 0n,
                        },
                        rpcUrls: [],
                        wethAddress: getAddress('0x00000000000000000000000000000000000000f3'),
                    },
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
            createReadClient: () => ({} as never),
            createWriteClient,
            memoryClient,
            onProgress: async payload => progressCalls.push(payload.label),
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
            createReadClient: () => ({} as never),
            createWriteClient,
            memoryClient,
            onProgress: async () => undefined,
            primaryAccount: MOCK_PRIMARY_ACCOUNT,
            profile,
            scenario: 'securitypoolx2',
        })

		expect(state.callLog.createMarket).toBe(2)
		expect(state.callLog.createSecurityPool).toBe(2)
		expect(state.callLog.settleOracleReport).toBe(4)
		expect(state.callLog.submitInitialOracleReport).toBe(4)
		expect(state.callLog.loadOpenOracleReportDetails).toBe(2)
		expect(state.callLog.writeContract).toBe(2)
		expect(state.callLog.queueOracleManagerOperation).toBe(4)
		expect(state.callLog.setSecurityPoolDeployCalls).toBe(1)
		expect(writeCalls.length).toBeGreaterThan(0)
	})
})
