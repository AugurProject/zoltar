import { isAddress, parseAbiItem, zeroAddress, type Address } from 'viem'
import {
	peripherals_EscalationGame_EscalationGame,
	peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator,
	peripherals_SecurityPool_SecurityPool,
	peripherals_SecurityPoolForker_SecurityPoolForker,
	peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
	Zoltar_Zoltar,
} from '../contractArtifact.js'
import type { ListedSecurityPool, ReadClient, SecurityPoolVaultSummary } from '../types/contracts.js'
import { sameAddress } from '../lib/address.js'
import { deriveHasForkActivity } from '../lib/forkAuction.js'
import { readRequiredMulticall } from './core.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { requireForkDataView } from './forkData.js'
import { getForkOutcomeKey, getQuestionIdHex, getReportingOutcomeKey, getSecurityPoolSystemState, requireSecurityVaultTupleArray } from './helpers.js'
import { loadMarketDetails } from './zoltar.js'

const QUESTION_OUTCOME_ABI = [parseAbiItem('function getQuestionOutcome(address securityPool) view returns (uint8 outcome)')]

export type SecurityPoolDeploymentQueryResult = {
	parent: Address
	priceOracleManagerAndOperatorQueuer: Address
	questionId: bigint
	securityMultiplier: bigint
	securityPool: Address
	truthAuction: Address
	universeId: bigint
}

