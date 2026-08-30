/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { bigintToSafeNumber, getAddress, zeroAddress, type Address } from '@zoltar/shared/ethereum'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory } from '@zoltar/ui-core-shared/contractArtifact.js'
import { loadAllSecurityPools, loadSecurityPoolChildren, loadSecurityPoolPage } from '../../protocol/securityPools.js'
import { loadSecurityPoolMintCapacity } from '../../protocol/trading.js'
import { createBlockWithTimestamp, createMockLoaderClient, createMulticallStub, getContractFunctionName } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'

const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000a1')
const vaultAddress = getAddress('0x00000000000000000000000000000000000000c1')
const alternateSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000a2')
const shareTokenAddress = getAddress('0x00000000000000000000000000000000000000b2')
const defaultForkData = [0n, zeroAddress, 0n, 0n, 0n, 0n, 0n, 0n, false, false, 0n] as const
const createPoolAccountingSnapshot = (settlementCollateralAttoEth = 0n, totalCapacityOwnershipAttoRep = 0n, feeEligibleCapacityOwnershipAttoRep = totalCapacityOwnershipAttoRep) => ({
	settlementCollateralAttoEth,
	currentRetentionRate: 0n,
	feeEligibleCapacityOwnershipAttoRep,
	feeIndex: 0n,
	feeIndexRemainder: 0n,
	lastUpdatedFeeAccumulator: 0n,
	totalFeesOwedRemainder: 0n,
	totalClaimableVaultFeesAttoEth: 0n,
	totalCapacityOwnershipAttoRep,
	unallocatedAccruedFeesAttoEth: 0n,
	uncheckpointedFeeEligibleCapacityOwnershipAttoRep: 0n,
})

