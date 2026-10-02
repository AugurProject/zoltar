/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { bigintToSafeNumber, getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { isSecurityPoolVaultAdmissionClosed, loadAllSecurityPools, loadSecurityPoolLineage, loadSecurityPoolChildren } from '@zoltar/ui-statoblast-shared/protocol/securityPools.js'
import { loadSecurityPoolMintCapacity } from '@zoltar/ui-statoblast-shared/protocol/trading.js'
import { createBlockWithTimestamp, createMockLoaderClient, createMulticallStub, getContractFunctionName } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'

type LoaderClientOptions = Parameters<typeof createMockLoaderClient>[0]
type MulticallRequest = Parameters<LoaderClientOptions['multicall']>[0]
type ReadContractRequest = Parameters<LoaderClientOptions['readContract']>[0]

const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000a1')
const vaultAddress = getAddress('0x00000000000000000000000000000000000000c1')
const alternateSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000a2')
const escalationGameAddress = getAddress('0x00000000000000000000000000000000000000e1')
const defaultForkData = [0n, zeroAddress, 0n, 0n, 0n, 0n, 0n, 0n, false, false, 0n, 0n] as const
const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
const anchoredBlock = { hash: `0x${'11'.repeat(32)}`, number: 100n, timestamp: 0n } as const
const createPoolAccountingSnapshot = (settlementCollateralAttoEth = 0n, totalUnderwritingLimitAttoEth = 0n, feeEligibleUnderwritingLimitAttoEth = totalUnderwritingLimitAttoEth) => ({
	settlementCollateralAttoEth,
	currentRetentionRate: 0n,
	feeEligibleUnderwritingLimitAttoEth,
	feeIndex: 0n,
	feeIndexRemainder: 0n,
	lastUpdatedFeeAccumulator: 0n,
	totalFeesOwedRemainder: 0n,
	totalClaimableVaultFeesAttoEth: 0n,
	totalUnderwritingLimitAttoEth,
	unallocatedAccruedFeesAttoEth: 0n,
	uncheckpointedFeeEligibleUnderwritingLimitAttoEth: 0n,
	badDebtGeneration: 0n,
})

// Mirrors the pool-detail multicall order in loadSecurityPoolDetails.
const createPoolRead = ({
	minimumSecurityBondDebtAttoEth = 10n ** 18n,
	minimumVaultRepDepositAttoRep = 10n * 10n ** 18n,
	forkData = defaultForkData,
	totalPoolHeldAttoRep = 100n,
	poolAccountingSnapshot = createPoolAccountingSnapshot(),
	universeForkTime = 0n,
	escalationGame = zeroAddress,
}: {
	minimumSecurityBondDebtAttoEth?: bigint
	minimumVaultRepDepositAttoRep?: bigint
	forkData?: readonly unknown[]
	totalPoolHeldAttoRep?: bigint
	poolAccountingSnapshot?: ReturnType<typeof createPoolAccountingSnapshot>
	universeForkTime?: bigint
	escalationGame?: Address
} = {}) => [0n, 10n, minimumSecurityBondDebtAttoEth, minimumVaultRepDepositAttoRep, forkData, 0n, 0n, 3n, 0n, 0n, totalPoolHeldAttoRep, poolAccountingSnapshot, universeForkTime, escalationGame, 200n]

const createDeployment = (securityPool: Address, { parent = zeroAddress, universeId = 1n }: { parent?: Address; universeId?: bigint } = {}) => ({
	initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
	parent,
	openOraclePriceCoordinator: zeroAddress,
	questionId: 1n,
	statoblastSecurityMultiplierBps: 20_000n,
	securityPool,
	truthAuction: zeroAddress,
	universeId,
})

function getRequiredAddress(value: unknown, field: string) {
	const address = Reflect.get(Object(value), field)
	if (typeof address !== 'string') throw new Error(`Expected ${field} address`)
	return getAddress(address)
}

function getFirstArgAddress(contract: unknown) {
	const args = Reflect.get(Object(contract), 'args')
	if (!Array.isArray(args) || typeof args[0] !== 'string') throw new Error('Expected a vault address argument')
	return getAddress(args[0])
}

function createPagedGetVaults(knownVaultAddresses: readonly Address[], calls: [bigint, bigint][]) {
	return (request: ReadContractRequest) => {
		const [startIndex, count] = request.args ?? []
		if (typeof startIndex !== 'bigint' || typeof count !== 'bigint') throw new Error('Expected getVaults pagination args')
		calls.push([startIndex, count])
		return knownVaultAddresses.slice(bigintToSafeNumber(startIndex, 'Vault start index'), bigintToSafeNumber(startIndex + count, 'Vault end index'))
	}
}

const zeroPerContract = (contracts: MulticallRequest['contracts']) => contracts.map(() => 0n)
// Vault-summary multicalls with zero open interest and bad debt around the given securityVaults tuples.
const createVaultSummaryMulticall = (securityVaults: (contracts: MulticallRequest['contracts']) => unknown) => ({ getVaultOpenInterestAttoEth: zeroPerContract, vaultBadDebtAttoEth: zeroPerContract, securityVaults })

function createPoolLoaderClient({
	deployments,
	poolRead = () => createPoolRead(),
	multicall = {},
	read = {},
}: {
	deployments: readonly ReturnType<typeof createDeployment>[]
	poolRead?: (securityPool: Address) => unknown
	multicall?: Record<string, (contracts: MulticallRequest['contracts'], request: MulticallRequest) => unknown>
	read?: Record<string, (request: ReadContractRequest) => unknown>
}) {
	return createMockLoaderClient({
		getBlock: async () => anchoredBlock,
		multicall: async request => {
			const firstContract = request.contracts[0]
			const functionName = getContractFunctionName(firstContract)
			if (functionName === 'settlementCollateralAttoEth') return poolRead(getRequiredAddress(firstContract, 'address'))
			if (functionName === 'questions') return [questionTuple, 1n]
			const handler = multicall[functionName]
			if (handler === undefined) throw new Error(`Unexpected multicall contract: ${functionName}`)
			return handler(request.contracts, request)
		},
		readContract: async request => {
			const handler = read[request.functionName]
			if (handler !== undefined) return handler(request)
			switch (request.functionName) {
				case 'getCurrentMintingCapacityAttoEth':
				case 'getVaultCount':
					return 0n
				case 'securityPoolDeploymentCount':
					return BigInt(deployments.length)
				case 'securityPoolDeploymentsRange':
					return deployments
				case 'securityVaults':
					throw new Error('Expected batched securityVaults multicall')
				case 'escalationGame':
					return zeroAddress
				case 'getTotalPoolHeldAttoRep':
					return 100n
				case 'totalRepBackingUnits':
					return 10n
				case 'getOutcomeLabels':
					return ['Yes', 'No']
				default:
					throw new Error(`Unexpected readContract function: ${request.functionName}`)
			}
		},
	})
}

describe('securityPools protocol client', () => {
	test.each([
		['opens a pool using the deployment registry without scanning historical logs', loadSecurityPoolLineage],
		['loads selected children without log access', loadSecurityPoolChildren],
	])('%s', async (_name, load) => {
		const client = createMockLoaderClient({
			getBlock: async () => anchoredBlock,
			getLogs: async () => {
				throw new Error('Pool lookup must not scan historical logs')
			},
			multicall: async () => [],
			readContract: async request => {
				if (request.functionName === 'getCurrentMintingCapacityAttoEth') return 0n
				if (request.functionName === 'securityPoolDeploymentCount') return 0n
				throw new Error(`Unexpected read: ${request.functionName}`)
			},
		})
		expect(await load(client, securityPoolAddress)).toEqual([])
	})

	test('reuses canonical deployment pages when opening another pool with the same registry index', async () => {
		const ranges: unknown[] = []
		const index = { snapshot: undefined, pending: undefined }
		const client = createMockLoaderClient({
			getBlock: async () => ({ hash: `0x${'11'.repeat(32)}`, number: 100n, timestamp: 0n }),
			multicall: async () => [],
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 1n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					ranges.push(request.args)
					return [createDeployment(alternateSecurityPoolAddress, { universeId: 0n })]
				}
				throw new Error(`Unexpected read: ${request.functionName}`)
			},
		})
		await loadSecurityPoolLineage(client, securityPoolAddress, undefined, index)
		await loadSecurityPoolLineage(client, securityPoolAddress, undefined, index)
		expect(ranges).toHaveLength(1)
	})

	test('revalidates ordinary vault admission against latest chain time while keeping genuine continuations open', async () => {
		let currentTimestamp = 100n
		let escalationGame = zeroAddress
		let forkContinuation = false
		const questionDataAddress = getAddress('0x00000000000000000000000000000000000000d1')
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(currentTimestamp),
			readContract: async request => {
				if (request.functionName === 'getCurrentMintingCapacityAttoEth') return 0n
				switch (request.functionName) {
					case 'escalationGame':
						return escalationGame
					case 'forkContinuation':
						return forkContinuation
					case 'questionData':
						return questionDataAddress
					case 'questionId':
						return 1n
					case 'getQuestionEndDate':
						return 100n
					default:
						throw new Error(`Unexpected readContract function: ${request.functionName}`)
				}
			},
		})

		expect(await isSecurityPoolVaultAdmissionClosed(client, securityPoolAddress)).toBe(true)
		currentTimestamp = 101n
		expect(await isSecurityPoolVaultAdmissionClosed(client, securityPoolAddress)).toBe(true)
		escalationGame = escalationGameAddress
		expect(await isSecurityPoolVaultAdmissionClosed(client, securityPoolAddress)).toBe(true)
		forkContinuation = true
		expect(await isSecurityPoolVaultAdmissionClosed(client, securityPoolAddress)).toBe(false)
	})

	test('rejects selected child deployments when their discovery anchor is replaced', async () => {
		const originalHash = `0x${'11'.repeat(32)}` as const
		const replacementHash = `0x${'22'.repeat(32)}` as const
		let blockReads = 0
		const client = createMockLoaderClient({
			getBlock: async () => {
				blockReads += 1
				return { hash: blockReads === 1 ? originalHash : replacementHash, number: 100n, timestamp: 0n }
			},
			getLogs: async () => [],
			multicall: async () => [],
			readContract: async request => {
				if (request.functionName === 'getCurrentMintingCapacityAttoEth') return 0n
				if (request.functionName === 'securityPoolDeploymentCount') return 0n
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		await expect(loadSecurityPoolChildren(client, securityPoolAddress)).rejects.toThrow('changed during discovery')
	})

	test.each(['all', 'new-pool-lineage'])('loads %s with the default root-pool fork outcome unset and inactive', async mode => {
		let registryReads = 0
		const client = createPoolLoaderClient({
			deployments: [createDeployment(securityPoolAddress)],
			poolRead: () => createPoolRead({ minimumSecurityBondDebtAttoEth: 7n * 10n ** 18n, minimumVaultRepDepositAttoRep: 30n * 10n ** 18n, escalationGame: escalationGameAddress }),
			read: {
				forkContinuation: () => false,
				securityPoolDeploymentCount: () => {
					registryReads += 1
					return mode === 'new-pool-lineage' && registryReads === 1 ? 0n : 1n
				},
			},
		})

		const pools = mode === 'all' ? await loadAllSecurityPools(client) : await loadSecurityPoolLineage(client, securityPoolAddress)
		const [pool] = pools
		if (pool === undefined) throw new Error('Expected one security pool')

		expect(pool.parent).toBe(zeroAddress)
		expect(pool.minimumSecurityBondDebtAttoEth).toBe(7n * 10n ** 18n)
		expect(pool.minimumVaultRepDepositAttoRep).toBe(30n * 10n ** 18n)
		expect(pool.hasForkContinuationEscalationGame).toBe(false)
		expect(pool.ordinaryEscalationGameStarted).toBe(true)
		expect(pool.forkOutcome).toBe('none')
		expect(pool.hasForkActivity).toBe(false)
	})

	test('loadAllSecurityPools rejects malformed fork data instead of casting tuple reads', async () => {
		const client = createPoolLoaderClient({
			deployments: [createDeployment(securityPoolAddress)],
			poolRead: () => createPoolRead({ forkData: [0n, zeroAddress, 0n, 'bad-migrated-rep', 0n, 0n, 0n, 0n, false, false, 0n, 0n] }),
		})

		await expect(loadAllSecurityPools(client)).rejects.toThrow('Unexpected security pool fork data migrated REP response')
	})

	describe('parent fork activity', () => {
		const parentSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000d1')
		const childSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000d2')
		const createParentChildClient = () =>
			createPoolLoaderClient({
				deployments: [createDeployment(parentSecurityPoolAddress), createDeployment(childSecurityPoolAddress, { parent: parentSecurityPoolAddress, universeId: 2n })],
				poolRead: () => createPoolRead({ universeForkTime: 1n }),
			})
		const findParent = (pools: readonly { securityPoolAddress: Address; hasForkActivity: boolean; universeHasForked: boolean }[]) => {
			const parentPool = pools.find(pool => pool.securityPoolAddress === parentSecurityPoolAddress)
			if (parentPool === undefined) throw new Error('Expected parent security pool')
			return parentPool
		}

		test('loadAllSecurityPools infers parent fork activity when a loaded child points to it', async () => {
			const parentPool = findParent(await loadAllSecurityPools(createParentChildClient()))

			expect(parentPool.hasForkActivity).toBe(true)
			expect(parentPool.universeHasForked).toBe(true)
		})
	})

	test('loadAllSecurityPools batches vault summary tuple reads through multicall', async () => {
		const previewVaultAddresses = [getAddress('0x00000000000000000000000000000000000000c1'), getAddress('0x00000000000000000000000000000000000000c2'), getAddress('0x00000000000000000000000000000000000000c3')] as const
		const vaultEscalationGameAddress = getAddress('0x00000000000000000000000000000000000000c9')
		const loadedVaultAddresses: Address[] = []
		let securityVaultSummaryBatchCount = 0
		const expectLatestBlock = (request: MulticallRequest) => expect(request.blockNumber).toBe(0n)
		const client = createPoolLoaderClient({
			deployments: [createDeployment(securityPoolAddress)],
			multicall: {
				getVaultOpenInterestAttoEth: (contracts, request) => {
					expectLatestBlock(request)
					return zeroPerContract(contracts)
				},
				vaultBadDebtAttoEth: (contracts, request) => {
					expectLatestBlock(request)
					return contracts.map(contract => (getFirstArgAddress(contract) === previewVaultAddresses[1] ? 7n : 0n))
				},
				securityVaults: (contracts, request) => {
					expectLatestBlock(request)
					securityVaultSummaryBatchCount += 1
					return contracts.map(contract => {
						const currentVaultAddress = getFirstArgAddress(contract)
						loadedVaultAddresses.push(currentVaultAddress)
						return currentVaultAddress === previewVaultAddresses[0] ? [2n, 0n, 0n, 0n, 0n] : [0n, 0n, 0n, 0n, 0n]
					})
				},
				disputeStakedRepByVaultAttoRep: contracts => contracts.map(contract => (getFirstArgAddress(contract) === previewVaultAddresses[0] ? 5n : 0n)),
			},
			read: {
				getVaultCount: () => 3n,
				getVaults: () => previewVaultAddresses,
				escalationGame: () => vaultEscalationGameAddress,
				disputeStakedRepByVaultAttoRep: request => (request.args?.[0] === previewVaultAddresses[0] ? 5n : 0n),
			},
		})

		const pools = await loadAllSecurityPools(client)
		const [pool] = pools
		if (pool === undefined) throw new Error('Expected one security pool')

		expect(securityVaultSummaryBatchCount).toBe(1)
		expect(loadedVaultAddresses).toEqual([...previewVaultAddresses])
		expect(pool.feeAccrualState?.feeEndTimestamp).toBe(200n)
		expect(pool.vaults.map(vault => vault.vaultAddress)).toEqual([previewVaultAddresses[0], previewVaultAddresses[1]])
		expect(pool.vaults.map(vault => vault.disputeStakedAttoRep)).toEqual([5n, 0n])
		expect(pool.vaults.map(vault => vault.badDebtAttoEth)).toEqual([0n, 7n])
	})

	test('loadAllSecurityPools includes bounded actionable vault previews', async () => {
		const viewerVaultAddress = getAddress('0x00000000000000000000000000000000000000c4')
		const previewVaultAddresses = [getAddress('0x00000000000000000000000000000000000000c1'), getAddress('0x00000000000000000000000000000000000000c2'), getAddress('0x00000000000000000000000000000000000000c3')]
		let getVaultsCallCount = 0
		let securityVaultSummaryMulticallCount = 0
		const client = createPoolLoaderClient({
			deployments: [createDeployment(securityPoolAddress)],
			multicall: createVaultSummaryMulticall(contracts => {
				securityVaultSummaryMulticallCount += 1
				return contracts.map(() => [2n, 0n, 0n, 0n, 0n])
			}),
			read: {
				getVaultCount: () => 5n,
				getVaults: request => {
					getVaultsCallCount += 1
					expect(request.args).toEqual([0n, 5n])
					return previewVaultAddresses
				},
			},
		})

		const pools = await loadAllSecurityPools(client, { accountAddress: viewerVaultAddress })
		const [pool] = pools
		if (pool === undefined) throw new Error('Expected one security pool')

		expect(getVaultsCallCount).toBe(1)
		expect(securityVaultSummaryMulticallCount).toBe(1)
		expect(pool.hasLoadedVaults).toBe(true)
		expect(pool.vaults.map(vault => vault.vaultAddress)).toEqual([...previewVaultAddresses, viewerVaultAddress])
		expect(pool.vaultCount).toBe(5n)
		expect(pool.totalPoolHeldAttoRep).toBe(100n)
		expect(pool.questionId).toBe('0x1')
	})

	test('loadAllSecurityPools scans past exited known vaults to fill actionable previews', async () => {
		const knownVaultAddresses = [getAddress('0x00000000000000000000000000000000000000c1'), getAddress('0x00000000000000000000000000000000000000c2'), getAddress('0x00000000000000000000000000000000000000c3'), getAddress('0x00000000000000000000000000000000000000c4')]
		const currentVaultAddress = knownVaultAddresses[3]
		if (currentVaultAddress === undefined) throw new Error('Expected a current vault address')
		const getVaultsCalls: [bigint, bigint][] = []
		const getVaults = createPagedGetVaults(knownVaultAddresses, getVaultsCalls)
		const client = createPoolLoaderClient({
			deployments: [createDeployment(securityPoolAddress)],
			multicall: createVaultSummaryMulticall(contracts => contracts.map(contract => (getFirstArgAddress(contract) === currentVaultAddress ? [2n, 0n, 0n, 0n, 0n] : [0n, 0n, 0n, 0n, 0n]))),
			read: {
				getVaultCount: request => {
					expect(request.blockNumber).toBe(0n)
					return BigInt(knownVaultAddresses.length)
				},
				getVaults: request => {
					expect(request.blockNumber).toBe(0n)
					return getVaults(request)
				},
			},
		})

		const pools = await loadAllSecurityPools(client)
		const [pool] = pools
		if (pool === undefined) throw new Error('Expected one security pool')

		expect(getVaultsCalls).toEqual([[0n, 4n]])
		expect(pool.vaults.map(vault => vault.vaultAddress)).toEqual([currentVaultAddress])
		expect(pool.vaultCount).toBe(4n)
	})

	test('loadAllSecurityPools caps registry scans when arbitrary empty addresses exceed the scan budget', async () => {
		const knownVaultAddresses = Array.from({ length: 600 }, (_, index) =>
			getAddress(
				`0x${BigInt(index + 1)
					.toString(16)
					.padStart(40, '0')}`,
			),
		)
		const getVaultsCalls: [bigint, bigint][] = []
		const client = createPoolLoaderClient({
			deployments: [createDeployment(securityPoolAddress)],
			multicall: createVaultSummaryMulticall(contracts => contracts.map(() => [0n, 0n, 0n, 0n, 0n])),
			read: {
				getVaultCount: () => BigInt(knownVaultAddresses.length),
				getVaults: createPagedGetVaults(knownVaultAddresses, getVaultsCalls),
			},
		})

		const pools = await loadAllSecurityPools(client)
		const [pool] = pools
		if (pool === undefined) throw new Error('Expected one security pool')

		expect(getVaultsCalls).toHaveLength(10)
		expect(getVaultsCalls[0]).toEqual([0n, 50n])
		expect(getVaultsCalls[9]).toEqual([450n, 50n])
		expect(pool.vaults).toEqual([])
		expect(pool.vaultScanCapped).toBe(true)
	})

	test('loadAllSecurityPools preserves the connected account beyond the bounded vault preview', async () => {
		const knownVaultAddresses = Array.from({ length: 51 }, (_, index) =>
			getAddress(
				`0x${BigInt(index + 1)
					.toString(16)
					.padStart(40, '0')}`,
			),
		)
		const accountAddress = knownVaultAddresses[50]
		if (accountAddress === undefined) throw new Error('Expected the account vault beyond the preview')
		const getVaultsCalls: [bigint, bigint][] = []
		const client = createPoolLoaderClient({
			deployments: [createDeployment(securityPoolAddress)],
			multicall: createVaultSummaryMulticall(contracts => contracts.map(() => [2n, 0n, 0n, 0n, 0n])),
			read: {
				getVaultCount: () => BigInt(knownVaultAddresses.length),
				getVaults: createPagedGetVaults(knownVaultAddresses, getVaultsCalls),
			},
		})
		const [pool] = await loadAllSecurityPools(client, { accountAddress })
		if (pool === undefined) throw new Error('Expected one security pool')
		expect(getVaultsCalls).toEqual([[0n, 50n]])
		expect(pool.vaults.map(vault => vault.vaultAddress)).toEqual(knownVaultAddresses)
	})

	test('loadAllSecurityPools marks empty vault sets as already loaded', async () => {
		let getVaultsCallCount = 0
		let securityVaultSummaryMulticallCount = 0
		const client = createPoolLoaderClient({
			deployments: [createDeployment(securityPoolAddress)],
			multicall: createVaultSummaryMulticall(contracts => {
				securityVaultSummaryMulticallCount += 1
				return contracts.map(() => [2n, 0n, 0n, 0n, 0n])
			}),
			read: {
				getVaults: () => {
					getVaultsCallCount += 1
					throw new Error('Empty pool loads should not fetch preview vault addresses')
				},
				securityVaults: () => {
					throw new Error('Empty pool loads should not fetch per-vault summaries')
				},
			},
		})

		const pools = await loadAllSecurityPools(client)
		const [pool] = pools
		if (pool === undefined) throw new Error('Expected one security pool')

		expect(getVaultsCallCount).toBe(0)
		expect(securityVaultSummaryMulticallCount).toBe(0)
		expect(pool.hasLoadedVaults).toBe(true)
		expect(pool.vaultCount).toBe(0n)
		expect(pool.vaults).toEqual([])
	})

	test('loadAllSecurityPools defers vault detail loading for unselected pools in selected mode', async () => {
		const getVaultCalls: Address[] = []
		const vaultSummaryCalls: Address[] = []
		const client = createPoolLoaderClient({
			deployments: [createDeployment(securityPoolAddress), createDeployment(alternateSecurityPoolAddress, { universeId: 2n })],
			poolRead: () => createPoolRead({ totalPoolHeldAttoRep: 5n, poolAccountingSnapshot: createPoolAccountingSnapshot(0n, 9n, 3n) }),
			multicall: {
				backingUnitsToAttoRep: () => [5n],
				getVaultOpenInterestAttoEth: zeroPerContract,
				vaultBadDebtAttoEth: zeroPerContract,
				securityVaults: contracts => {
					vaultSummaryCalls.push(getRequiredAddress(contracts[0], 'address'))
					return contracts.map(() => [1n, 3n, 0n, 0n, 0n])
				},
			},
			read: {
				getVaultCount: request => (getRequiredAddress(request, 'address') === securityPoolAddress ? 1n : 2n),
				getVaults: request => {
					const normalizedAddress = getRequiredAddress(request, 'address')
					getVaultCalls.push(normalizedAddress)
					if (normalizedAddress === alternateSecurityPoolAddress) throw new Error('Unexpected vault load for unselected pool')
					return [vaultAddress]
				},
				getTotalPoolHeldAttoRep: () => 5n,
				totalRepBackingUnits: () => 1n,
			},
		})

		const pools = await loadAllSecurityPools(client, {
			selectedSecurityPoolAddress: securityPoolAddress,
			vaultDetailMode: 'selected',
		})

		const selectedPool = pools.find(pool => pool.securityPoolAddress === securityPoolAddress)
		const deferredPool = pools.find(pool => pool.securityPoolAddress === alternateSecurityPoolAddress)
		if (selectedPool === undefined || deferredPool === undefined) throw new Error('Expected both security pools')

		expect(getVaultCalls).toEqual([securityPoolAddress])
		expect(vaultSummaryCalls).toEqual([securityPoolAddress])
		expect(selectedPool.hasLoadedVaults).toBe(true)
		expect(selectedPool.vaults).toHaveLength(1)
		expect(selectedPool.feeEligibleUnderwritingLimitAttoEth).toBe(3n)
		expect(selectedPool.totalPoolHeldAttoRep).toBe(5n)
		expect(selectedPool.totalUnderwritingLimitAttoEth).toBe(9n)
		expect(deferredPool.hasLoadedVaults).toBe(false)
		expect(deferredPool.vaults).toEqual([])
		expect(deferredPool.vaultCount).toBe(2n)
	})

	test.each([77n, 200n, 2n ** 256n - 1n])('loadSecurityPoolMintCapacity reads the pool fee horizon %s', async feeEndTimestamp => {
		const requestedFunctionNames: string[] = []
		const requestedAddresses: Address[] = []
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(99n),
			multicall: createMulticallStub(async request => {
				for (const contract of request.contracts) {
					requestedFunctionNames.push(getContractFunctionName(contract))
					const address = Reflect.get(contract, 'address')
					if (typeof address !== 'string') throw new Error('Expected security pool address')
					requestedAddresses.push(getAddress(address))
				}
				if (request.contracts.length !== 7) throw new Error('Expected one mint-capacity multicall')
				return [createPoolAccountingSnapshot(11n, 44n, 17n), 22n, 33n, 55n, 88n, feeEndTimestamp, zeroAddress]
			}),
			readContract: async () => {
				throw new Error('readContract should not be called')
			},
		})

		const capacity = await loadSecurityPoolMintCapacity(client, securityPoolAddress)

		expect(capacity).toEqual({
			currentRetentionRate: 88n,
			currentTimestamp: 99n,
			feeEndTimestamp,
			feeIndexRemainder: 0n,
			lastUpdatedFeeAccumulator: 0n,
			settlementCollateralAttoEth: 11n,
			feeEligibleUnderwritingLimitAttoEth: 17n,
			mintingCapacityAttoEth: 55n,
			shareTokenSupplyAttoShares: 22n,
			totalPoolHeldAttoRep: 33n,
			totalUnderwritingLimitAttoEth: 44n,
			totalFeesOwedRemainder: 0n,
		})
		expect(requestedFunctionNames).toEqual(['getPoolAccountingSnapshot', 'shareTokenSupplyAttoShares', 'getTotalPoolHeldAttoRep', 'getCurrentMintingCapacityAttoEth', 'currentRetentionRate', 'getFeeEpochEndTime', 'escalationGame'])
		expect(requestedAddresses).toEqual(Array.from({ length: 7 }, () => securityPoolAddress))
	})
})
