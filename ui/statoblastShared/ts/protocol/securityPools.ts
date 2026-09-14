export { createSecurityPool, originSecurityPoolExists } from './securityPoolCreation.js'
import { zeroAddress, type Address, type ContractFunctionParameters } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_EscalationGame_EscalationGame, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_SecurityPool_SecurityPool, statoblast_SecurityPoolForker_SecurityPoolForker, statoblast_factories_SecurityPoolFactory_SecurityPoolFactory } from '../contractArtifact.js'
import { ReputationToken_ReputationToken, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import { SECURITY_POOL_QUESTION_OUTCOME_ABI } from './securityPoolAbi.js'
import { deriveHasForkActivity } from './forkActivity.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { ListedSecurityPool, SecurityPoolPage, SecurityPoolVaultSummary, SecurityVaultDetails, ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { readRequiredMulticall, readWithRpcStateRetries } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { requireForkDataView } from './forkData.js'
import { getForkOutcomeKey, getProtocolPageOffset, getQuestionIdHex, getReportingOutcomeKey, getSecurityPoolSystemState } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { requireSecurityPoolDeploymentTupleArray, requireSecurityVaultTupleArray, type SecurityPoolDeploymentTuple } from './helpers.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { loadMarketDetails } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
const SECURITY_POOL_LIST_VAULT_PREVIEW_LIMIT = 50n
const SECURITY_POOL_PAGE_VAULT_PREVIEW_LIMIT = 3n
const SECURITY_POOL_VAULT_SCAN_LIMIT = 500n
const SECURITY_POOL_VAULT_SCAN_PAGE_SIZE = 50n
const securityPoolFactoryAbi = statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi
type LoadAllSecurityPoolsOptions = {
	accountAddress?: Address
	selectedSecurityPoolAddress?: Address | string
	vaultDetailMode?: 'all' | 'selected'
}

async function securityPoolExists(client: Pick<ReadClient, 'getCode'>, securityPoolAddress: Address) {
	const code = await client.getCode({ address: securityPoolAddress })
	return code !== undefined && code !== '0x'
}

export async function isSecurityPoolVaultAdmissionClosed(client: Pick<ReadClient, 'getBlock' | 'readContract'>, securityPoolAddress: Address) {
	const [escalationGame, questionData, questionId] = await Promise.all([
		client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPoolAddress,
			functionName: 'escalationGame',
			args: [],
		}),
		client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPoolAddress,
			functionName: 'questionData',
			args: [],
		}),
		client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPoolAddress,
			functionName: 'questionId',
			args: [],
		}),
	])
	const [questionEndTime, block] = await Promise.all([
		client.readContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			address: questionData,
			functionName: 'getQuestionEndDate',
			args: [questionId],
		}),
		client.getBlock(),
	])
	if (block.timestamp < questionEndTime) return false
	if (sameAddress(escalationGame, zeroAddress)) return true
	return !(await client.readContract({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		address: escalationGame,
		functionName: 'forkContinuation',
		args: [],
	}))
}

async function getSecurityPoolVaultCount(client: Pick<ReadClient, 'readContract'>, securityPoolAddress: Address, blockNumber?: bigint) {
	return await client.readContract({
		abi: statoblast_SecurityPool_SecurityPool.abi,
		functionName: 'getVaultCount',
		address: securityPoolAddress,
		args: [],
		blockNumber,
	})
}

async function getSecurityPoolVaults(client: Pick<ReadClient, 'readContract'>, securityPoolAddress: Address, startIndex: bigint, count: bigint, blockNumber: bigint) {
	return await client.readContract({
		abi: statoblast_SecurityPool_SecurityPool.abi,
		functionName: 'getVaults',
		address: securityPoolAddress,
		args: [startIndex, count],
		blockNumber,
	})
}

async function loadEscalationVaultData(client: Pick<ReadClient, 'multicall' | 'readContract'>, securityPoolAddress: Address, vaultAddresses: Address[], blockNumber?: bigint) {
	if (vaultAddresses.length === 0) return []
	const escalationGameAddress = await client.readContract({
		abi: statoblast_SecurityPool_SecurityPool.abi,
		functionName: 'escalationGame',
		address: securityPoolAddress,
		args: [],
		blockNumber,
	})
	if (sameAddress(escalationGameAddress, zeroAddress)) {
		return vaultAddresses.map(() => ({ disputeStakedAttoRep: 0n }))
	}
	const disputeStakeContracts: ContractFunctionParameters[] = vaultAddresses.map(vaultAddress => ({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		functionName: 'disputeStakedRepByVaultAttoRep',
		address: escalationGameAddress,
		args: [vaultAddress],
	}))
	const disputeStakedAttoRep = await readRequiredMulticall(client, disputeStakeContracts, blockNumber)
	return disputeStakedAttoRep.map(value => {
		if (typeof value !== 'bigint') throw new Error('Unexpected escalation vault response')
		return { disputeStakedAttoRep: value }
	})
}

