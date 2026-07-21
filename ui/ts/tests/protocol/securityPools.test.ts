/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress, type Address } from '@zoltar/shared/ethereum'
import { loadAllSecurityPools, loadSecurityPoolMintCapacity, loadSecurityPoolPage } from '../../protocol/index.js'
import { createBlockWithTimestamp, createMockLoaderClient, createMulticallStub, getContractFunctionName } from './testSupport.js'

const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000a1')
const vaultAddress = getAddress('0x00000000000000000000000000000000000000c1')
const alternateSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000a2')
const shareTokenAddress = getAddress('0x00000000000000000000000000000000000000b2')
const defaultForkData = [0n, zeroAddress, 0n, 0n, 0n, 0n, 0n, 0n, false, false, 0n] as const

describe('securityPools protocol client', () => {
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
				if (getContractFunctionName(firstContract) === 'completeSetCollateralAmount') {
					return [0n, 10n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 0n, 0n, 0n]
				}
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 1n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							completeSetCollateralAmount: 0n,
							currentRetentionRate: 0n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							securityMultiplier: 2n,
							securityPool: securityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
					]
				}
				if (request.functionName === 'getVaultCount' || request.functionName === 'getActiveVaultCount') return 0n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const pools = await loadAllSecurityPools(client)
		const [pool] = pools
		if (pool === undefined) throw new Error('Expected one security pool')

		expect(pool.parent).toBe(zeroAddress)
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
				if (getContractFunctionName(firstContract) === 'completeSetCollateralAmount') {
					return [0n, 10n, [0n, zeroAddress, 0n, 'bad-migrated-rep', 0n, 0n, 0n, 0n, false, false, 0n], 0n, 0n, 3n, 0n, 0n, 0n, 0n, 0n]
				}
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 1n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							completeSetCollateralAmount: 0n,
							currentRetentionRate: 0n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							securityMultiplier: 2n,
							securityPool: securityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
					]
				}
				if (request.functionName === 'getVaultCount' || request.functionName === 'getActiveVaultCount') return 0n
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
				if (getContractFunctionName(firstContract) === 'completeSetCollateralAmount') {
					const contractAddress = Reflect.get(firstContract, 'address')
					if (typeof contractAddress !== 'string') throw new Error('Expected security pool address')
					if (getAddress(contractAddress) === parentSecurityPoolAddress) return [0n, 10n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 0n, 0n, 1n]
					if (getAddress(contractAddress) === childSecurityPoolAddress) return [0n, 10n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 0n, 0n, 1n]
				}
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 2n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							completeSetCollateralAmount: 0n,
							currentRetentionRate: 0n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							securityMultiplier: 2n,
							securityPool: parentSecurityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
						{
							completeSetCollateralAmount: 0n,
							currentRetentionRate: 0n,
							parent: parentSecurityPoolAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							securityMultiplier: 2n,
							securityPool: childSecurityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 2n,
						},
					]
				}
				if (request.functionName === 'getVaultCount' || request.functionName === 'getActiveVaultCount') return 0n
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
				if (getContractFunctionName(firstContract) === 'completeSetCollateralAmount') {
					const contractAddress = Reflect.get(firstContract, 'address')
					if (typeof contractAddress !== 'string') throw new Error('Expected security pool address')
					if (getAddress(contractAddress) === parentSecurityPoolAddress) return [0n, 10n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 0n, 0n, 1n]
					if (getAddress(contractAddress) === childSecurityPoolAddress) return [0n, 10n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 0n, 0n, 1n]
				}
				if (getContractFunctionName(firstContract) === 'questions') return [questionTuple, 1n]
				throw new Error(`Unexpected multicall contract: ${getContractFunctionName(firstContract)}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 2n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							completeSetCollateralAmount: 0n,
							currentRetentionRate: 0n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							securityMultiplier: 2n,
							securityPool: parentSecurityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
						{
							completeSetCollateralAmount: 0n,
							currentRetentionRate: 0n,
							parent: parentSecurityPoolAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							securityMultiplier: 2n,
							securityPool: childSecurityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 2n,
						},
					]
				}
				if (request.functionName === 'getVaultCount' || request.functionName === 'getActiveVaultCount') return 0n
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
		const previewVaultAddresses = [getAddress('0x00000000000000000000000000000000000000c1'), getAddress('0x00000000000000000000000000000000000000c2')] as const
		const loadedVaultAddresses: Address[] = []
		let securityVaultSummaryBatchCount = 0
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'completeSetCollateralAmount') {
					return [0n, 10n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 100n, 0n, 0n]
				}
				if (functionName === 'questions') return [questionTuple, 1n]
				if (functionName === 'securityVaults') {
					securityVaultSummaryBatchCount += 1
					return contracts.map(contract => {
						const args = Reflect.get(contract, 'args')
						if (!Array.isArray(args) || typeof args[0] !== 'string') throw new Error('Expected securityVaults args')
						const currentVaultAddress = getAddress(args[0])
						loadedVaultAddresses.push(currentVaultAddress)
						return [2n, 0n, 0n, 0n, 0n]
					})
				}
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			},
			readContract: async request => {
				if (request.functionName === 'securityPoolDeploymentCount') return 1n
				if (request.functionName === 'securityPoolDeploymentsRange') {
					return [
						{
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							securityMultiplier: 2n,
							securityPool: securityPoolAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
					]
				}
				if (request.functionName === 'getActiveVaultCount') return 2n
				if (request.functionName === 'getActiveVaults') return previewVaultAddresses
				if (request.functionName === 'securityVaults') throw new Error('Expected batched securityVaults multicall')
				if (request.functionName === 'escalationGame') return zeroAddress
				if (request.functionName === 'getTotalRepBalance') return 100n
				if (request.functionName === 'poolOwnershipDenominator') return 10n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const pools = await loadAllSecurityPools(client)
		const [pool] = pools
		if (pool === undefined) throw new Error('Expected one security pool')

		expect(securityVaultSummaryBatchCount).toBe(1)
		expect(loadedVaultAddresses).toEqual([...previewVaultAddresses])
		expect(pool.vaults.map(vault => vault.vaultAddress)).toEqual([...previewVaultAddresses])
	})

	test('loadSecurityPoolPage includes bounded actionable vault previews', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		const viewerVaultAddress = getAddress('0x00000000000000000000000000000000000000c4')
		const previewVaultAddresses = [getAddress('0x00000000000000000000000000000000000000c1'), getAddress('0x00000000000000000000000000000000000000c2'), getAddress('0x00000000000000000000000000000000000000c3')]
		let getActiveVaultsCallCount = 0
		let securityVaultSummaryMulticallCount = 0
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'completeSetCollateralAmount') {
					return [0n, 10n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 100n, 0n, 0n]
				}
				if (functionName === 'questions') return [questionTuple, 1n]
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
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							securityMultiplier: 2n,
							securityPool: securityPoolAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
					]
				}
				if (request.functionName === 'getActiveVaultCount') return 5n
				if (request.functionName === 'getActiveVaults') {
					getActiveVaultsCallCount += 1
					expect(request.args).toEqual([0n, 3n])
					return previewVaultAddresses
				}
				if (request.functionName === 'securityVaults') throw new Error('Expected batched securityVaults multicall')
				if (request.functionName === 'escalationGame') return zeroAddress
				if (request.functionName === 'getTotalRepBalance') return 100n
				if (request.functionName === 'poolOwnershipDenominator') return 10n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const page = await loadSecurityPoolPage(client, 0, 1, viewerVaultAddress)
		const [pool] = page.pools
		if (pool === undefined) throw new Error('Expected one paged security pool')

		expect(getActiveVaultsCallCount).toBe(1)
		expect(securityVaultSummaryMulticallCount).toBe(1)
		expect(pool.hasLoadedVaults).toBe(true)
		expect(pool.vaults.map(vault => vault.vaultAddress)).toEqual([...previewVaultAddresses, viewerVaultAddress])
		expect(pool.vaultCount).toBe(5n)
		expect(pool.totalRepDeposit).toBe(100n)
		expect(pool.questionId).toBe('0x1')
	})

	test('loadSecurityPoolPage marks empty browse-page vault sets as already loaded', async () => {
		const questionId = 1n
		const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const
		let getActiveVaultsCallCount = 0
		let securityVaultSummaryMulticallCount = 0
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'completeSetCollateralAmount') {
					return [0n, 10n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 100n, 0n, 0n]
				}
				if (functionName === 'questions') return [questionTuple, 1n]
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
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							securityMultiplier: 2n,
							securityPool: securityPoolAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
					]
				}
				if (request.functionName === 'getActiveVaultCount') return 0n
				if (request.functionName === 'getActiveVaults') {
					getActiveVaultsCallCount += 1
					throw new Error('Empty browse-page loads should not fetch preview vault addresses')
				}
				if (request.functionName === 'securityVaults') throw new Error('Empty browse-page loads should not fetch per-vault summaries')
				if (request.functionName === 'escalationGame') return zeroAddress
				if (request.functionName === 'getTotalRepBalance') return 100n
				if (request.functionName === 'poolOwnershipDenominator') return 10n
				if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const page = await loadSecurityPoolPage(client, 0, 1)
		const [pool] = page.pools
		if (pool === undefined) throw new Error('Expected one paged security pool')

		expect(getActiveVaultsCallCount).toBe(0)
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
				if (functionName === 'completeSetCollateralAmount') {
					return [0n, 10n, defaultForkData, 0n, 0n, 3n, 0n, 0n, 5n, 0n, 0n]
				}
				if (functionName === 'questions') return [questionTuple, 1n]
				if (functionName === 'poolOwnershipToRep') return [5n]
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
							completeSetCollateralAmount: 0n,
							currentRetentionRate: 0n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							securityMultiplier: 2n,
							securityPool: securityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 1n,
						},
						{
							completeSetCollateralAmount: 0n,
							currentRetentionRate: 0n,
							parent: zeroAddress,
							priceOracleManagerAndOperatorQueuer: zeroAddress,
							questionId,
							securityMultiplier: 2n,
							securityPool: alternateSecurityPoolAddress,
							shareToken: shareTokenAddress,
							truthAuction: zeroAddress,
							universeId: 2n,
						},
					]
				}
				if (request.functionName === 'getVaultCount' || request.functionName === 'getActiveVaultCount') {
					const address = Reflect.get(request, 'address')
					if (typeof address !== 'string') throw new Error('Expected security pool address')
					return getAddress(address) === securityPoolAddress ? 1n : 2n
				}
				if (request.functionName === 'getVaults' || request.functionName === 'getActiveVaults') {
					const address = Reflect.get(request, 'address')
					if (typeof address !== 'string') throw new Error('Expected security pool address')
					const normalizedAddress = getAddress(address)
					getVaultCalls.push(normalizedAddress)
					if (normalizedAddress === alternateSecurityPoolAddress) throw new Error('Unexpected vault load for unselected pool')
					return [vaultAddress]
				}
				if (request.functionName === 'securityVaults') throw new Error('Expected batched securityVaults multicall')
				if (request.functionName === 'escalationGame') return zeroAddress
				if (request.functionName === 'getTotalRepBalance') return 5n
				if (request.functionName === 'poolOwnershipDenominator') return 1n
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
		expect(selectedPool.totalRepDeposit).toBe(5n)
		expect(deferredPool.hasLoadedVaults).toBe(false)
		expect(deferredPool.vaults).toEqual([])
		expect(deferredPool.vaultCount).toBe(2n)
	})

	test('loadSecurityPoolMintCapacity reads only selected-pool capacity fields', async () => {
		const requestedFunctionNames: string[] = []
		const requestedAddresses: Address[] = []
		const client: Parameters<typeof loadSecurityPoolMintCapacity>[0] = {
			multicall: createMulticallStub(async request => {
				for (const contract of request.contracts) {
					requestedFunctionNames.push(getContractFunctionName(contract))
					const address = Reflect.get(contract, 'address')
					if (typeof address !== 'string') throw new Error('Expected security pool address')
					requestedAddresses.push(getAddress(address))
				}
				return [11n, 22n, 33n, 44n]
			}),
		}

		const capacity = await loadSecurityPoolMintCapacity(client, securityPoolAddress)

		expect(capacity).toEqual({
			completeSetCollateralAmount: 11n,
			shareTokenSupply: 22n,
			totalRepDeposit: 33n,
			totalSecurityBondAllowance: 44n,
		})
		expect(requestedFunctionNames).toEqual(['completeSetCollateralAmount', 'shareTokenSupply', 'getTotalRepBalance', 'totalSecurityBondAllowance'])
		expect(requestedAddresses).toEqual([securityPoolAddress, securityPoolAddress, securityPoolAddress, securityPoolAddress])
	})
})
