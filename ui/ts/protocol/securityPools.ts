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
import type { ListedSecurityPool, SecurityPoolCreationResult, SecurityPoolPage, SecurityVaultDetails, WriteClient, ReadClient } from '../types/contracts.js'
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

export type LoadAllSecurityPoolsOptions = {
	accountAddress?: Address
	selectedSecurityPoolAddress?: Address | string
	vaultDetailMode?: 'all' | 'selected'
}

type SecurityPoolDeploymentQueryResult = {
	parent: Address
	priceOracleManagerAndOperatorQueuer: Address
	questionId: bigint
	securityMultiplier: bigint
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

function getOriginSecurityPoolShareTokenSalt(questionId: bigint, securityMultiplier: bigint) {
	return keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint248' }], [questionId, securityMultiplier, 0n]))
}

function getOriginSecurityPoolShareTokenAddress(questionId: bigint, securityMultiplier: bigint) {
	return getCreate2Address({
		from: getInfraContractAddresses().shareTokenFactory,
		salt: getOriginSecurityPoolShareTokenSalt(questionId, securityMultiplier),
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

async function getSecurityPoolVaultCount(client: Pick<ReadClient, 'readContract'>, securityPoolAddress: Address) {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'getActiveVaultCount',
		address: securityPoolAddress,
		args: [],
	})
}

async function getSecurityPoolVaults(client: Pick<ReadClient, 'readContract'>, securityPoolAddress: Address, startIndex: bigint, count: bigint) {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'getActiveVaults',
		address: securityPoolAddress,
		args: [startIndex, count],
	})
}

async function loadEscrowedRepByVaults(client: Pick<ReadClient, 'readContract'>, securityPoolAddress: Address, vaultAddresses: Address[]) {
	if (vaultAddresses.length === 0) return []
	const escalationGameAddress = await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'escalationGame',
		address: securityPoolAddress,
		args: [],
	})
	if (sameAddress(escalationGameAddress, zeroAddress)) return vaultAddresses.map(() => 0n)
	return await Promise.all(
		vaultAddresses.map(
			async vaultAddress =>
				await client.readContract({
					abi: peripherals_EscalationGame_EscalationGame.abi,
					functionName: 'escrowedRepByVault',
					address: escalationGameAddress,
					args: [vaultAddress],
				}),
		),
	)
}

function isActiveSecurityVaultTuple(vaultData: readonly [bigint, bigint, bigint, bigint] | readonly [bigint, bigint, bigint, bigint, bigint]) {
	const [poolOwnership, securityBondAllowance, unpaidEthFees] = vaultData
	return poolOwnership > 0n || securityBondAllowance > 0n || unpaidEthFees > 0n
}