describe('securityPools protocol client', () => {
	test('loads selected child deployments in bounded canonical log ranges', async () => {
		const headHash = `0x${'11'.repeat(32)}` as const
		const requestedRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = []
		const requestedEvents: unknown[] = []
		const deploySecurityPoolEvent = statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi.find(entry => entry.type === 'event' && entry.name === 'DeploySecurityPool')
		if (deploySecurityPoolEvent === undefined) throw new Error('DeploySecurityPool event missing from generated ABI')
		const client = createMockLoaderClient({
			getBlock: async () => ({ hash: headHash, number: 20_000n, timestamp: 0n }),
			getLogs: async (request?: object) => {
				const fromBlock = request === undefined ? undefined : Reflect.get(request, 'fromBlock')
				const toBlock = request === undefined ? undefined : Reflect.get(request, 'toBlock')
				if (typeof fromBlock !== 'bigint' || typeof toBlock !== 'bigint') throw new Error('Expected a bounded deployment log range')
				requestedRanges.push({ fromBlock, toBlock })
				requestedEvents.push(request === undefined ? undefined : Reflect.get(request, 'event'))
				if (toBlock - fromBlock + 1n > 10_000n) throw new Error('block range is too large')
				return []
			},
			multicall: async () => [],
			readContract: async request => {
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		expect(await loadSecurityPoolChildren(client, securityPoolAddress)).toEqual([])
		expect(requestedRanges).toEqual([
			{ fromBlock: 0n, toBlock: 9_999n },
			{ fromBlock: 10_000n, toBlock: 19_999n },
			{ fromBlock: 20_000n, toBlock: 20_000n },
		])
		expect(requestedEvents).toEqual([deploySecurityPoolEvent, deploySecurityPoolEvent, deploySecurityPoolEvent])
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
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		await expect(loadSecurityPoolChildren(client, securityPoolAddress)).rejects.toThrow('deployments changed during discovery')
	})

	test('loadSecurityPoolPage preserves exact offsets above the safe multiplication range', async () => {
		const pageIndex = Number.MAX_SAFE_INTEGER
		const pageSize = 3
		const expectedStartIndex = BigInt(pageIndex) * BigInt(pageSize)
		const deploymentRangeCalls: unknown[][] = []
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async () => [],
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return expectedStartIndex + 1n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					deploymentRangeCalls.push(Array.isArray(request.args) ? [...request.args] : [])
					return []
				}
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		await loadSecurityPoolPage(client, pageIndex, pageSize)

		expect(deploymentRangeCalls).toEqual([[expectedStartIndex, 1n]])
	})

	test('loadAllSecurityPools keeps the default root-pool fork outcome unset and inactive', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				if (getContractFunctionName(firstContract) === 'settlementCollateralAttoEth') {
					return [0n, 10n, 7n * 10n ** 18n, 30n * 10n ** 18n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 0n, createPoolAccountingSnapshot(), 0n]
				}
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 1n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							settlementCollateralAttoEth: 0n,
							currentRetentionRate: 0n,
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							statoblastSecurityMultiplierBps: 20_000n,
							securityPool: securityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
					]
				}
				if (request.functionName === 'getVaultCount') return 0n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const pools = await loadAllSecurityPools(client)
		const [pool] = pools
		if (pool === undefined) throw new Error('Expected one security pool')

		expect(pool.parent).toBe(zeroAddress)
		expect(pool.minimumSecurityBondDebtAttoEth).toBe(7n * 10n ** 18n)
		expect(pool.minimumVaultRepDepositAttoRep).toBe(30n * 10n ** 18n)
		expect(pool.forkOutcome).toBe('none')
		expect(pool.hasForkActivity).toBe(false)
	})

	test('loadSecurityPoolPage rejects malformed fork data instead of casting tuple reads', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const firstContract = request.contracts[0]
				if (getContractFunctionName(firstContract) === 'settlementCollateralAttoEth') {
					return [0n, 10n, 10n ** 18n, 10n * 10n ** 18n, [0n, zeroAddress, 0n, 'bad-migrated-rep', 0n, 0n, 0n, 0n, false, false, 0n], 0n, 0n, 3n, 0n, 0n, 0n, createPoolAccountingSnapshot(), 0n]
				}
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 1n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							settlementCollateralAttoEth: 0n,
							currentRetentionRate: 0n,
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							statoblastSecurityMultiplierBps: 20_000n,
							securityPool: securityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
					]
				}
				if (request.functionName === 'getVaultCount') return 0n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		await expect(loadSecurityPoolPage(client, 0, 1)).rejects.toThrow('Unexpected security pool fork data migrated REP response')
	})

	test('loadSecurityPoolPage does not infer parent fork activity from other pools on the same page', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const parentSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000d1')
		const childSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000d2')
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				if (getContractFunctionName(firstContract) === 'settlementCollateralAttoEth') {
					const contractAddress = Reflect.get(firstContract, 'address')
					if (typeof contractAddress !== 'string') throw new Error('Expected security pool address')
					if (getAddress(contractAddress) === parentSecurityPoolAddress) return [0n, 10n, 10n ** 18n, 10n * 10n ** 18n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 0n, createPoolAccountingSnapshot(), 1n]
					if (getAddress(contractAddress) === childSecurityPoolAddress) return [0n, 10n, 10n ** 18n, 10n * 10n ** 18n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 0n, createPoolAccountingSnapshot(), 1n]
				}
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 2n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							settlementCollateralAttoEth: 0n,
							currentRetentionRate: 0n,
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							statoblastSecurityMultiplierBps: 20_000n,
							securityPool: parentSecurityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
						{
							settlementCollateralAttoEth: 0n,
							currentRetentionRate: 0n,
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
							parent: parentSecurityPoolAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							statoblastSecurityMultiplierBps: 20_000n,
							securityPool: childSecurityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 2n,
						},
					]
				}
				if (request.functionName === 'getVaultCount') return 0n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const page = await loadSecurityPoolPage(client, 0, 2)
		const parentPool = page.pools.find(pool => pool.securityPoolAddress === parentSecurityPoolAddress)
		if (parentPool === undefined) throw new Error('Expected parent security pool on the loaded page')

		expect(parentPool.hasForkActivity).toBe(false)
		expect(parentPool.universeHasForked).toBe(true)
	})

	test('loadAllSecurityPools infers parent fork activity when a loaded child points to it', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const parentSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000e1')
		const childSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000e2')
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				if (getContractFunctionName(firstContract) === 'settlementCollateralAttoEth') {
					const contractAddress = Reflect.get(firstContract, 'address')
					if (typeof contractAddress !== 'string') throw new Error('Expected security pool address')
					if (getAddress(contractAddress) === parentSecurityPoolAddress) return [0n, 10n, 10n ** 18n, 10n * 10n ** 18n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 0n, createPoolAccountingSnapshot(), 1n]
					if (getAddress(contractAddress) === childSecurityPoolAddress) return [0n, 10n, 10n ** 18n, 10n * 10n ** 18n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 0n, createPoolAccountingSnapshot(), 1n]
				}
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 2n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							settlementCollateralAttoEth: 0n,
							currentRetentionRate: 0n,
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							statoblastSecurityMultiplierBps: 20_000n,
							securityPool: parentSecurityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
						{
							settlementCollateralAttoEth: 0n,
							currentRetentionRate: 0n,
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
							parent: parentSecurityPoolAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							statoblastSecurityMultiplierBps: 20_000n,
							securityPool: childSecurityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 2n,
						},
					]
				}
				if (request.functionName === 'getVaultCount') return 0n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const pools = await loadAllSecurityPools(client)
		const parentPool = pools.find(pool => pool.securityPoolAddress === parentSecurityPoolAddress)
		if (parentPool === undefined) throw new Error('Expected parent security pool in the loaded list')

		expect(parentPool.hasForkActivity).toBe(true)
		expect(parentPool.universeHasForked).toBe(true)
	})

	test('loadAllSecurityPools batches vault summary tuple reads through multicall', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const previewVaultAddresses = [getAddress('0x00000000000000000000000000000000000000c1'), getAddress('0x00000000000000000000000000000000000000c2'), getAddress('0x00000000000000000000000000000000000000c3')] as const
		const escalationGameAddress = getAddress('0x00000000000000000000000000000000000000c9')
		const loadedVaultAddresses: Address[] = []
		let securityVaultSummaryBatchCount = 0
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'securityVaults' || functionName === 'getVaultOpenInterestAttoEth' || functionName === 'vaultBadDebtAttoEth') expect(request.blockNumber).toBe(0n)
				if (functionName === 'settlementCollateralAttoEth') {
					return [0n, 10n, 10n ** 18n, 10n * 10n ** 18n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 100n, createPoolAccountingSnapshot(), 0n]
				}
				if (functionName === 'questions') return [questionTuple, 1n]
				if (functionName === 'getVaultOpenInterestAttoEth') return contracts.map(() => 0n)
				if (functionName === 'vaultBadDebtAttoEth') {
					return contracts.map(contract => {
						const args = Reflect.get(contract, 'args')
						if (!Array.isArray(args) || typeof args[0] !== 'string') throw new Error('Expected vaultBadDebtAttoEth args')
						return getAddress(args[0]) === previewVaultAddresses[1] ? 7n : 0n
					})
				}
				if (functionName === 'securityVaults') {
					securityVaultSummaryBatchCount += 1
					return contracts.map(contract => {
						const args = Reflect.get(contract, 'args')
						if (!Array.isArray(args) || typeof args[0] !== 'string') throw new Error('Expected securityVaults args')
						const currentVaultAddress = getAddress(args[0])
						loadedVaultAddresses.push(currentVaultAddress)
						return currentVaultAddress === previewVaultAddresses[0] ? [2n, 0n, 0n, 0n, 0n] : [0n, 0n, 0n, 0n, 0n]
					})
				}
				if (functionName === 'disputeStakedRepByVaultAttoRep') {
					return contracts.map(contract => {
						const args = Reflect.get(contract, 'args')
						if (!Array.isArray(args) || typeof args[0] !== 'string') throw new Error('Expected disputeStakedRepByVaultAttoRep args')
						return getAddress(args[0]) === previewVaultAddresses[0] ? 5n : 0n
					})
				}
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 1n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							statoblastSecurityMultiplierBps: 20_000n,
							securityPool: securityPoolAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
					]
				}
				if (request.functionName === 'getVaultCount') return 3n
				if (request.functionName === 'getVaults') return previewVaultAddresses
				if (request.functionName === 'securityVaults') throw new Error('Expected batched securityVaults multicall')
				if (request.functionName === 'escalationGame') return escalationGameAddress
				if (request.functionName === 'disputeStakedRepByVaultAttoRep') return request.args?.[0] === previewVaultAddresses[0] ? 5n : 0n
				if (request.functionName === 'getTotalPoolHeldAttoRep') return 100n
				if (request.functionName === 'totalRepBackingUnits') return 10n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const pools = await loadAllSecurityPools(client)
		const [pool] = pools
		if (pool === undefined) throw new Error('Expected one security pool')

		expect(securityVaultSummaryBatchCount).toBe(1)
		expect(loadedVaultAddresses).toEqual([...previewVaultAddresses])
		expect(pool.vaults.map(vault => vault.vaultAddress)).toEqual([previewVaultAddresses[0], previewVaultAddresses[1]])
		expect(pool.vaults.map(vault => vault.disputeStakedAttoRep)).toEqual([5n, 0n])
		expect(pool.vaults.map(vault => vault.badDebtAttoEth)).toEqual([0n, 7n])
	})

	test('loadSecurityPoolPage includes bounded actionable vault previews', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const viewerVaultAddress = getAddress('0x00000000000000000000000000000000000000c4')
		const previewVaultAddresses = [getAddress('0x00000000000000000000000000000000000000c1'), getAddress('0x00000000000000000000000000000000000000c2'), getAddress('0x00000000000000000000000000000000000000c3')]
		let getVaultsCallCount = 0
		let securityVaultSummaryMulticallCount = 0
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'settlementCollateralAttoEth') {
					return [0n, 10n, 10n ** 18n, 10n * 10n ** 18n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 100n, createPoolAccountingSnapshot(), 0n]
				}
				if (functionName === 'questions') return [questionTuple, 1n]
				if (functionName === 'getVaultOpenInterestAttoEth') return contracts.map(() => 0n)
				if (functionName === 'vaultBadDebtAttoEth') return contracts.map(() => 0n)
				if (functionName === 'securityVaults') {
					securityVaultSummaryMulticallCount += 1
					return contracts.map(() => [2n, 0n, 0n, 0n, 0n])
				}
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 1n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							statoblastSecurityMultiplierBps: 20_000n,
							securityPool: securityPoolAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
					]
				}
				if (request.functionName === 'getVaultCount') return 5n
				if (request.functionName === 'getVaults') {
					getVaultsCallCount += 1
					expect(request.args).toEqual([0n, 5n])
					return previewVaultAddresses
				}
				if (request.functionName === 'securityVaults') throw new Error('Expected batched securityVaults multicall')
				if (request.functionName === 'escalationGame') return zeroAddress
				if (request.functionName === 'getTotalPoolHeldAttoRep') return 100n
				if (request.functionName === 'totalRepBackingUnits') return 10n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const page = await loadSecurityPoolPage(client, 0, 1, viewerVaultAddress)
		const [pool] = page.pools
		if (pool === undefined) throw new Error('Expected one paged security pool')

		expect(getVaultsCallCount).toBe(1)
		expect(securityVaultSummaryMulticallCount).toBe(1)
		expect(pool.hasLoadedVaults).toBe(true)
		expect(pool.vaults.map(vault => vault.vaultAddress)).toEqual([...previewVaultAddresses, viewerVaultAddress])
		expect(pool.vaultCount).toBe(5n)
		expect(pool.totalPoolHeldAttoRep).toBe(100n)
		expect(pool.questionId).toBe('0x1')
	})

	test('loadSecurityPoolPage scans past exited known vaults to fill actionable previews', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const knownVaultAddresses = [getAddress('0x00000000000000000000000000000000000000c1'), getAddress('0x00000000000000000000000000000000000000c2'), getAddress('0x00000000000000000000000000000000000000c3'), getAddress('0x00000000000000000000000000000000000000c4')]
		const currentVaultAddress = knownVaultAddresses[3]
		if (currentVaultAddress === undefined) throw new Error('Expected a current vault address')
		const getVaultsCalls: [bigint, bigint][] = []
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'settlementCollateralAttoEth') {
					return [0n, 10n, 10n ** 18n, 10n * 10n ** 18n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 100n, createPoolAccountingSnapshot(), 0n]
				}
				if (functionName === 'questions') return [questionTuple, 1n]
				if (functionName === 'getVaultOpenInterestAttoEth' || functionName === 'vaultBadDebtAttoEth') return contracts.map(() => 0n)
				if (functionName === 'securityVaults') {
					return contracts.map(contract => {
						const args = Reflect.get(contract, 'args')
						if (!Array.isArray(args) || typeof args[0] !== 'string') throw new Error('Expected securityVaults args')
						return getAddress(args[0]) === currentVaultAddress ? [2n, 0n, 0n, 0n, 0n] : [0n, 0n, 0n, 0n, 0n]
					})
				}
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 1n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							statoblastSecurityMultiplierBps: 20_000n,
							securityPool: securityPoolAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
					]
				}
				if (request.functionName === 'getVaultCount') {
					expect(request.blockNumber).toBe(0n)
					return BigInt(knownVaultAddresses.length)
				}
				if (request.functionName === 'getVaults') {
					expect(request.blockNumber).toBe(0n)
					const [startIndex, count] = request.args ?? []
					if (typeof startIndex !== 'bigint' || typeof count !== 'bigint') throw new Error('Expected getVaults pagination args')
					getVaultsCalls.push([startIndex, count])
					return knownVaultAddresses.slice(bigintToSafeNumber(startIndex, 'Vault start index'), bigintToSafeNumber(startIndex + count, 'Vault end index'))
				}
				if (request.functionName === 'securityVaults') throw new Error('Expected batched securityVaults multicall')
				if (request.functionName === 'escalationGame') return zeroAddress
				if (request.functionName === 'getTotalPoolHeldAttoRep') return 100n
				if (request.functionName === 'totalRepBackingUnits') return 10n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const page = await loadSecurityPoolPage(client, 0, 1)
		const [pool] = page.pools
		if (pool === undefined) throw new Error('Expected one paged security pool')

		expect(getVaultsCalls).toEqual([[0n, 4n]])
		expect(pool.vaults.map(vault => vault.vaultAddress)).toEqual([currentVaultAddress])
		expect(pool.vaultCount).toBe(4n)
	})

	test('loadSecurityPoolPage caps registry scans when arbitrary empty addresses exceed the scan budget', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const knownVaultAddresses = Array.from({ length: 600 }, (_, index) =>
			getAddress(
				`0x${BigInt(index + 1)
					.toString(16)
					.padStart(40, '0')}`,
			),
		)
		const getVaultsCalls: [bigint, bigint][] = []
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'settlementCollateralAttoEth') {
					return [0n, 10n, 10n ** 18n, 10n * 10n ** 18n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 100n, createPoolAccountingSnapshot(), 0n]
				}
				if (functionName === 'questions') return [questionTuple, 1n]
				if (functionName === 'getVaultOpenInterestAttoEth' || functionName === 'vaultBadDebtAttoEth') return contracts.map(() => 0n)
				if (functionName === 'securityVaults') return contracts.map(() => [0n, 0n, 0n, 0n, 0n])
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 1n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							statoblastSecurityMultiplierBps: 20_000n,
							securityPool: securityPoolAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
					]
				}
				if (request.functionName === 'getVaultCount') return BigInt(knownVaultAddresses.length)
				if (request.functionName === 'getVaults') {
					const [startIndex, count] = request.args ?? []
					if (typeof startIndex !== 'bigint' || typeof count !== 'bigint') throw new Error('Expected getVaults pagination args')
					getVaultsCalls.push([startIndex, count])
					return knownVaultAddresses.slice(bigintToSafeNumber(startIndex, 'Vault start index'), bigintToSafeNumber(startIndex + count, 'Vault end index'))
				}
				if (request.functionName === 'securityVaults') throw new Error('Expected batched securityVaults multicall')
				if (request.functionName === 'escalationGame') return zeroAddress
				if (request.functionName === 'getTotalPoolHeldAttoRep') return 100n
				if (request.functionName === 'totalRepBackingUnits') return 10n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const page = await loadSecurityPoolPage(client, 0, 1)
		const [pool] = page.pools
		if (pool === undefined) throw new Error('Expected one paged security pool')

		expect(getVaultsCalls).toHaveLength(10)
		expect(getVaultsCalls[0]).toEqual([0n, 50n])
		expect(getVaultsCalls[9]).toEqual([450n, 50n])
		expect(pool.vaults).toEqual([])
		expect(pool.vaultScanCapped).toBe(true)
	})

	test('loadSecurityPoolPage keeps the connected account after later positions fill the preview cap', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const knownVaultAddresses = [
			getAddress('0x00000000000000000000000000000000000000c1'),
			getAddress('0x00000000000000000000000000000000000000c2'),
			getAddress('0x00000000000000000000000000000000000000c3'),
			getAddress('0x00000000000000000000000000000000000000c4'),
			getAddress('0x00000000000000000000000000000000000000c5'),
			getAddress('0x00000000000000000000000000000000000000c6'),
		]
		const firstPreviewVaultAddress = knownVaultAddresses[0]
		const secondPreviewVaultAddress = knownVaultAddresses[1]
		const accountAddress = knownVaultAddresses[5]
		const thirdPreviewVaultAddress = knownVaultAddresses[3]
		if (firstPreviewVaultAddress === undefined || secondPreviewVaultAddress === undefined || accountAddress === undefined || thirdPreviewVaultAddress === undefined) throw new Error('Expected current vault addresses')
		const currentVaultAddresses = new Set([firstPreviewVaultAddress, secondPreviewVaultAddress, thirdPreviewVaultAddress, accountAddress])
		const getVaultsCalls: [bigint, bigint][] = []
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'settlementCollateralAttoEth') {
					return [0n, 10n, 10n ** 18n, 10n * 10n ** 18n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 100n, createPoolAccountingSnapshot(), 0n]
				}
				if (functionName === 'questions') return [questionTuple, 1n]
				if (functionName === 'getVaultOpenInterestAttoEth' || functionName === 'vaultBadDebtAttoEth') return contracts.map(() => 0n)
				if (functionName === 'securityVaults') {
					return contracts.map(contract => {
						const args = Reflect.get(contract, 'args')
						if (!Array.isArray(args) || typeof args[0] !== 'string') throw new Error('Expected securityVaults args')
						return currentVaultAddresses.has(getAddress(args[0])) ? [2n, 0n, 0n, 0n, 0n] : [0n, 0n, 0n, 0n, 0n]
					})
				}
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 1n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							statoblastSecurityMultiplierBps: 20_000n,
							securityPool: securityPoolAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
					]
				}
				if (request.functionName === 'getVaultCount') return BigInt(knownVaultAddresses.length)
				if (request.functionName === 'getVaults') {
					const [startIndex, count] = request.args ?? []
					if (typeof startIndex !== 'bigint' || typeof count !== 'bigint') throw new Error('Expected getVaults pagination args')
					getVaultsCalls.push([startIndex, count])
					return knownVaultAddresses.slice(bigintToSafeNumber(startIndex, 'Vault start index'), bigintToSafeNumber(startIndex + count, 'Vault end index'))
				}
				if (request.functionName === 'securityVaults') throw new Error('Expected batched securityVaults multicall')
				if (request.functionName === 'escalationGame') return zeroAddress
				if (request.functionName === 'getTotalPoolHeldAttoRep') return 100n
				if (request.functionName === 'totalRepBackingUnits') return 10n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const page = await loadSecurityPoolPage(client, 0, 1, accountAddress)
		const [pool] = page.pools
		if (pool === undefined) throw new Error('Expected one paged security pool')

		expect(getVaultsCalls).toEqual([[0n, 6n]])
		expect(pool.vaults.map(vault => vault.vaultAddress)).toEqual([firstPreviewVaultAddress, secondPreviewVaultAddress, thirdPreviewVaultAddress, accountAddress])
	})

	test('loadSecurityPoolPage marks empty browse-page vault sets as already loaded', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		let getVaultsCallCount = 0
		let securityVaultSummaryMulticallCount = 0
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'settlementCollateralAttoEth') {
					return [0n, 10n, 10n ** 18n, 10n * 10n ** 18n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 100n, createPoolAccountingSnapshot(), 0n]
				}
				if (functionName === 'questions') return [questionTuple, 1n]
				if (functionName === 'getVaultOpenInterestAttoEth') return contracts.map(() => 0n)
				if (functionName === 'vaultBadDebtAttoEth') return contracts.map(() => 0n)
				if (functionName === 'securityVaults') {
					securityVaultSummaryMulticallCount += 1
					return contracts.map(() => [2n, 0n, 0n, 0n, 0n])
				}
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 1n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							statoblastSecurityMultiplierBps: 20_000n,
							securityPool: securityPoolAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
					]
				}
				if (request.functionName === 'getVaultCount') return 0n
				if (request.functionName === 'getVaults') {
					getVaultsCallCount += 1
					throw new Error('Empty browse-page loads should not fetch preview vault addresses')
				}
				if (request.functionName === 'securityVaults') throw new Error('Empty browse-page loads should not fetch per-vault summaries')
				if (request.functionName === 'escalationGame') return zeroAddress
				if (request.functionName === 'getTotalPoolHeldAttoRep') return 100n
				if (request.functionName === 'totalRepBackingUnits') return 10n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const page = await loadSecurityPoolPage(client, 0, 1)
		const [pool] = page.pools
		if (pool === undefined) throw new Error('Expected one paged security pool')

		expect(getVaultsCallCount).toBe(0)
		expect(securityVaultSummaryMulticallCount).toBe(0)
		expect(pool.hasLoadedVaults).toBe(true)
		expect(pool.vaultCount).toBe(0n)
		expect(pool.vaults).toEqual([])
	})

	test('loadAllSecurityPools defers vault detail loading for unselected pools in selected mode', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const getVaultCalls: Address[] = []
		const vaultSummaryCalls: Address[] = []
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'settlementCollateralAttoEth') {
					return [0n, 10n, 10n ** 18n, 10n * 10n ** 18n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 5n, createPoolAccountingSnapshot(0n, 9n, 3n), 0n]
				}
				if (functionName === 'questions') return [questionTuple, 1n]
				if (functionName === 'backingUnitsToAttoRep') return [5n]
				if (functionName === 'getVaultOpenInterestAttoEth') return contracts.map(() => 0n)
				if (functionName === 'vaultBadDebtAttoEth') return contracts.map(() => 0n)
				if (functionName === 'securityVaults') {
					const address = Reflect.get(firstContract, 'address')
					if (typeof address !== 'string') throw new Error('Expected security pool address')
					vaultSummaryCalls.push(getAddress(address))
					return contracts.map(() => [1n, 3n, 0n, 0n, 0n])
				}
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 2n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							settlementCollateralAttoEth: 0n,
							currentRetentionRate: 0n,
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							statoblastSecurityMultiplierBps: 20_000n,
							securityPool: securityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
						{
							settlementCollateralAttoEth: 0n,
							currentRetentionRate: 0n,
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							statoblastSecurityMultiplierBps: 20_000n,
							securityPool: alternateSecurityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 2n,
						},
					]
				}
				if (request.functionName === 'getVaultCount') {
					const address = Reflect.get(request, 'address')
					if (typeof address !== 'string') throw new Error('Expected security pool address')
					return getAddress(address) === securityPoolAddress ? 1n : 2n
				}
				if (request.functionName === 'getVaults') {
					const address = Reflect.get(request, 'address')
					if (typeof address !== 'string') throw new Error('Expected security pool address')
					const normalizedAddress = getAddress(address)
					getVaultCalls.push(normalizedAddress)
					if (normalizedAddress === alternateSecurityPoolAddress) throw new Error('Unexpected vault load for unselected pool')
					return [vaultAddress]
				}
				if (request.functionName === 'securityVaults') throw new Error('Expected batched securityVaults multicall')
				if (request.functionName === 'escalationGame') return zeroAddress
				if (request.functionName === 'getTotalPoolHeldAttoRep') return 5n
				if (request.functionName === 'totalRepBackingUnits') return 1n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
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
		expect(selectedPool.feeEligibleCapacityOwnershipAttoRep).toBe(3n)
		expect(selectedPool.totalPoolHeldAttoRep).toBe(5n)
		expect(selectedPool.totalCapacityOwnershipAttoRep).toBe(9n)
		expect(deferredPool.hasLoadedVaults).toBe(false)
		expect(deferredPool.vaults).toEqual([])
		expect(deferredPool.vaultCount).toBe(2n)
	})

	test('loadSecurityPoolMintCapacity reads only selected-pool capacity fields', async () => {
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
				if (request.contracts.length === 8) return [createPoolAccountingSnapshot(11n, 44n, 17n), 22n, 33n, 55n, zeroAddress, 88n, alternateSecurityPoolAddress, 66n]
				return getContractFunctionName(request.contracts[0]) === 'isPriceValid' ? [true] : [77n]
			}),
			readContract: async () => {
				throw new Error('readContract should not be called')
			},
		})

		const capacity = await loadSecurityPoolMintCapacity(client, securityPoolAddress)

		expect(capacity).toEqual({
			currentRetentionRate: 88n,
			currentTimestamp: 99n,
			feeEndTimestamp: 77n,
			feeIndexRemainder: 0n,
			lastUpdatedFeeAccumulator: 0n,
			settlementCollateralAttoEth: 11n,
			feeEligibleCapacityOwnershipAttoRep: 17n,
			mintingCapacityAttoEth: 55n,
			shareTokenSupplyAttoShares: 22n,
			totalPoolHeldAttoRep: 33n,
			totalCapacityOwnershipAttoRep: 44n,
			isPriceValid: true,
			totalFeesOwedRemainder: 0n,
		})
		expect(requestedFunctionNames).toEqual(['getPoolAccountingSnapshot', 'shareTokenSupplyAttoShares', 'getTotalPoolHeldAttoRep', 'getCurrentMintingCapacityAttoEth', 'priceOracleManagerAndOperatorQueuer', 'currentRetentionRate', 'questionData', 'questionId', 'isPriceValid', 'getQuestionEndDate'])
		expect(requestedAddresses).toEqual([securityPoolAddress, securityPoolAddress, securityPoolAddress, securityPoolAddress, securityPoolAddress, securityPoolAddress, securityPoolAddress, securityPoolAddress, zeroAddress, alternateSecurityPoolAddress])
	})
})
