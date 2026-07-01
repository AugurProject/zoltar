import { decodeEventLog, encodeAbiParameters, encodeDeployData, getCreate2Address, keccak256, zeroAddress, type Address, type TransactionReceipt } from '@zoltar/shared/ethereum'
import {
	peripherals_EscalationGame_EscalationGame,
	peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator,
	peripherals_SecurityPool_SecurityPool,
	peripherals_SecurityPoolForker_SecurityPoolForker,
	peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
	peripherals_tokens_ShareToken_ShareToken,
	Zoltar_Zoltar,
} from '../contractArtifact.js'
import { isIgnorableLogDecodeError } from '../lib/errors.js'
import { deriveHasForkActivity } from '../lib/forkAuction.js'
import { sameAddress } from '../lib/address.js'
import type { ListedSecurityPool, SecurityPoolCreationResult, SecurityPoolPage, SecurityVaultDetails, WriteClient, ReadClient } from '../types/contracts.js'
import { readRequiredMulticall, writeContractAndWaitForReceipt } from './core.js'
import { requireForkDataView } from './forkData.js'
import { getForkOutcomeKey, getQuestionIdHex, getReportingOutcomeKey, getSecurityPoolSystemState, requireSecurityPoolDeploymentTupleArray, requireSecurityVaultTupleArray } from './helpers.js'
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

const ACTIVE_SECURITY_POOL_VAULT_PREVIEW_LIMIT = 3n

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
	for (const log of receipt.logs) {
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
	return keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [securityMultiplier, questionId]))
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
	const previewLimit = options.previewLimit ?? ACTIVE_SECURITY_POOL_VAULT_PREVIEW_LIMIT
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
	const [vaultData, totalRepBalance, poolOwnershipDenominator, escrowedRepByVault] = await Promise.all([
		Promise.all(
			summaryVaultAddresses.map(
				async vaultAddress =>
					await client.readContract({
						abi: peripherals_SecurityPool_SecurityPool.abi,
						functionName: 'securityVaults',
						address: securityPoolAddress,
						args: [vaultAddress],
					}),
			),
		).then(result => requireSecurityVaultTupleArray(result, 'security vault tuple')),
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
					repDepositShare: poolOwnershipDenominator === 0n || poolOwnership === 0n ? 0n : (poolOwnership * totalRepBalance) / poolOwnershipDenominator,
					securityBondAllowance,
					unpaidEthFees,
					vaultAddress,
				},
			]
		}),
	}
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
	if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new Error('Security pool page index must be a non-negative integer')
	if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error('Security pool page size must be a positive integer')
	const poolCount = await client.readContract({
		address: getInfraContractAddresses().securityPoolFactory,
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'securityPoolDeploymentCount',
		args: [],
	})
	const startIndex = BigInt(pageIndex * pageSize)
	if (startIndex >= poolCount) {
		return {
			pageIndex,
			pageSize,
			poolCount,
			pools: [],
		}
	}
	const count = poolCount - startIndex < BigInt(pageSize) ? poolCount - startIndex : BigInt(pageSize)
	const deployments: readonly SecurityPoolDeploymentQueryResult[] = requireSecurityPoolDeploymentTupleArray(
		await client.readContract({
			address: getInfraContractAddresses().securityPoolFactory,
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'securityPoolDeploymentsRange',
			args: [startIndex, count],
		}),
		'security pool deployments range',
	)
	const pools = await Promise.all(
		deployments.map(async deployment => {
			const { parent, priceOracleManagerAndOperatorQueuer: managerAddress, questionId, securityMultiplier, securityPool: securityPoolAddress, truthAuction: truthAuctionAddress, universeId } = deployment
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
				loadSecurityPoolVaultSummaries(client, securityPoolAddress, {
					...(accountAddress === undefined ? {} : { accountAddress }),
					previewLimit: ACTIVE_SECURITY_POOL_VAULT_PREVIEW_LIMIT,
				}),
			])
			const { truthAuctionStartedAt, migratedRep, forkOwnSecurityPool, forkOutcomeIndex } = requireForkDataView(forkData)
			const forkOutcome = getForkOutcomeKey(forkOutcomeIndex, parent)
			const systemState = getSecurityPoolSystemState(systemStateValue)
			const hasForkActivity = deriveHasForkActivity({
				forkOutcome,
				migratedRep,
				systemState,
				truthAuctionStartedAt,
			})
			return {
				completeSetCollateralAmount,
				currentRetentionRate,
				forkOutcome,
				forkOwnSecurityPool,
				hasForkActivity,
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
			} satisfies ListedSecurityPool
		}),
	)
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
	const rawRepDepositShare = poolOwnershipDenominator === 0n || poolOwnership === 0n ? 0n : (poolOwnership * totalRepBalance) / poolOwnershipDenominator
	const repDepositShare = typeof rawRepDepositShare === 'bigint' ? rawRepDepositShare : BigInt(rawRepDepositShare)

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