function hasCurrentSecurityVaultState(vaultData: readonly [bigint, bigint, bigint, bigint] | readonly [bigint, bigint, bigint, bigint, bigint]) {
	const [repBackingUnits, capacityOwnershipAttoRep, claimableFeesAttoEth] = vaultData
	return repBackingUnits > 0n || capacityOwnershipAttoRep > 0n || claimableFeesAttoEth > 0n
}

function getVaultRepBackingAttoRepFromRepBackingUnits({ repBackingUnits, totalRepBackingUnits, totalPoolHeldRepBalanceAttoRep }: { repBackingUnits: bigint; totalRepBackingUnits: bigint; totalPoolHeldRepBalanceAttoRep: bigint }) {
	if (repBackingUnits === 0n || totalRepBackingUnits === 0n) return 0n
	return (repBackingUnits * totalPoolHeldRepBalanceAttoRep) / totalRepBackingUnits
}

async function loadSecurityPoolVaultSummaries(
	client: ReadClient,
	securityPoolAddress: Address,
	options: {
		accountAddress?: Address
		previewLimit?: bigint
	} = {},
): Promise<{
	hasLoadedVaults: boolean
	vaultScanCapped: boolean
	vaultCount: bigint
	vaults: ListedSecurityPool['vaults']
}> {
	const blockNumber = await client.getBlockNumber()
	const vaultCount = await getSecurityPoolVaultCount(client, securityPoolAddress, blockNumber)
	const previewLimit = options.previewLimit ?? SECURITY_POOL_LIST_VAULT_PREVIEW_LIMIT
	if (vaultCount === 0n && options.accountAddress === undefined) {
		return {
			hasLoadedVaults: true,
			vaultScanCapped: false,
			vaultCount,
			vaults: [],
		}
	}
	const poolRepBackingTotalsPromise = Promise.all([
		client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'getTotalPoolHeldAttoRep',
			address: securityPoolAddress,
			args: [],
			blockNumber,
		}),
		client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'totalRepBackingUnits',
			address: securityPoolAddress,
			args: [],
			blockNumber,
		}),
	])
	const loadCurrentVaultSummaries = async (vaultAddresses: Address[]) => {
		const securityVaultSummaryContracts: ContractFunctionParameters[] = vaultAddresses.map(vaultAddress => ({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'securityVaults',
			address: securityPoolAddress,
			args: [vaultAddress],
		}))
		const vaultOpenInterestContracts: ContractFunctionParameters[] = vaultAddresses.map(vaultAddress => ({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'getVaultOpenInterestAttoEth',
			address: securityPoolAddress,
			args: [vaultAddress],
		}))
		const vaultBadDebtContracts: ContractFunctionParameters[] = vaultAddresses.map(vaultAddress => ({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'vaultBadDebtAttoEth',
			address: securityPoolAddress,
			args: [vaultAddress],
		}))
		const [vaultData, vaultOpenInterest, vaultBadDebt, [totalPoolHeldRepBalanceAttoRep, totalRepBackingUnits], escalationVaultData] = await Promise.all([
			readRequiredMulticall(client, securityVaultSummaryContracts, blockNumber).then(result => requireSecurityVaultTupleArray(result, 'security vault tuple')),
			readRequiredMulticall(client, vaultOpenInterestContracts, blockNumber),
			readRequiredMulticall(client, vaultBadDebtContracts, blockNumber),
			poolRepBackingTotalsPromise,
			loadEscalationVaultData(client, securityPoolAddress, vaultAddresses, blockNumber),
		])
		return vaultAddresses.flatMap((vaultAddress, index) => {
			const currentVaultData = vaultData[index]
			if (currentVaultData === undefined) throw new Error('Unexpected vault data response')
			const currentEscalationData = escalationVaultData[index]
			if (currentEscalationData === undefined) throw new Error('Unexpected escalation vault response')
			const badDebtAttoEth = vaultBadDebt[index]
			if (typeof badDebtAttoEth !== 'bigint') throw new Error('Unexpected vault bad debt response')
			const openInterestAttoEth = vaultOpenInterest[index]
			if (typeof openInterestAttoEth !== 'bigint') throw new Error('Unexpected vault open interest response')
			if (!hasCurrentSecurityVaultState(currentVaultData) && currentEscalationData.disputeStakedAttoRep === 0n && badDebtAttoEth === 0n && openInterestAttoEth === 0n) return []
			const [repBackingUnits, capacityOwnershipAttoRep, claimableFeesAttoEth] = currentVaultData
			return [
				{
					badDebtAttoEth,
					openInterestAttoEth,
					disputeStakedAttoRep: currentEscalationData.disputeStakedAttoRep,
					repBackingUnits,
					totalRepBackingUnits,
					vaultAttoRepBacking: getVaultRepBackingAttoRepFromRepBackingUnits({
						repBackingUnits,
						totalRepBackingUnits,
						totalPoolHeldRepBalanceAttoRep,
					}),
					capacityOwnershipAttoRep,
					totalPoolHeldRepBalanceAttoRep,
					claimableFeesAttoEth,
					vaultAddress,
				},
			]
		})
	}

	const vaults: ListedSecurityPool['vaults'] = []
	const scannedVaultAddresses: Address[] = []
	let separatelyLoadedAccountVaults: ListedSecurityPool['vaults'] | undefined
	let registryOffset = 0n
	while (registryOffset < vaultCount && registryOffset < SECURITY_POOL_VAULT_SCAN_LIMIT && BigInt(vaults.length) < previewLimit) {
		const remainingVaultCount = vaultCount - registryOffset
		const remainingScanCount = SECURITY_POOL_VAULT_SCAN_LIMIT - registryOffset
		let pageSize = SECURITY_POOL_VAULT_SCAN_PAGE_SIZE
		if (remainingVaultCount < pageSize) pageSize = remainingVaultCount
		if (remainingScanCount < pageSize) pageSize = remainingScanCount
		const pageVaultAddresses = await getSecurityPoolVaults(client, securityPoolAddress, registryOffset, pageSize, blockNumber)
		scannedVaultAddresses.push(...pageVaultAddresses)
		const summaryVaultAddresses = [...pageVaultAddresses]
		const shouldLoadAccountWithFirstPage = registryOffset === 0n && options.accountAddress !== undefined && !pageVaultAddresses.some(vaultAddress => sameAddress(vaultAddress, options.accountAddress))
		if (shouldLoadAccountWithFirstPage && options.accountAddress !== undefined) summaryVaultAddresses.push(options.accountAddress)
		const currentPageVaults = await loadCurrentVaultSummaries(summaryVaultAddresses)
		for (const vault of currentPageVaults) {
			if (options.accountAddress !== undefined && sameAddress(vault.vaultAddress, options.accountAddress) && (shouldLoadAccountWithFirstPage || separatelyLoadedAccountVaults !== undefined || BigInt(vaults.length) >= previewLimit)) {
				separatelyLoadedAccountVaults = [vault]
				continue
			}
			if (BigInt(vaults.length) >= previewLimit) continue
			vaults.push(vault)
		}
		registryOffset += pageSize
	}
	if (options.accountAddress !== undefined && !vaults.some(vault => sameAddress(vault.vaultAddress, options.accountAddress))) {
		if (separatelyLoadedAccountVaults === undefined && !scannedVaultAddresses.some(vaultAddress => sameAddress(vaultAddress, options.accountAddress))) {
			separatelyLoadedAccountVaults = await loadCurrentVaultSummaries([options.accountAddress])
		}
		if (separatelyLoadedAccountVaults !== undefined) vaults.push(...separatelyLoadedAccountVaults)
	}
	return {
		hasLoadedVaults: true,
		vaultScanCapped: registryOffset < vaultCount && BigInt(vaults.length) < previewLimit,
		vaultCount,
		vaults,
	}
}

