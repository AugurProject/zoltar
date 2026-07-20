import { zeroAddress, type Address } from '@zoltar/shared/ethereum'
import { ABIS } from '../abis.js'
import { deriveHasForkActivity } from './forkActivity.js'
import { Zoltar_Zoltar, peripherals_SecurityPoolForker_SecurityPoolForker, peripherals_SecurityPool_SecurityPool, peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../contractArtifact.js'
import type { DeploymentStepId, ForkAuctionActionResult, ForkAuctionDetails, ReadClient, ReportingOutcomeKey, TruthAuctionMetrics, WriteClient, ZoltarChildUniverseActionResult, ZoltarForkActionResult, ZoltarMigrationActionResult } from '../types/contracts.js'
import { getForkOutcomeKey, getQuestionIdHex, getReportingOutcomeKey, getReportingOutcomeValue, getSecurityPoolSystemState, hasTimestamp } from './helpers.js'
import { type ContractRevertReasonParams, readRequiredMulticall, writeContractAndWait } from './core.js'
import { getInfraContractAddresses, getZoltarAddress } from './deploymentHelpers.js'
import { requireForkDataView } from './forkData.js'
import { executeForkAuctionAction } from './securityPoolActions.js'
import { getDeploymentSteps } from './deployment.js'
import { loadMarketDetails } from './zoltar.js'

const MIGRATION_TIME_LENGTH = 4838400n
const TRUTH_AUCTION_TIME_LENGTH = 604800n
const QUESTION_OUTCOME_ABI = [
	{
		inputs: [{ name: 'securityPool', type: 'address' }],
		name: 'getQuestionOutcome',
		outputs: [{ name: 'outcome', type: 'uint8' }],
		stateMutability: 'view',
		type: 'function',
	},
] as const
type AuctionClearingTuple = readonly [boolean, bigint, bigint, bigint]
function getDeploymentStep(id: DeploymentStepId) {
	const step = getDeploymentSteps().find(candidate => candidate.id === id)
	if (step === undefined) throw new Error(`Unknown deployment step: ${id}`)
	return step
}
export async function loadForkOutcomeMigrationSeedStatus(
	client: Pick<ReadClient, 'readContract'>,
	{
		childSecurityPoolAddress,
		outcome,
		securityPoolAddress,
		universeId,
	}: {
		childSecurityPoolAddress?: Address | undefined
		outcome: ReportingOutcomeKey
		securityPoolAddress: Address
		universeId: bigint
	},
) {
	const childUniverseId = await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'getChildUniverseId',
		address: getZoltarAddress(),
		args: [universeId, BigInt(getReportingOutcomeValue(outcome))],
	})
	const migrationProxyAddress = await client.readContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'getMigrationProxyAddress',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress],
	})
	const childRepToken = await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'getRepToken',
		address: getZoltarAddress(),
		args: [childUniverseId],
	})
	if (childRepToken === zeroAddress) {
		return {
			childPoolRepBalance: 0n,
			childRepToken: undefined,
			childUniverseId,
			migrationProxyAddress,
			pendingProxyRepBalance: 0n,
			seeded: false,
		}
	}
	const pendingProxyRepBalance = await client.readContract({
		abi: ABIS.mainnet.erc20,
		functionName: 'balanceOf',
		address: childRepToken,
		args: [migrationProxyAddress],
	})
	const childPoolRepBalance =
		childSecurityPoolAddress === undefined
			? 0n
			: await client.readContract({
					abi: ABIS.mainnet.erc20,
					functionName: 'balanceOf',
					address: childRepToken,
					args: [childSecurityPoolAddress],
				})

	return {
		childPoolRepBalance,
		childRepToken,
		childUniverseId,
		migrationProxyAddress,
		pendingProxyRepBalance,
		seeded: pendingProxyRepBalance > 0n || childPoolRepBalance > 0n,
	}
}