function getRepDepositShareFromPoolOwnership({ poolOwnership, poolOwnershipDenominator, totalRepBalance }: { poolOwnership: bigint; poolOwnershipDenominator: bigint; totalRepBalance: bigint }) {
	if (poolOwnership === 0n || poolOwnershipDenominator === 0n) return 0n
	return (poolOwnership * totalRepBalance) / poolOwnershipDenominator
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
	vaultCount: bigint
	vaults: ListedSecurityPool['vaults']
}> {
	const vaultCount = await getSecurityPoolVaultCount(client, securityPoolAddress)
	const previewLimit = options.previewLimit ?? SECURITY_POOL_LIST_VAULT_PREVIEW_LIMIT
	const previewCount = vaultCount < previewLimit ? vaultCount : previewLimit
	const previewVaultAddresses = previewCount === 0n ? [] : await getSecurityPoolVaults(client, securityPoolAddress, 0n, previewCount)
	const summaryVaultAddresses = [...previewVaultAddresses]
	if (options.accountAddress !== undefined && !summaryVaultAddresses.some(vaultAddress => sameAddress(vaultAddress, options.accountAddress))) {
		summaryVaultAddresses.push(options.accountAddress)
	}
	if (summaryVaultAddresses.length === 0) {
		return {
			hasLoadedVaults: true,
			vaultCount,
			vaults: [],
		}
	}
	const securityVaultSummaryContracts: ContractFunctionParameters[] = summaryVaultAddresses.map(vaultAddress => ({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'securityVaults',
		address: securityPoolAddress,
		args: [vaultAddress],
	}))
	const [vaultData, totalRepBalance, poolOwnershipDenominator, escrowedRepByVault] = await Promise.all([
		readRequiredMulticall(client, securityVaultSummaryContracts).then(result => requireSecurityVaultTupleArray(result, 'security vault tuple')),
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'getTotalRepBalance',
			address: securityPoolAddress,
			args: [],
		}),
		client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'poolOwnershipDenominator',
			address: securityPoolAddress,
			args: [],
		}),
		loadEscrowedRepByVaults(client, securityPoolAddress, summaryVaultAddresses),
	])
	return {
		hasLoadedVaults: true,
		vaultCount,
		vaults: summaryVaultAddresses.flatMap((vaultAddress, index) => {
			const currentVaultData = vaultData[index]
			if (currentVaultData === undefined) throw new Error('Unexpected vault data response')
			const currentEscrowedRep = escrowedRepByVault[index]
			if (currentEscrowedRep === undefined) throw new Error('Unexpected escrowed REP response')
			if (!previewVaultAddresses.some((currentPreviewAddress: Address) => sameAddress(currentPreviewAddress, vaultAddress)) && !isActiveSecurityVaultTuple(currentVaultData) && currentEscrowedRep === 0n) return []
			const [poolOwnership, securityBondAllowance, unpaidEthFees] = currentVaultData
			return [
				{
					escalationEscrowedRep: currentEscrowedRep,
					repDepositShare: getRepDepositShareFromPoolOwnership({
						poolOwnership,
						poolOwnershipDenominator,
						totalRepBalance,
					}),
					securityBondAllowance,
					unpaidEthFees,
					vaultAddress,
				},
			]
		}),
	}
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
	const { parent, priceOracleManagerAndOperatorQueuer: managerAddress, questionId, securityMultiplier, securityPool: securityPoolAddress, truthAuction: truthAuctionAddress, universeId } = deployment
	const shouldLoadVaults = shouldLoadSecurityPoolVaults(deployment, options)
	const [[completeSetCollateralAmount, currentRetentionRate, forkData, lastOraclePrice, lastSettlementTimestamp, questionOutcome, systemStateValue, shareTokenSupply, totalRepDeposit, totalSecurityBondAllowance, universeForkTime], marketDetails, vaultSummaries] = await Promise.all([
		readRequiredMulticall(client, [
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'completeSetCollateralAmount',
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
				functionName: 'shareTokenSupply',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'getTotalRepBalance',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'totalSecurityBondAllowance',
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
	const { truthAuctionStartedAt, migratedRep, forkOwnSecurityPool, forkOutcomeIndex } = requireForkDataView(forkData)
	const forkOutcome = getForkOutcomeKey(forkOutcomeIndex, parent)
	const systemState = getSecurityPoolSystemState(systemStateValue)
	return {
		completeSetCollateralAmount,
		currentRetentionRate,
		forkOutcome,
		forkOwnSecurityPool,
		hasForkActivity: deriveHasForkActivity({
			forkOutcome,
			migratedRep,
			systemState,
			truthAuctionStartedAt,
		}),
		lastOraclePrice: lastSettlementTimestamp > 0n ? lastOraclePrice : undefined,
		lastOracleSettlementTimestamp: lastSettlementTimestamp,
		managerAddress,
		marketDetails,
		migratedRep,
		parent,
		questionOutcome: getReportingOutcomeKey(questionOutcome),
		questionId: getQuestionIdHex(questionId),
		securityMultiplier,
		securityPoolAddress,
		shareTokenSupply,
		systemState,
		totalRepDeposit,
		totalSecurityBondAllowance,
		truthAuctionAddress,
		truthAuctionStartedAt,
		universeHasForked: universeForkTime > 0n,
		universeId,
		hasLoadedVaults: vaultSummaries.hasLoadedVaults,
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
		questionId: bigint
		securityMultiplier: bigint
	},
) {
	const { hash: deployPoolHash, receipt } = await writeContractAndWaitForReceipt(client, () => ({
		address: getDeploymentStepAddress('securityPoolFactory'),
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'deployOriginSecurityPool',
		args: [0n, parameters.questionId, parameters.securityMultiplier],
	}))

	return {
		deployPoolHash,
		questionId: getQuestionIdHex(parameters.questionId),
		securityPoolAddress: getSecurityPoolAddressFromReceipt(receipt),
		securityMultiplier: parameters.securityMultiplier,
		universeId: 0n,
	} satisfies SecurityPoolCreationResult
}

export async function originSecurityPoolExists(client: Pick<ReadClient, 'getCode'>, questionId: bigint, securityMultiplier: bigint) {
	const shareTokenAddress = getOriginSecurityPoolShareTokenAddress(questionId, securityMultiplier)
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

	const [currentRetentionRate, managerAddress, poolOwnershipDenominator, repToken, totalRepBalance, totalSecurityBondAllowance, universeId, vaultData, escrowedRepByVault] = await Promise.all([
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'currentRetentionRate', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'priceOracleManagerAndOperatorQueuer', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'poolOwnershipDenominator', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'repToken', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'getTotalRepBalance', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'totalSecurityBondAllowance', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'universeId', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'securityVaults', address: securityPoolAddress, args: [vaultAddress] }),
		loadEscrowedRepByVaults(client, securityPoolAddress, [vaultAddress]).then(values => values[0] ?? 0n),
	])

	const [poolOwnership, securityBondAllowance, unpaidEthFees] = vaultData
	const repDepositShare = getRepDepositShareFromPoolOwnership({
		poolOwnership,
		poolOwnershipDenominator,
		totalRepBalance,
	})

	return {
		currentRetentionRate,
		escalationEscrowedRep: escrowedRepByVault,
		managerAddress,
		poolOwnershipDenominator,
		repDepositShare,
		repToken,
		securityBondAllowance,
		securityPoolAddress,
		totalSecurityBondAllowance,
		unpaidEthFees,
		universeId,
		vaultAddress,
	}
}
