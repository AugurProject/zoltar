import { encodeFunctionData, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { deriveHasForkActivity } from './forkActivity.js'
import { Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { statoblast_SecurityPoolForker_SecurityPoolForker, statoblast_SecurityPool_SecurityPool, statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../contractArtifact.js'
import type { ReadClient, ReportingOutcomeKey, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ForkAuctionActionResult, ForkAuctionDetails, TruthAuctionMetrics } from '../types/contracts.js'
import { getReportingOutcomeKey, getReportingOutcomeValue, getSecurityPoolSystemState } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { getEscalationSideLabel, getForkOutcomeKey, hasTimestamp } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import * as forkAuctionCopy from '../copy/forkAuction.js'
import { readRequiredMulticall, writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { getInfraContractAddresses, getZoltarAddress } from './deploymentHelpers.js'
import { requireForkDataView } from './forkData.js'
import { executeForkAuctionAction } from './securityPoolActions.js'
import { SECURITY_POOL_QUESTION_OUTCOME_ABI } from './securityPoolAbi.js'
import { loadMarketDetails } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'

import { TRUTH_AUCTION_TIME_LENGTH } from './truthAuctionTiming.js'

import { FORK_MIGRATION_DURATION_SECONDS, getUnresolvedEscalationMigrationSubmissionGuard } from './forkMigrationTiming.js'
type AuctionClearingTuple = readonly [boolean, bigint, bigint, bigint]
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
		abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
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
			childPoolRepBalanceAttoRep: 0n,
			childRepToken: undefined,
			childUniverseId,
			migrationProxyAddress,
			pendingProxyRepBalanceAttoRep: 0n,
			seeded: false,
		}
	}
	const pendingProxyRepBalanceAttoRep = await client.readContract({
		abi: ABIS.mainnet.erc20,
		functionName: 'balanceOf',
		address: childRepToken,
		args: [migrationProxyAddress],
	})
	const childPoolRepBalanceAttoRep =
		childSecurityPoolAddress === undefined
			? 0n
			: await client.readContract({
					abi: ABIS.mainnet.erc20,
					functionName: 'balanceOf',
					address: childRepToken,
					args: [childSecurityPoolAddress],
				})

	return {
		childPoolRepBalanceAttoRep,
		childRepToken,
		childUniverseId,
		migrationProxyAddress,
		pendingProxyRepBalanceAttoRep,
		seeded: pendingProxyRepBalanceAttoRep > 0n || childPoolRepBalanceAttoRep > 0n,
	}
}

export async function loadForkAuctionDetails(client: ReadClient, securityPoolAddress: Address): Promise<ForkAuctionDetails> {
	const [[questionId, parentSecurityPoolAddress, universeId, systemStateValue, truthAuctionAddress, settlementCollateralAttoEth, forkData, questionOutcome], ownForkMigrationStatusTuple, block] = await Promise.all([
		readRequiredMulticall(client, [
			{
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'questionId',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'parent',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'universeId',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'systemState',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'truthAuction',
				address: securityPoolAddress,
				args: [],
			},
			{
				abi: statoblast_SecurityPool_SecurityPool.abi,
				functionName: 'settlementCollateralAttoEth',
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
				abi: SECURITY_POOL_QUESTION_OUTCOME_ABI,
				functionName: 'getQuestionOutcome',
				address: getInfraContractAddresses().securityPoolForker,
				args: [securityPoolAddress],
			},
		]),
		client.readContract({
			abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getOwnForkMigrationStatus',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
		client.getBlock(),
	])
	if (!hasTimestamp(block)) throw new Error('Unexpected block response')
	const marketDetails = await loadMarketDetails(client, questionId)
	const { auctionableAttoRepAtFork, truthAuctionStartedAt, migratedAttoRep, auctionedUnderwritingLimitAttoEth, forkOwnSecurityPool, forkOutcomeIndex, forkActivationTime } = requireForkDataView(forkData)
	const [ownForkMigrationOwnFork, ownForkMigrationAuctionableRepAtFork, vaultRepAtForkAttoRep, escalationChildRepPerSelectedOutcomeAttoRep, escrowSourceRepAtForkAttoRep] = ownForkMigrationStatusTuple
	const systemState = getSecurityPoolSystemState(systemStateValue)
	const forkOutcome = getForkOutcomeKey(forkOutcomeIndex, parentSecurityPoolAddress)
	const hasForkActivity = deriveHasForkActivity({
		forkOutcome,
		migratedAttoRep,
		systemState,
		truthAuctionStartedAt,
	})
	const migrationEndsAt = forkActivationTime === 0n ? undefined : forkActivationTime + FORK_MIGRATION_DURATION_SECONDS
	let truthAuction: TruthAuctionMetrics | undefined
	if (truthAuctionAddress !== zeroAddress && truthAuctionStartedAt > 0n) {
		const [computeClearingResult, attoEthRaiseCap, attoEthRaised, finalized, maxAttoRepBeingSold, minBidSizeAttoEth, totalAttoRepPurchased, underfunded, underfundedThreshold, underfundedWinningAttoEth, storedClearingTick] = await readRequiredMulticall(client, [
			{
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'computeClearing',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'attoEthRaiseCap',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'attoEthRaised',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'finalized',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'maxAttoRepBeingSold',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'minBidSizeAttoEth',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'totalAttoRepPurchased',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'underfunded',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'underfundedThreshold',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'underfundedWinningAttoEth',
				address: truthAuctionAddress,
				args: [],
			},
			{
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'clearingTick',
				address: truthAuctionAddress,
				args: [],
			},
		])
		const computeClearingTuple: AuctionClearingTuple = computeClearingResult
		const [hitCap, computedClearingTick, accumulatedBidAttoEth, bidAtClearingTickAttoEth] = computeClearingTuple
		const clearingTick = finalized ? storedClearingTick : computedClearingTick
		let clearingPrice: bigint | undefined
		if (underfunded) {
			clearingPrice = underfundedWinningAttoEth > 0n ? underfundedThreshold : undefined
		} else if (!(clearingTick === 0n && accumulatedBidAttoEth === 0n)) {
			clearingPrice = await client.readContract({
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'tickToPrice',
				address: truthAuctionAddress,
				args: [clearingTick],
			})
		}
		truthAuction = {
			accumulatedBidAttoEth,
			auctionEndsAt: truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH,
			clearingPrice,
			clearingTick,
			bidAtClearingTickAttoEth,
			attoEthRaiseCap,
			attoEthRaised,
			finalized,
			hitCap,
			maxAttoRepBeingSold,
			minBidSizeAttoEth,
			attoRepPurchasableAtBid: clearingPrice === undefined || clearingPrice === 0n ? undefined : (attoEthRaiseCap * 10n ** 18n) / clearingPrice,
			timeRemaining: finalized || block.timestamp >= truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH ? 0n : truthAuctionStartedAt + TRUTH_AUCTION_TIME_LENGTH - block.timestamp,
			totalAttoRepPurchased,
			underfunded,
			underfundedThreshold: underfunded ? underfundedThreshold : undefined,
			underfundedWinningAttoEth,
		}
	}
	return {
		auctionedUnderwritingLimitAttoEth,
		claimingAvailable: systemState === 'operational' && truthAuctionAddress !== zeroAddress,
		settlementCollateralAttoEth,
		currentTime: block.timestamp,
		forkOutcome,
		forkOwnSecurityPool,
		hasForkActivity,
		marketDetails,
		migratedAttoRep,
		migrationEndsAt,
		parentSecurityPoolAddress,
		questionOutcome: getReportingOutcomeKey(questionOutcome),
		...(ownForkMigrationOwnFork
			? {
					ownForkRepBuckets: {
						vaultRepAtForkAttoRep,
						escalationChildRepPerSelectedOutcomeAttoRep,
						escrowSourceRepAtForkAttoRep,
					},
				}
			: {}),
		auctionableAttoRepAtFork: ownForkMigrationOwnFork ? ownForkMigrationAuctionableRepAtFork : auctionableAttoRepAtFork,
		securityPoolAddress,
		systemState,
		truthAuction,
		truthAuctionAddress,
		truthAuctionStartedAt,
		universeId,
	}
}

/** REP the fork moves into migration: the forker drains the pool's REP and its escalation game's REP. */
async function readRepToForkAttoRep(client: WriteClient, securityPoolAddress: Address) {
	const [poolRepAttoRep, escalationGameAddress, repTokenAddress] = await Promise.all([
		client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'getTotalPoolHeldAttoRep' }),
		client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'escalationGame' }),
		client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'repToken' }),
	])
	if (escalationGameAddress === zeroAddress) return poolRepAttoRep
	return poolRepAttoRep + (await client.readContract({ address: repTokenAddress, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [escalationGameAddress] }))
}