export async function loadSecurityPoolVaultSummary(client: ReadClient, securityPoolAddress: Address, vaultAddress: Address): Promise<SecurityPoolVaultSummary> {
	const { vaults } = await loadSecurityPoolVaultSummaries(client, securityPoolAddress, {
		accountAddress: vaultAddress,
		previewLimit: 0n,
	})
	return (
		vaults.find(vault => sameAddress(vault.vaultAddress, vaultAddress)) ?? {
			badDebtAttoEth: 0n,
			openInterestAttoEth: 0n,
			disputeStakedAttoRep: 0n,
			vaultAttoRepBacking: 0n,
			capacityOwnershipAttoRep: 0n,
			claimableFeesAttoEth: 0n,
			vaultAddress,
		}
	)
}

function shouldLoadSecurityPoolVaults(
	deployment: Pick<SecurityPoolDeploymentTuple, 'parent' | 'securityPool'>,
	options: {
		selectedSecurityPoolAddress?: Address | string
		vaultDetailMode: 'all' | 'selected'
	},
) {
	if (options.vaultDetailMode === 'all') return true
	if (options.selectedSecurityPoolAddress === undefined) return false
	return sameAddress(deployment.securityPool, options.selectedSecurityPoolAddress) || sameAddress(deployment.parent, options.selectedSecurityPoolAddress)
}

