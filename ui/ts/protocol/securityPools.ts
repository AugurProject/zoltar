import { decodeEventLog, encodeAbiParameters, encodeDeployData, getCreate2Address, keccak256, zeroAddress, type Address, type ContractFunctionParameters, type TransactionReceipt } from '@zoltar/shared/ethereum'
import {
	peripherals_EscalationGame_EscalationGame,
	peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	peripherals_SecurityPool_SecurityPool,
	peripherals_SecurityPoolForker_SecurityPoolForker,
	peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
	peripherals_tokens_ShareToken_ShareToken,
	Zoltar_Zoltar,
} from '../contractArtifact.js'
import { isIgnorableLogDecodeError } from '../lib/errors.js'
import { deriveHasForkActivity } from './forkActivity.js'
import { sameAddress } from '../lib/address.js'
import type { ListedSecurityPool, SecurityPoolCreationResult, SecurityPoolPage, SecurityPoolVaultSummary, SecurityVaultDetails, WriteClient, ReadClient } from '../types/contracts.js'
import { readRequiredMulticall, writeContractAndWaitForReceipt } from './core.js'
import { requireForkDataView } from './forkData.js'
import { getForkOutcomeKey, getProtocolPageOffset, getQuestionIdHex, getReportingOutcomeKey, getSecurityPoolSystemState, requireSecurityPoolDeploymentTupleArray, requireSecurityVaultTupleArray } from './helpers.js'
import { getDeploymentSteps } from './deployment.js'
import { getInfraContractAddresses, getZoltarAddress } from './deploymentHelpers.js'
import { loadMarketDetails } from './zoltar.js'

const QUESTION_OUTCOME_ABI = [
	{
		inputs: [{ name: 'securityPool', type: 'address' }],
		name: 'getQuestionOutcome',
		outputs: [{ name: 'outcome', type: 'uint8' }],
		stateMutability: 'view',
		type: 'function',
	},
] as const

const SECURITY_POOL_LIST_VAULT_PREVIEW_LIMIT = 50n
const SECURITY_POOL_PAGE_VAULT_PREVIEW_LIMIT = 3n
const SECURITY_POOL_VAULT_SCAN_LIMIT = 500n
const SECURITY_POOL_VAULT_SCAN_PAGE_SIZE = 50n

export type LoadAllSecurityPoolsOptions = {
	accountAddress?: Address
	selectedSecurityPoolAddress?: Address | string
	vaultDetailMode?: 'all' | 'selected'
}

type SecurityPoolDeploymentQueryResult = {
	initialReportPriorityFeeAttoEthPerGas: bigint
	parent: Address
	priceOracleManagerAndOperatorQueuer: Address
	questionId: bigint
	statoblastSecurityMultiplierBps: bigint
	securityPool: Address
	truthAuction: Address
	universeId: bigint
}

function getDeploymentStepAddress(id: 'securityPoolFactory' | 'zoltarQuestionData') {
	const step = getDeploymentSteps().find(candidate => candidate.id === id)
	if (step === undefined) throw new Error(`Unknown deployment step: ${id}`)
	return step.address
}

function getSecurityPoolAddressFromReceipt(receipt: TransactionReceipt) {
	const securityPoolFactory = getInfraContractAddresses().securityPoolFactory
	for (const log of receipt.logs) {
		if (!sameAddress(log.address, securityPoolFactory)) continue
		try {
			const decodedLog = decodeEventLog({
				abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
				data: log.data,
				topics: log.topics,
			})
			if (decodedLog.eventName !== 'DeploySecurityPool') continue
			const securityPoolAddress = decodedLog.args.securityPool
			if (securityPoolAddress === undefined) throw new Error('Deployment event missing security pool address')
			return securityPoolAddress
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
			continue
		}
	}

	throw new Error('Security pool deployment transaction succeeded without a DeploySecurityPool event')
}

function getOriginSecurityPoolShareTokenSalt(questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas: bigint) {
	return keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint248' }], [questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas, 0n]))
}

function getOriginSecurityPoolShareTokenAddress(questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas: bigint) {
	return getCreate2Address({
		from: getInfraContractAddresses().shareTokenFactory,
		salt: getOriginSecurityPoolShareTokenSalt(questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas),
		bytecode: encodeDeployData({
			abi: peripherals_tokens_ShareToken_ShareToken.abi,
			bytecode: `0x${peripherals_tokens_ShareToken_ShareToken.evm.bytecode.object}`,
			args: [getInfraContractAddresses().securityPoolFactory, getZoltarAddress(), questionId],
		}),
	})
}

async function securityPoolExists(client: Pick<ReadClient, 'getCode'>, securityPoolAddress: Address) {
	const code = await client.getCode({ address: securityPoolAddress })
	return code !== undefined && code !== '0x'
}