export async function loadForkAuctionDetails(client: ReadClient, securityPoolAddress: Address): Promise<ForkAuctionDetails> {
	const [[questionId, parentSecurityPoolAddress, universeId, systemStateValue, truthAuctionAddress, completeSetCollateralAmount, forkData, questionOutcome], ownForkMigrationStatusTuple, block] = await Promise.all([
		readRequiredMulticall(client, [
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'questionId',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'parent',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'universeId',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'systemState',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'truthAuction',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'completeSetCollateralAmount',
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
				abi: QUESTION_OUTCOME_ABI,
				functionName: 'getQuestionOutcome',
				address: getInfraContractAddresses().securityPoolForker,
				args: [securityPoolAddress],
			},
		]),
		client.readContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getOwnForkMigrationStatus',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
		client.getBlock(),
	])
	if (!hasTimestamp(block)) throw new Error('Unexpected block response')
	const marketDetails = await loadMarketDetails(client, questionId)
	const { auctionableRepAtFork, truthAuctionStartedAt, migratedRep, auctionedSecurityBondAllowance, forkOwnSecurityPool, forkOutcomeIndex } = requireForkDataView(forkData)
	const [ownForkMigrationOwnFork, ownForkMigrationAuctionableRepAtFork, vaultRepAtFork, escalationChildRepPerSelectedOutcome, escrowSourceRepAtFork] = ownForkMigrationStatusTuple
	const systemState = getSecurityPoolSystemState(systemStateValue)
	const forkOutcome = getForkOutcomeKey(forkOutcomeIndex, parentSecurityPoolAddress)
	const hasForkActivity = deriveHasForkActivity({
		forkOutcome,
		migratedRep,
		systemState,
		truthAuctionStartedAt,
	})
	const universeForkTime = (
		await readRequiredMulticall(client, [
			{
				abi: Zoltar_Zoltar.abi,
				functionName: 'getForkTime',
				address: getInfraContractAddresses().zoltar,
				args: [universeId],
			},
		])
	)[0]
	const migrationEndsAt = universeForkTime === 0n ? undefined : universeForkTime + MIGRATION_TIME_LENGTH
	let truthAuction: TruthAuctionMetrics | undefined
	if (truthAuctionAddress !== zeroAddress && truthAuctionStartedAt > 0n) {
		const [computeClearingResult, ethRaiseCap, ethRaised, finalized, maxRepBeingSold, minBidSize, totalRepPurchased, underfunded, underfundedThreshold, underfundedWinningEth, storedClearingTick] = await readRequiredMulticall(client, [
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'computeClearing',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'ethRaiseCap',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'ethRaised',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'finalized',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'maxRepBeingSold',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'minBidSize',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'totalRepPurchased',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'underfunded',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'underfundedThreshold',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'underfundedWinningEth',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'clearingTick',
				address: truthAuctionAddress,
				args: [],
			},
		])
		const computeClearingTuple: AuctionClearingTuple = computeClearingResult
		const [hitCap, computedClearingTick, accumulatedEth, ethAtClearingTick] = computeClearingTuple
		const clearingTick = finalized ? storedClearingTick : computedClearingTick
		let clearingPrice: bigint | undefined
		if (underfunded) {
			clearingPrice = underfundedWinningEth > 0n ? underfundedThreshold : undefined
		} else if (!(clearingTick === 0n && accumulatedEth === 0n)) {
			clearingPrice = await client.readContract({
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'tickToPrice',
				address: truthAuctionAddress,
				args: [clearingTick],
			})
		}
		truthAuction = {
			accumulatedEth,
			auctionEndsAt: truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH,
			clearingPrice,
			clearingTick,
			ethAtClearingTick,
			ethRaiseCap,
			ethRaised,
			finalized,
			hitCap,
			maxRepBeingSold,
			minBidSize,
			repPurchasableAtBid: clearingPrice === undefined || clearingPrice === 0n ? undefined : (ethRaiseCap * 10n ** 18n) / clearingPrice,
			timeRemaining: finalized || block.timestamp >= truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH ? 0n : truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH - block.timestamp,
			totalRepPurchased,
			underfunded,
			underfundedThreshold: underfunded ? underfundedThreshold : undefined,
			underfundedWinningEth,
		}
	}
	return {
		auctionedSecurityBondAllowance,
		claimingAvailable: systemState === 'operational' && truthAuctionAddress !== zeroAddress,
		completeSetCollateralAmount,
		currentTime: block.timestamp,
		forkOutcome,
		forkOwnSecurityPool,
		hasForkActivity,
		marketDetails,
		migratedRep,
		migrationEndsAt,
		parentSecurityPoolAddress,
		questionOutcome: getReportingOutcomeKey(questionOutcome),
		...(ownForkMigrationOwnFork
			? {
					ownForkRepBuckets: {
						vaultRepAtFork,
						escalationChildRepPerSelectedOutcome,
						escrowSourceRepAtFork,
					},
				}
			: {}),
		auctionableRepAtFork: ownForkMigrationOwnFork ? ownForkMigrationAuctionableRepAtFork : auctionableRepAtFork,
		securityPoolAddress,
		systemState,
		truthAuction,
		truthAuctionAddress,
		truthAuctionStartedAt,
		universeId,
	}
}