function createDeferredSecurityPoolVaultSummary(vaultCount: bigint) {
	return {
		hasLoadedVaults: vaultCount === 0n,
		vaultScanCapped: false,
		vaultCount,
		vaults: [] as ListedSecurityPool['vaults'],
	}
}

async function loadSecurityPoolDetails(
	client: ReadClient,
	deployment: SecurityPoolDeploymentTuple,
	options: {
		accountAddress?: Address
		selectedSecurityPoolAddress?: Address | string
		vaultDetailMode: 'all' | 'selected'
		vaultPreviewLimit: bigint
	},
): Promise<ListedSecurityPool> {
	const { initialReportPriorityFeeAttoEthPerGas, parent, priceOracleManagerAndOperatorQueuer: managerAddress, questionId, statoblastSecurityMultiplierBps, securityPool: securityPoolAddress, truthAuction: truthAuctionAddress, universeId } = deployment
	const shouldLoadVaults = shouldLoadSecurityPoolVaults(deployment, options)
	const [
		[
			settlementCollateralAttoEth,
			currentRetentionRate,
			minimumSecurityBondDebtAttoEth,
			minimumVaultRepDepositAttoRep,
			forkData,
			lastOraclePrice,
			lastSettlementTimestamp,
			questionOutcome,
			systemStateValue,
			shareTokenSupplyAttoShares,
			totalPoolHeldAttoRep,
			poolAccountingSnapshot,
			universeForkTime,
			escalationGameAddress,
			feeEndTimestamp,
		],
		marketDetails,
		vaultSummaries,
	] = await Promise.all([
		readRequiredMulticall(client, [
			{
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'settlementCollateralAttoEth',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'currentRetentionRate',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'minimumSecurityBondDebtAttoEth',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'minimumVaultRepDepositAttoRep',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'forkData',
				address: getInfraContractAddresses().securityPoolForker,
				args: [securityPoolAddress],
			},
			{
				abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'lastPrice',
				address: managerAddress,
				args: [],
			},
			{
				abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'lastSettlementTimestamp',
				address: managerAddress,
				args: [],
			},
			{
				abi: SECURITY_POOL_QUESTION_OUTCOME_ABI,
				functionName: 'getQuestionOutcome',
				address: getInfraContractAddresses().securityPoolForker,
				args: [securityPoolAddress],
			},
			{
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'systemState',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'shareTokenSupplyAttoShares',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'getTotalPoolHeldAttoRep',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'getPoolAccountingSnapshot',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: Zoltar_Zoltar.abi,
				functionName: 'getForkTime',
				address: getInfraContractAddresses().zoltar,
				args: [universeId],
			},
			{
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'escalationGame',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'getFeeEpochEndTime',
				address: securityPoolAddress,
				args: [],
			},
		]),
		loadMarketDetails(client, questionId),
		shouldLoadVaults
			? loadSecurityPoolVaultSummaries(client, securityPoolAddress, {
					...(options.accountAddress === undefined ? {} : { accountAddress: options.accountAddress }),
					previewLimit: options.vaultPreviewLimit,
				})
			: getSecurityPoolVaultCount(client, securityPoolAddress).then(createDeferredSecurityPoolVaultSummary),
	])
	const hasForkContinuationEscalationGame = sameAddress(escalationGameAddress, zeroAddress)
		? false
		: await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				functionName: 'forkContinuation',
				address: escalationGameAddress,
				args: [],
			})
	const ordinaryEscalationGameStarted = !sameAddress(escalationGameAddress, zeroAddress) && !hasForkContinuationEscalationGame
	const { truthAuctionStartedAt, migratedAttoRep, forkOwnSecurityPool, forkOutcomeIndex } = requireForkDataView(forkData)
	const forkOutcome = getForkOutcomeKey(forkOutcomeIndex, parent)
	const systemState = getSecurityPoolSystemState(systemStateValue)
	return {
		settlementCollateralAttoEth,
		currentRetentionRate,
		feeAccrualState: {
			feeEndTimestamp,
			feeIndexRemainder: poolAccountingSnapshot.feeIndexRemainder,
			lastUpdatedFeeAccumulator: poolAccountingSnapshot.lastUpdatedFeeAccumulator,
			totalFeesOwedRemainder: poolAccountingSnapshot.totalFeesOwedRemainder,
		},
		feeEligibleCapacityOwnershipAttoRep: poolAccountingSnapshot.feeEligibleCapacityOwnershipAttoRep,
		forkOutcome,
		forkOwnSecurityPool,
		hasForkActivity: deriveHasForkActivity({
			forkOutcome,
			migratedAttoRep,
			systemState,
			truthAuctionStartedAt,
		}),
		hasForkContinuationEscalationGame,
		initialReportPriorityFeeAttoEthPerGas,
		lastOraclePrice: lastSettlementTimestamp > 0n ? lastOraclePrice : undefined,
		lastOracleSettlementTimestamp: lastSettlementTimestamp,
		managerAddress,
		minimumSecurityBondDebtAttoEth,
		minimumVaultRepDepositAttoRep,
		ordinaryEscalationGameStarted,
		marketDetails,
		migratedAttoRep,
		parent,
		questionOutcome: getReportingOutcomeKey(questionOutcome),
		questionId: getQuestionIdHex(questionId),
		statoblastSecurityMultiplierBps,
		securityPoolAddress,
		shareTokenSupplyAttoShares,
		systemState,
		totalPoolHeldAttoRep,
		totalCapacityOwnershipAttoRep: poolAccountingSnapshot.totalCapacityOwnershipAttoRep,
		truthAuctionAddress,
		truthAuctionStartedAt,
		universeHasForked: universeForkTime > 0n,
		universeId,
		hasLoadedVaults: vaultSummaries.hasLoadedVaults,
		vaultScanCapped: vaultSummaries.vaultScanCapped,
		vaultCount: vaultSummaries.vaultCount,
		vaults: vaultSummaries.vaults,
	}
}