export async function forkZoltarWithOwnEscalation(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction('forkWithOwnEscalation', securityPoolAddress, universeId, async () => {
		const repToFork = formatCurrencyBalance(await readRepToForkAttoRep(client, securityPoolAddress))
		return await writeContractAndWait(client, () => ({
			address: getInfraContractAddresses().securityPoolForker,
			abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'forkZoltarWithOwnEscalationGame',
			args: [securityPoolAddress],
			reviewTitle: forkAuctionCopy.formatForkWithOwnEscalationReviewTitle(repToFork),
			reviewDescription: forkAuctionCopy.formatForkWithOwnEscalationReviewDescription(repToFork),
		}))
	})
}
export async function initiateSecurityPoolFork(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(
		'initiateFork',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'initiateSecurityPoolFork',
				args: [securityPoolAddress],
			})),
	)
}
export async function createChildUniverseFromSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) {
	return await executeForkAuctionAction(
		'createChildUniverse',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'createChildUniverse',
				args: [securityPoolAddress, BigInt(getReportingOutcomeValue(outcome))],
			})),
	)
}
/** `migrationAmountAttoRep` is the pool-held REP each selected outcome receives, when the caller already loaded it. */
export async function migrateRepToZoltarFromSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcomes: ReportingOutcomeKey[], migrationAmountAttoRep?: bigint) {
	const outcomeLabels = outcomes.map(outcome => getEscalationSideLabel(outcome)).join(', ')
	const migrationAmount = migrationAmountAttoRep === undefined ? undefined : formatCurrencyBalance(migrationAmountAttoRep)
	return await executeForkAuctionAction(
		'migrateRepToZoltar',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'migrateRepToZoltar',
				args: [securityPoolAddress, outcomes.map(outcome => BigInt(getReportingOutcomeValue(outcome)))],
				reviewTitle: forkAuctionCopy.formatMigratePoolReviewTitle(outcomeLabels, migrationAmount),
				reviewDescription: forkAuctionCopy.formatMigratePoolReviewDescription(outcomeLabels, migrationAmount),
			})),
	)
}