export async function forkZoltarWithOwnEscalation(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(
		client,
		'forkWithOwnEscalation',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'forkZoltarWithOwnEscalationGame',
				args: [securityPoolAddress],
			})),
	)
}
export async function initiateSecurityPoolFork(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(
		client,
		'initiateFork',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'initiateSecurityPoolFork',
				args: [securityPoolAddress],
			})),
	)
}
export async function createChildUniverseFromSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) {
	return await executeForkAuctionAction(
		client,
		'createChildUniverse',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'createChildUniverse',
				args: [securityPoolAddress, BigInt(getReportingOutcomeValue(outcome))],
			})),
	)
}
export async function createZoltarChildUniverse(client: WriteClient, universeId: bigint, outcomeIndex: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: getDeploymentStep('zoltar').address,
		abi: Zoltar_Zoltar.abi,
		functionName: 'deployChild',
		args: [universeId, outcomeIndex],
	}))
	return {
		action: 'createChildUniverse',
		hash,
		outcomeIndex,
		universeId,
	} satisfies ZoltarChildUniverseActionResult
}
async function executeZoltarMigrationAction<TCallParams extends ContractRevertReasonParams>(client: WriteClient, action: ZoltarMigrationActionResult['action'], universeId: bigint, amount: bigint, outcomeIndexes: bigint[], callParams: TCallParams) {
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action,
		amount,
		hash,
		outcomeIndexes,
		universeId,
	} satisfies ZoltarMigrationActionResult
}
export async function prepareRepForMigrationInZoltar(client: WriteClient, universeId: bigint, amount: bigint) {
	const callParams = {
		address: getDeploymentStep('zoltar').address,
		abi: Zoltar_Zoltar.abi,
		functionName: 'addRepToMigrationBalance',
		args: [universeId, amount],
	}
	return await executeZoltarMigrationAction(client, 'addRepToMigrationBalance', universeId, amount, [], callParams)
}
export async function migrateInternalRepInZoltar(client: WriteClient, universeId: bigint, amount: bigint, outcomeIndexes: bigint[]) {
	const callParams = {
		address: getDeploymentStep('zoltar').address,
		abi: Zoltar_Zoltar.abi,
		functionName: 'splitMigrationRep',
		args: [universeId, amount, outcomeIndexes],
	}
	return await executeZoltarMigrationAction(client, 'splitMigrationRep', universeId, amount, outcomeIndexes, callParams)
}
export async function migrateRepToZoltarFromSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcomes: ReportingOutcomeKey[]) {
	return await executeForkAuctionAction(
		client,
		'migrateRepToZoltar',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'migrateRepToZoltar',
				args: [securityPoolAddress, outcomes.map(outcome => BigInt(getReportingOutcomeValue(outcome)))],
			})),
	)
}
export async function migrateSecurityVault(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) {
	return await executeForkAuctionAction(
		client,
		'migrateVault',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'migrateVault',
				args: [securityPoolAddress, BigInt(getReportingOutcomeValue(outcome))],
			})),
	)
}
export async function claimParentEscalationDeposits(client: WriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[]) {
	const outcomeIndex = getReportingOutcomeValue(outcome)
	return await executeForkAuctionAction(client, 'claimParentEscalationDeposits', securityPoolAddress, universeId, async () => {
		return await writeContractAndWait(client, () => ({
			address: getInfraContractAddresses().securityPoolForker,
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'claimForkedEscalationDeposits',
			args: [securityPoolAddress, vaultAddress, outcomeIndex, depositIndexes],
		}))
	})
}
export async function migrateVaultWithUnresolvedEscalation(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) {
	const outcomeIndex = getReportingOutcomeValue(outcome)
	return await executeForkAuctionAction(
		client,
		'migrateUnresolvedEscalation',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'migrateVaultWithUnresolvedEscalation',
				args: [securityPoolAddress, vaultAddress, BigInt(outcomeIndex)],
			})),
	)
}
export async function forkUniverseDirectly(client: WriteClient, universeId: bigint, questionId: bigint, securityPoolAddress: Address) {
	const hash = await writeContractAndWait(client, () => ({
		address: getInfraContractAddresses().zoltar,
		abi: Zoltar_Zoltar.abi,
		functionName: 'forkUniverse',
		args: [universeId, questionId],
	}))
	return {
		action: 'forkUniverse',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies ForkAuctionActionResult
}
export async function forkZoltarUniverse(client: WriteClient, universeId: bigint, questionId: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: getInfraContractAddresses().zoltar,
		abi: Zoltar_Zoltar.abi,
		functionName: 'forkUniverse',
		args: [universeId, questionId],
	}))
	return {
		action: 'forkZoltar',
		hash,
		questionId: getQuestionIdHex(questionId),
		universeId,
	} satisfies ZoltarForkActionResult
}