async function loadSecurityPoolDeployments(client: ReadClient, startIndex: bigint, count: bigint, blockNumber?: bigint) {
	if (count === 0n) return [] as readonly SecurityPoolDeploymentTuple[]
	return requireSecurityPoolDeploymentTupleArray(
		await client.readContract({
			address: getInfraContractAddresses().securityPoolFactory,
			abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'securityPoolDeploymentsRange',
			args: [startIndex, count],
			blockNumber,
		}),
		'security pool deployments range',
	)
}

async function loadListedSecurityPools(
	client: ReadClient,
	deployments: readonly SecurityPoolDeploymentTuple[],
	options: {
		accountAddress?: Address
		selectedSecurityPoolAddress?: Address | string
		vaultDetailMode: 'all' | 'selected'
		vaultPreviewLimit: bigint
	},
) {
	return await Promise.all(deployments.map(async deployment => await loadSecurityPoolDetails(client, deployment, options)))
}

type DeploymentRegistryAnchor = Readonly<{ blockHash: `0x${string}`; blockNumber: bigint }>

async function loadDeploymentRegistryAnchor(client: ReadClient): Promise<DeploymentRegistryAnchor> {
	const block = await client.getBlock()
	if (block.hash === undefined || block.number === undefined) throw new Error('Security pool deployment head is missing its canonical identity')
	return { blockHash: block.hash, blockNumber: block.number }
}

async function requireDeploymentRegistryAnchor(client: ReadClient, anchor: DeploymentRegistryAnchor) {
	const block = await client.getBlock({ blockNumber: anchor.blockNumber })
	if (block.hash?.toLowerCase() !== anchor.blockHash.toLowerCase()) throw new Error('Security pool deployments changed during discovery')
}

function uniqueDeployments(deployments: readonly SecurityPoolDeploymentTuple[]) {
	return [...new Map(deployments.map(deployment => [deployment.securityPool.toLowerCase(), deployment])).values()]
}