/** `repAttoRep` is the pool-held REP `migrateVault` moves for the vault, or undefined when it can't be computed; the review then omits it instead of showing a wrong amount. */
export type VaultMigrationReviewAmounts = {
	repAttoRep: bigint | undefined
	underwritingLimitAttoEth: bigint
}

export async function migrateSecurityVault(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey, vault?: VaultMigrationReviewAmounts) {
	const outcomeLabel = getEscalationSideLabel(outcome)
	const amounts = vault === undefined ? undefined : { rep: vault.repAttoRep === undefined ? undefined : formatCurrencyBalance(vault.repAttoRep), eth: formatCurrencyBalance(vault.underwritingLimitAttoEth) }
	return await executeForkAuctionAction(
		'migrateVault',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'migrateVault',
				args: [securityPoolAddress, BigInt(getReportingOutcomeValue(outcome))],
				reviewTitle: forkAuctionCopy.formatMigrateVaultReviewTitle(outcomeLabel, amounts?.rep),
				reviewDescription: forkAuctionCopy.formatMigrateVaultReviewDescription(outcomeLabel, amounts),
			})),
	)
}
export async function claimParentEscalationDeposits(client: WriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[]) {
	const outcomeIndex = getReportingOutcomeValue(outcome)
	return await executeForkAuctionAction('claimParentEscalationDeposits', securityPoolAddress, universeId, async () => {
		return await writeContractAndWait(client, () => ({
			address: getInfraContractAddresses().securityPoolForker,
			abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'claimForkedEscalationDeposits',
			args: [securityPoolAddress, vaultAddress, outcomeIndex, depositIndexes],
		}))
	})
}
export async function migrateVaultWithUnresolvedEscalation(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) {
	const outcomeIndex = getReportingOutcomeValue(outcome)
	return await executeForkAuctionAction('migrateUnresolvedEscalation', securityPoolAddress, universeId, async () => {
		const forker = getInfraContractAddresses().securityPoolForker
		const validateTiming = async () => {
			const forkData = requireForkDataView(await client.readContract({ address: forker, abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi, functionName: 'forkData', args: [securityPoolAddress] }))
			const block = await client.getBlock()
			const timingGuard = getUnresolvedEscalationMigrationSubmissionGuard({ currentTimestamp: block.timestamp, migrationEndsAt: forkData.forkActivationTime === 0n ? undefined : forkData.forkActivationTime + FORK_MIGRATION_DURATION_SECONDS })
			if (timingGuard !== undefined) throw new Error(timingGuard)
		}
		await validateTiming()
		const callParams = {
			address: forker,
			abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'migrateVaultWithUnresolvedEscalation',
			args: [securityPoolAddress, vaultAddress, BigInt(outcomeIndex)],
		}
		client.onTransactionPlan?.([
			{
				...callParams,
				contractAddress: forker,
				validateBeforeSubmit: async () => {
					await validateTiming()
					await client.estimateGas({ account: client.account, to: forker, data: encodeFunctionData(callParams) })
					await validateTiming()
				},
			},
		])
		return await writeContractAndWait(client, () => callParams)
	})
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