async function getSecurityPoolVaultCount(client: Pick<ReadClient, 'readContract'>, securityPoolAddress: Address, blockNumber?: bigint) {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'getVaultCount',
		address: securityPoolAddress,
		args: [],
		blockNumber,
	})
}

async function getSecurityPoolVaults(client: Pick<ReadClient, 'readContract'>, securityPoolAddress: Address, startIndex: bigint, count: bigint, blockNumber: bigint) {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'getVaults',
		address: securityPoolAddress,
		args: [startIndex, count],
		blockNumber,
	})
}

async function loadEscalationVaultData(client: Pick<ReadClient, 'multicall' | 'readContract'>, securityPoolAddress: Address, vaultAddresses: Address[], blockNumber?: bigint) {
	if (vaultAddresses.length === 0) return []
	const escalationGameAddress = await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'escalationGame',
		address: securityPoolAddress,
		args: [],
		blockNumber,
	})
	if (sameAddress(escalationGameAddress, zeroAddress)) {
		return vaultAddresses.map(() => ({ disputeStakedAttoRep: 0n }))
	}
	const disputeStakeContracts: ContractFunctionParameters[] = vaultAddresses.map(vaultAddress => ({
		abi: peripherals_EscalationGame_EscalationGame.abi,
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
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'getTotalPoolHeldAttoRep',
			address: securityPoolAddress,
			args: [],
			blockNumber,
		}),
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'totalRepBackingUnits',
			address: securityPoolAddress,
			args: [],
			blockNumber,
		}),
	])
	const loadCurrentVaultSummaries = async (vaultAddresses: Address[]) => {
		const securityVaultSummaryContracts: ContractFunctionParameters[] = vaultAddresses.map(vaultAddress => ({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'securityVaults',
			address: securityPoolAddress,
			args: [vaultAddress],
		}))
		const vaultOpenInterestContracts: ContractFunctionParameters[] = vaultAddresses.map(vaultAddress => ({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'getVaultOpenInterestAttoEth',
			address: securityPoolAddress,
			args: [vaultAddress],
		}))
		const vaultBadDebtContracts: ContractFunctionParameters[] = vaultAddresses.map(vaultAddress => ({
			abi: peripherals_SecurityPool_SecurityPool.abi,
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
	deployment: Pick<SecurityPoolDeploymentQueryResult, 'parent' | 'securityPool'>,
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
	deployment: SecurityPoolDeploymentQueryResult,
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
		[settlementCollateralAttoEth, currentRetentionRate, minimumSecurityBondDebtAttoEth, minimumVaultRepDepositAttoRep, forkData, lastOraclePrice, lastSettlementTimestamp, questionOutcome, systemStateValue, shareTokenSupplyAttoShares, totalPoolHeldAttoRep, poolAccountingSnapshot, universeForkTime],
		marketDetails,
		vaultSummaries,
	] = await Promise.all([
		readRequiredMulticall(client, [
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'settlementCollateralAttoEth',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'currentRetentionRate',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'minimumSecurityBondDebtAttoEth',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'minimumVaultRepDepositAttoRep',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'forkData',
				address: getInfraContractAddresses().securityPoolForker,
				args: [securityPoolAddress],
			},
			{
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'lastPrice',
				address: managerAddress,
				args: [],
			},
			{
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'lastSettlementTimestamp',
				address: managerAddress,
				args: [],
			},
			{
				abi: QUESTION_OUTCOME_ABI,
				functionName: 'getQuestionOutcome',
				address: getInfraContractAddresses().securityPoolForker,
				args: [securityPoolAddress],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'systemState',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'shareTokenSupplyAttoShares',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'getTotalPoolHeldAttoRep',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
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
		]),
		loadMarketDetails(client, questionId),
		shouldLoadVaults
			? loadSecurityPoolVaultSummaries(client, securityPoolAddress, {
					...(options.accountAddress === undefined ? {} : { accountAddress: options.accountAddress }),
					previewLimit: options.vaultPreviewLimit,
				})
			: getSecurityPoolVaultCount(client, securityPoolAddress).then(createDeferredSecurityPoolVaultSummary),
	])
	const { truthAuctionStartedAt, migratedAttoRep, forkOwnSecurityPool, forkOutcomeIndex } = requireForkDataView(forkData)
	const forkOutcome = getForkOutcomeKey(forkOutcomeIndex, parent)
	const systemState = getSecurityPoolSystemState(systemStateValue)
	return {
		settlementCollateralAttoEth,
		currentRetentionRate,
		feeEligibleCapacityOwnershipAttoRep: poolAccountingSnapshot.feeEligibleCapacityOwnershipAttoRep,
		forkOutcome,
		forkOwnSecurityPool,
		hasForkActivity: deriveHasForkActivity({
			forkOutcome,
			migratedAttoRep,
			systemState,
			truthAuctionStartedAt,
		}),
		initialReportPriorityFeeAttoEthPerGas,
		lastOraclePrice: lastSettlementTimestamp > 0n ? lastOraclePrice : undefined,
		lastOracleSettlementTimestamp: lastSettlementTimestamp,
		managerAddress,
		minimumSecurityBondDebtAttoEth,
		minimumVaultRepDepositAttoRep,
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

async function loadSecurityPoolDeployments(client: ReadClient, startIndex: bigint, count: bigint) {
	if (count === 0n) return [] as readonly SecurityPoolDeploymentQueryResult[]
	return requireSecurityPoolDeploymentTupleArray(
		await client.readContract({
			address: getInfraContractAddresses().securityPoolFactory,
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'securityPoolDeploymentsRange',
			args: [startIndex, count],
		}),
		'security pool deployments range',
	)
}

async function loadListedSecurityPools(
	client: ReadClient,
	deployments: readonly SecurityPoolDeploymentQueryResult[],
	options: {
		accountAddress?: Address
		selectedSecurityPoolAddress?: Address | string
		vaultDetailMode: 'all' | 'selected'
		vaultPreviewLimit: bigint
	},
) {
	return await Promise.all(deployments.map(async deployment => await loadSecurityPoolDetails(client, deployment, options)))
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
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
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

export async function createSecurityPool(
	client: WriteClient,
	parameters: {
		initialReportPriorityFeeAttoEthPerGas: bigint
		questionId: bigint
		statoblastSecurityMultiplierBps: bigint
	},
) {
	const { hash: deployPoolHash, receipt } = await writeContractAndWaitForReceipt(client, () => ({
		address: getDeploymentStepAddress('securityPoolFactory'),
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'deployOriginSecurityPool',
		args: [0n, parameters.questionId, parameters.statoblastSecurityMultiplierBps, parameters.initialReportPriorityFeeAttoEthPerGas],
	}))

	return {
		deployPoolHash,
		initialReportPriorityFeeAttoEthPerGas: parameters.initialReportPriorityFeeAttoEthPerGas,
		questionId: getQuestionIdHex(parameters.questionId),
		securityPoolAddress: getSecurityPoolAddressFromReceipt(receipt),
		statoblastSecurityMultiplierBps: parameters.statoblastSecurityMultiplierBps,
		universeId: 0n,
	} satisfies SecurityPoolCreationResult
}

export async function originSecurityPoolExists(client: Pick<ReadClient, 'getCode'>, questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas: bigint) {
	const shareTokenAddress = getOriginSecurityPoolShareTokenAddress(questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas)
	const code = await client.getCode({ address: shareTokenAddress })
	return code !== undefined && code !== '0x'
}

export async function loadSecurityPoolPage(client: ReadClient, pageIndex: number, pageSize: number, accountAddress?: Address): Promise<SecurityPoolPage> {
	const startIndex = getProtocolPageOffset(pageIndex, pageSize)
	const poolCount = await client.readContract({
		address: getInfraContractAddresses().securityPoolFactory,
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
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

	const [badDebtAttoEth, currentRetentionRate, managerAddress, minimumSecurityBondDebtAttoEth, minimumVaultRepDepositAttoRep, totalRepBackingUnits, repToken, totalPoolHeldRepBalanceAttoRep, totalCapacityOwnershipAttoRep, universeId, vaultData, disputeStakedRepByVaultAttoRep] = await Promise.all([
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'vaultBadDebtAttoEth', address: securityPoolAddress, args: [vaultAddress] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'currentRetentionRate', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'priceOracleManagerAndOperatorQueuer', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'minimumSecurityBondDebtAttoEth', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'minimumVaultRepDepositAttoRep', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'totalRepBackingUnits', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'repToken', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'getTotalPoolHeldAttoRep', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'totalCapacityOwnershipAttoRep', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'universeId', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'securityVaults', address: securityPoolAddress, args: [vaultAddress] }),
		loadEscalationVaultData(client, securityPoolAddress, [vaultAddress]).then(values => values[0]?.disputeStakedAttoRep ?? 0n),
	])

	const [repBackingUnits, capacityOwnershipAttoRep, claimableFeesAttoEth] = vaultData
	const vaultAttoRepBacking = getVaultRepBackingAttoRepFromRepBackingUnits({
		repBackingUnits,
		totalRepBackingUnits,
		totalPoolHeldRepBalanceAttoRep,
	})

	return {
		badDebtAttoEth,
		currentRetentionRate,
		disputeStakedAttoRep: disputeStakedRepByVaultAttoRep,
		managerAddress,
		minimumSecurityBondDebtAttoEth,
		minimumVaultRepDepositAttoRep,
		totalRepBackingUnits,
		vaultAttoRepBacking,
		repToken,
		capacityOwnershipAttoRep,
		securityPoolAddress,
		totalCapacityOwnershipAttoRep,
		claimableFeesAttoEth,
		universeId,
		vaultAddress,
	}
}