async function loadDeploymentRegistry(client: ReadClient, anchor: DeploymentRegistryAnchor) {
	const deploymentCount = await client.readContract({
		address: getInfraContractAddresses().securityPoolFactory,
		abi: securityPoolFactoryAbi,
		functionName: 'securityPoolDeploymentCount',
		args: [],
		blockNumber: anchor.blockNumber,
	})
	const deployments: SecurityPoolDeploymentTuple[] = []
	for (let startIndex = 0n; startIndex < deploymentCount; startIndex += 100n) {
		const count = deploymentCount - startIndex < 100n ? deploymentCount - startIndex : 100n
		deployments.push(...(await loadSecurityPoolDeployments(client, startIndex, count, anchor.blockNumber)))
	}
	return deployments
}

export async function loadSecurityPoolLineage(client: ReadClient, securityPoolAddress: Address, accountAddress?: Address) {
	const { anchor, deployments } = await readWithRpcStateRetries(
		async () => {
			const anchor = await loadDeploymentRegistryAnchor(client)
			const deployments = await loadDeploymentRegistry(client, anchor)
			await requireDeploymentRegistryAnchor(client, anchor)
			return { anchor, deployments }
		},
		({ deployments }) => deployments.some(deployment => sameAddress(deployment.securityPool, securityPoolAddress)),
	)
	const selected = deployments.filter(deployment => sameAddress(deployment.securityPool, securityPoolAddress))
	const selectedDeployment = selected[0]
	if (selectedDeployment === undefined) {
		await requireDeploymentRegistryAnchor(client, anchor)
		return []
	}
	const children = deployments.filter(deployment => sameAddress(deployment.parent, securityPoolAddress))
	const parent = deployments.filter(deployment => sameAddress(deployment.securityPool, selectedDeployment.parent))
	const pools = await loadListedSecurityPools(client, uniqueDeployments([...parent, ...selected, ...children]), {
		...(accountAddress === undefined ? {} : { accountAddress }),
		selectedSecurityPoolAddress: securityPoolAddress,
		vaultDetailMode: 'selected',
		vaultPreviewLimit: SECURITY_POOL_LIST_VAULT_PREVIEW_LIMIT,
	})
	await requireDeploymentRegistryAnchor(client, anchor)
	return applyChildForkActivityHints(pools)
}

export async function loadSecurityPoolChildren(client: ReadClient, parentAddress: Address, accountAddress?: Address) {
	const anchor = await loadDeploymentRegistryAnchor(client)
	const deployments = (await loadDeploymentRegistry(client, anchor)).filter(deployment => sameAddress(deployment.parent, parentAddress))
	const pools = await loadListedSecurityPools(client, deployments, {
		...(accountAddress === undefined ? {} : { accountAddress }),
		selectedSecurityPoolAddress: parentAddress,
		vaultDetailMode: 'selected',
		vaultPreviewLimit: SECURITY_POOL_LIST_VAULT_PREVIEW_LIMIT,
	})
	await requireDeploymentRegistryAnchor(client, anchor)
	return pools
}

function applyChildForkActivityHints(pools: ListedSecurityPool[]) {
	return pools.map(pool => {
		if (pool.hasForkActivity) return pool
		if (!pools.some(candidate => sameAddress(candidate.parent, pool.securityPoolAddress))) return pool
		return {
			...pool,
			hasForkActivity: true,
		}
	})
}

export async function loadAllSecurityPools(client: ReadClient, options: LoadAllSecurityPoolsOptions = {}): Promise<ListedSecurityPool[]> {
	const deploymentCount = await client.readContract({
		address: getInfraContractAddresses().securityPoolFactory,
		abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'securityPoolDeploymentCount',
		args: [],
	})
	const deployments = await loadSecurityPoolDeployments(client, 0n, deploymentCount)
	const pools = await loadListedSecurityPools(client, deployments, {
		...(options.accountAddress === undefined ? {} : { accountAddress: options.accountAddress }),
		...(options.selectedSecurityPoolAddress === undefined ? {} : { selectedSecurityPoolAddress: options.selectedSecurityPoolAddress }),
		vaultDetailMode: options.vaultDetailMode ?? 'all',
		vaultPreviewLimit: SECURITY_POOL_LIST_VAULT_PREVIEW_LIMIT,
	})
	return applyChildForkActivityHints(pools)
}