function isActiveSecurityVaultTuple(vaultData: readonly [bigint, bigint, bigint, bigint] | readonly [bigint, bigint, bigint, bigint, bigint]) {
	const [poolOwnership, securityBondAllowance, unpaidEthFees] = vaultData
	return poolOwnership > 0n || securityBondAllowance > 0n || unpaidEthFees > 0n
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

export async function loadEscrowedRepByVaults(client: Pick<ReadClient, 'readContract'>, securityPoolAddress: Address, vaultAddresses: Address[]) {
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

async function loadSecurityPoolVaultSummaries(
	client: ReadClient,
	securityPoolAddress: Address,
	options: {
		accountAddress?: Address
		previewLimit: bigint
	},
): Promise<{
	hasLoadedVaults: boolean
	vaultCount: bigint
	vaults: SecurityPoolVaultSummary[]
}> {
	const vaultCount = await getSecurityPoolVaultCount(client, securityPoolAddress)
	const previewCount = vaultCount < options.previewLimit ? vaultCount : options.previewLimit
	const previewVaultAddresses = previewCount === 0n ? [] : await getSecurityPoolVaults(client, securityPoolAddress, 0n, previewCount)
	const summaryVaultAddresses = [...previewVaultAddresses]
	if (options.accountAddress !== undefined && !summaryVaultAddresses.some(vaultAddress => sameAddress(vaultAddress, options.accountAddress))) {
		summaryVaultAddresses.push(options.accountAddress)
	}
	if (summaryVaultAddresses.length === 0) return { hasLoadedVaults: true, vaultCount, vaults: [] }
	const vaultDataContracts: Array<{
		abi: typeof peripherals_SecurityPool_SecurityPool.abi
		address: Address
		args: readonly [Address]
		functionName: 'securityVaults'
	}> = summaryVaultAddresses.map(vaultAddress => ({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		address: securityPoolAddress,
		args: [vaultAddress],
		functionName: 'securityVaults',
	}))
	const [vaultDataResults, totalRepBalance, poolOwnershipDenominator, escrowedRepByVault] = await Promise.all([
		readRequiredMulticall(client, vaultDataContracts),
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
	const vaultData = requireSecurityVaultTupleArray(vaultDataResults, 'security vault tuple')
	return {
		hasLoadedVaults: true,
		vaultCount,
		vaults: summaryVaultAddresses.flatMap((vaultAddress, index) => {
			const currentVaultData = vaultData[index]
			if (currentVaultData === undefined) throw new Error('Unexpected vault data response')
			const currentEscrowedRep = escrowedRepByVault[index]
			if (currentEscrowedRep === undefined) throw new Error('Unexpected escrowed REP response')
			if (!previewVaultAddresses.some(currentPreviewAddress => sameAddress(currentPreviewAddress, vaultAddress)) && !isActiveSecurityVaultTuple(currentVaultData) && currentEscrowedRep === 0n) return []
			const [poolOwnership, securityBondAllowance, unpaidEthFees] = currentVaultData
			return [
				{
					escalationEscrowedRep: currentEscrowedRep,
					repDepositShare: poolOwnershipDenominator === 0n || poolOwnership === 0n ? 0n : (poolOwnership * totalRepBalance) / poolOwnershipDenominator,
					securityBondAllowance,
					unpaidEthFees,
					vaultAddress,
				} satisfies SecurityPoolVaultSummary,
			]
		}),
	}
}

async function loadSecurityPoolVaultCountOnly(client: Pick<ReadClient, 'readContract'>, securityPoolAddress: Address) {
	const vaultCount = await getSecurityPoolVaultCount(client, securityPoolAddress)
	return {
		hasLoadedVaults: vaultCount === 0n,
		vaultCount,
		vaults: [],
	} satisfies Pick<ListedSecurityPool, 'hasLoadedVaults' | 'vaultCount' | 'vaults'>
}

function requireSecurityPoolDeploymentTuple(value: unknown): SecurityPoolDeploymentQueryResult {
	const getAddressField = (fieldValue: unknown) => {
		if (typeof fieldValue !== 'string' || !isAddress(fieldValue)) throw new Error('Unexpected security pool deployment response')
		return fieldValue
	}
	const getBigintField = (fieldValue: unknown) => {
		if (typeof fieldValue !== 'bigint') throw new Error('Unexpected security pool deployment response')
		return fieldValue
	}
	if (Array.isArray(value)) {
		if (value.length < 7) throw new Error('Unexpected security pool deployment response')
		const [parent, priceOracleManagerAndOperatorQueuer, questionId, securityMultiplier, securityPool, truthAuction, universeId] = value
		return {
			parent: getAddressField(parent),
			priceOracleManagerAndOperatorQueuer: getAddressField(priceOracleManagerAndOperatorQueuer),
			questionId: getBigintField(questionId),
			securityMultiplier: getBigintField(securityMultiplier),
			securityPool: getAddressField(securityPool),
			truthAuction: getAddressField(truthAuction),
			universeId: getBigintField(universeId),
		}
	}
	if (typeof value !== 'object' || value === undefined || value === null) throw new Error('Unexpected security pool deployment response')
	return {
		parent: getAddressField(Reflect.get(value, 'parent')),
		priceOracleManagerAndOperatorQueuer: getAddressField(Reflect.get(value, 'priceOracleManagerAndOperatorQueuer')),
		questionId: getBigintField(Reflect.get(value, 'questionId')),
		securityMultiplier: getBigintField(Reflect.get(value, 'securityMultiplier')),
		securityPool: getAddressField(Reflect.get(value, 'securityPool')),
		truthAuction: getAddressField(Reflect.get(value, 'truthAuction')),
		universeId: getBigintField(Reflect.get(value, 'universeId')),
	}
}

function requireSecurityPoolDeploymentTupleArray(value: unknown) {
	if (!Array.isArray(value)) throw new Error('Unexpected security pool deployment response')
	return value.map(requireSecurityPoolDeploymentTuple)
}

export async function loadListedSecurityPool(
	client: ReadClient,
	deployment: SecurityPoolDeploymentQueryResult,
	options: {
		accountAddress?: Address
		loadVaults: boolean
		vaultPreviewLimit: bigint
	},
): Promise<ListedSecurityPool> {
	const { parent, priceOracleManagerAndOperatorQueuer: managerAddress, questionId, securityMultiplier, securityPool: securityPoolAddress, truthAuction: truthAuctionAddress, universeId } = deployment
	const [[completeSetCollateralAmount, currentRetentionRate, forkData, lastOraclePrice, lastSettlementTimestamp, questionOutcome, systemStateValue, shareTokenSupply, totalRepDeposit, totalSecurityBondAllowance, universeForkTime], marketDetails, vaultSummary] = await Promise.all([
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
				abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
				functionName: 'lastPrice',
				address: managerAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
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
		options.loadVaults
			? loadSecurityPoolVaultSummaries(client, securityPoolAddress, {
					...(options.accountAddress === undefined ? {} : { accountAddress: options.accountAddress }),
					previewLimit: options.vaultPreviewLimit,
				})
			: loadSecurityPoolVaultCountOnly(client, securityPoolAddress),
	])
	const { truthAuctionStartedAt, migratedRep, forkOwnSecurityPool, forkOutcomeIndex } = requireForkDataView(forkData)
	const systemState = getSecurityPoolSystemState(systemStateValue)
	const forkOutcome = getForkOutcomeKey(forkOutcomeIndex, parent)
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
		hasLoadedVaults: vaultSummary.hasLoadedVaults,
		vaultCount: vaultSummary.vaultCount,
		vaults: vaultSummary.vaults,
	}
}

export async function loadSecurityPoolDeployments(client: Pick<ReadClient, 'readContract'>, startIndex: bigint, count: bigint) {
	if (count === 0n) return []
	return requireSecurityPoolDeploymentTupleArray(
		await client.readContract({
			address: getInfraContractAddresses().securityPoolFactory,
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'securityPoolDeploymentsRange',
			args: [startIndex, count],
		}),
	)
}