export async function loadSecurityPoolPage(client: ReadClient, pageIndex: number, pageSize: number, accountAddress?: Address): Promise<SecurityPoolPage> {
	const startIndex = getProtocolPageOffset(pageIndex, pageSize)
	const poolCount = await client.readContract({
		address: getInfraContractAddresses().securityPoolFactory,
		abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'securityPoolDeploymentCount',
		args: [],
	})
	if (startIndex >= poolCount) {
		return {
			pageIndex,
			pageSize,
			poolCount,
			pools: [],
		}
	}
	const count = poolCount - startIndex < BigInt(pageSize) ? poolCount - startIndex : BigInt(pageSize)
	const deployments = await loadSecurityPoolDeployments(client, startIndex, count)
	const pools = await loadListedSecurityPools(client, deployments, {
		...(accountAddress === undefined ? {} : { accountAddress }),
		vaultDetailMode: 'all',
		vaultPreviewLimit: SECURITY_POOL_PAGE_VAULT_PREVIEW_LIMIT,
	})
	return {
		pageIndex,
		pageSize,
		poolCount,
		pools,
	}
}

export async function loadSecurityVaultDetails(client: ReadClient, securityPoolAddress: Address, vaultAddress: Address): Promise<SecurityVaultDetails | undefined> {
	if (!(await securityPoolExists(client, securityPoolAddress))) return undefined

	const [
		badDebtAttoEth,
		currentRetentionRate,
		managerAddress,
		minimumSecurityBondDebtAttoEth,
		minimumVaultRepDepositAttoRep,
		totalRepBackingUnits,
		repToken,
		totalPoolHeldRepBalanceAttoRep,
		totalCapacityOwnershipAttoRep,
		universeId,
		vaultData,
		disputeStakedRepByVaultAttoRep,
		openInterestAttoEth,
		capacityBackingFactorsBps,
		statoblastSecurityMultiplierBps,
		targetBackingFactorBps,
		settlementCollateralAttoEth,
	] = await Promise.all([
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'vaultBadDebtAttoEth', address: securityPoolAddress, args: [vaultAddress] }),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'currentRetentionRate', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'priceOracleManagerAndOperatorQueuer', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'minimumSecurityBondDebtAttoEth', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'minimumVaultRepDepositAttoRep', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'totalRepBackingUnits', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'repToken', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'getTotalPoolHeldAttoRep', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'totalCapacityOwnershipAttoRep', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'universeId', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'securityVaults', address: securityPoolAddress, args: [vaultAddress] }),
		loadEscalationVaultData(client, securityPoolAddress, [vaultAddress]).then(values => values[0]?.disputeStakedAttoRep ?? 0n),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'getVaultOpenInterestAttoEth', address: securityPoolAddress, args: [vaultAddress] }),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'getVaultCapacityBackingFactorsBps', address: securityPoolAddress, args: [vaultAddress] }),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'statoblastSecurityMultiplierBps', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'vaultTargetBackingFactorBps', address: securityPoolAddress, args: [vaultAddress] }),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'settlementCollateralAttoEth', address: securityPoolAddress, args: [] }),
	])
	const repTokenSymbol = await client.readContract({ abi: ReputationToken_ReputationToken.abi, functionName: 'symbol', address: repToken, args: [] })

	const [repBackingUnits, capacityOwnershipAttoRep, claimableFeesAttoEth] = vaultData
	const vaultAttoRepBacking = getVaultRepBackingAttoRepFromRepBackingUnits({
		repBackingUnits,
		totalRepBackingUnits,
		totalPoolHeldRepBalanceAttoRep,
	})

	return {
		statoblastSecurityMultiplierBps,
		targetBackingFactorBps,
		settlementCollateralAttoEth,
		associatedRepPerCapacityBps: capacityBackingFactorsBps[0],
		badDebtAttoEth,
		currentRetentionRate,
		disputeStakedAttoRep: disputeStakedRepByVaultAttoRep,
		managerAddress,
		minimumSecurityBondDebtAttoEth,
		minimumVaultRepDepositAttoRep,
		openInterestAttoEth,
		poolHeldRepPerCapacityBps: capacityBackingFactorsBps[1],
		totalRepBackingUnits,
		vaultAttoRepBacking,
		repToken,
		repTokenSymbol,
		capacityOwnershipAttoRep,
		securityPoolAddress,
		totalCapacityOwnershipAttoRep,
		claimableFeesAttoEth,
		universeId,
		vaultAddress,
	}
}
