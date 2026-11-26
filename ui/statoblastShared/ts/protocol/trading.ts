import { securityPoolRecoveryMintBudget } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { loadRecoveryMintFunding } from './recoveryMintFunding.js'
import { collateralPresentation } from './collateral.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { QUESTION_LEDGER_QUESTION_OUTCOME_ABI } from './questionLedgerAbi.js'
import { requireAddressValue, requireBigintValue } from './decoders.js'
import { loadCentralSecurityPoolQuestion } from './securityPoolState.js'
import type { LinearFeeState } from '@zoltar/statoblast-shared/statoblast/linearFees'
import { encodeFunctionData, getAddress, maxUint256, parseAbi, zeroAddress, type Address, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { sortBigIntsAscending } from '@zoltar/core-shared/serialization/bigInt'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { statoblast_QuestionLedger_QuestionLedger, statoblast_tokens_ShareToken_ShareToken } from '../contractArtifact.js'
import type { ReadClient, ReportingOutcomeKey, WriteClient, ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ShareMigrationTarget, TradingActionResult, TradingDetails, TradingShareBalances } from '../types/contracts.js'
import { getMinBigintValue, isBigintTriple } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { type WriteContractClient, readOptionalMulticall, readRequiredMulticall, writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { readQuestionLedgerUniverseId } from './questionLedgerActions.js'
import { formatAmount, formatCurrencyBalance, formatCurrencyBalanceWithUnit, formatValueWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as tradingCopy from '../copy/trading.js'
import * as collateralCopy from '../copy/collateral.js'
import { estimatedPurchaseFee, insufficientMintCapacity, invalidMintLimits, maximumMintAmountUnavailable, mintFeeChanged, mintSharesChanged, mintingAfterReportingStarts, mintReview, questionNotLinkedToSecurityPool, questionPoolVerificationFailed } from '../copy/securityPool.js'
import { availableCapacity } from '../copy/securityPoolCapital.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import { getReportingOutcomeKey, getReportingOutcomeValue } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { changedSinceReview } from '../copy/app.js'
import { checksTransactionReview } from './reviewedClient.js'

type ReadWriteContractClient<TReceipt extends Pick<TransactionReceipt, 'status'> = TransactionReceipt> = Pick<ReadClient, 'readContract'> & WriteContractClient<TReceipt>
type QuestionLedgerMintCapacity = {
	centralCheckpointTimestamp?: bigint
	centralSettlement?: boolean
	linearFee?: LinearFeeState
	currentTimestamp?: bigint
	/** An open escalation game closes minting, which is why `mintingCapacityAttoEth` then reads zero. */
	escalationGameActive?: boolean
	feeEndTimestamp?: bigint
	lastFeeCheckpointNativeTime?: bigint
	settlementCollateralAttoEth: bigint
	feeEligibleUnderwritingLimitAttoEth: bigint
	mintingCapacityAttoEth: bigint
	shareTokenSupplyAttoShares: bigint
	totalPoolHeldAttoRep: bigint
	totalUnderwritingLimitAttoEth: bigint
}
export async function loadQuestionLedgerMintCapacity(client: Pick<ReadClient, 'getBlock' | 'multicall'>, questionLedgerAddress: Address): Promise<QuestionLedgerMintCapacity> {
	const currentBlock = await client.getBlock()
	if (typeof currentBlock.number !== 'bigint') throw new Error('Mint capacity requires a mined block.')
	const [escalationGame, custody] = await readRequiredMulticall(
		client,
		[
			{ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedgerAddress, functionName: 'escalationGame', args: [] },
			{ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedgerAddress, functionName: 'securityPoolCustody', args: [] },
		],
		currentBlock.number,
	)
	const capital = requireAddressValue(custody, 'security pool custody')
	if (capital === zeroAddress) throw new Error(questionNotLinkedToSecurityPool)
	const central = await loadCentralSecurityPoolQuestion(client, questionLedgerAddress, capital, currentBlock.number)
	const escalationGameActive = requireAddressValue(escalationGame, 'reporting game') !== zeroAddress
	return { ...central, currentTimestamp: currentBlock.timestamp, escalationGameActive, mintingCapacityAttoEth: escalationGameActive ? 0n : central.mintingCapacityAttoEth }
}
export async function loadTradingDetails(client: ReadClient, questionLedgerAddress: Address, accountAddress: Address | undefined): Promise<TradingDetails> {
	const [universeId, shareTokenAddress] = await readRequiredMulticall(client, [
		{
			address: questionLedgerAddress,
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'universeId',
			args: [],
		},
		{
			address: questionLedgerAddress,
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'shareToken',
			args: [],
		},
	])
	if (accountAddress === undefined) return { maxRedeemableCompleteSetsAttoShares: undefined, shareBalances: undefined, shareTokenAddress, universeId }
	const shareBalancesResult = await client.readContract({
		address: shareTokenAddress,
		abi: statoblast_tokens_ShareToken_ShareToken.abi,
		functionName: 'balanceOfShares',
		args: [universeId, accountAddress],
	})
	if (!isBigintTriple(shareBalancesResult)) throw new Error('Unexpected trading share balances response')
	const shareBalances: TradingShareBalances = {
		invalidAttoShares: shareBalancesResult[0],
		noAttoShares: shareBalancesResult[2],
		yesAttoShares: shareBalancesResult[1],
	}
	return {
		maxRedeemableCompleteSetsAttoShares: getMinBigintValue([shareBalances.invalidAttoShares, shareBalances.yesAttoShares, shareBalances.noAttoShares]),
		shareBalances,
		shareTokenAddress,
		universeId,
	}
}
/**
 * The security pool the factory records for a pool, accepted only when that factory deployed it from its pinned
 * creation code and module deployers. Its collateral token and spender are not read, and no approval is offered, otherwise.
 */
export async function requireCanonicalSecurityPoolOf(client: Pick<ReadClient, 'readContract'>, factory: Address, pool: Address, blockNumber?: bigint) {
	const block = blockNumber === undefined ? {} : { blockNumber }
	const securityPool = getAddress(requireAddressValue(await client.readContract({ address: factory, abi: purchaseAbi, functionName: 'securityPoolOf', args: [pool], ...block }), 'SecurityPool'))
	if (securityPool === zeroAddress) throw new Error('Question has no security pool.')
	if ((await client.readContract({ address: factory, abi: purchaseAbi, functionName: 'isSecurityPool', args: [securityPool], ...block })) !== true) throw new Error('Market security pool was not created by the canonical factory.')
	return securityPool
}

async function loadTradingCollateralIdentity(client: Pick<ReadClient, 'readContract'>, pool: Address, blockNumber?: bigint) {
	const factory = await client.readContract({ address: pool, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'securityPoolFactory', blockNumber })
	const securityPool = await requireCanonicalSecurityPoolOf(client, factory, pool, blockNumber)
	const [tokenValue, servicesValue] = await Promise.all([client.readContract({ address: securityPool, abi: purchaseAbi, functionName: 'collateralToken', blockNumber }), client.readContract({ address: securityPool, abi: purchaseAbi, functionName: 'services', blockNumber })])
	const token = requireAddressValue(tokenValue, 'Collateral token')
	const services = requireAddressValue(servicesValue, 'Collateral spender')
	return { ...collateralPresentation(token), token, services, securityPool }
}

async function loadTradingFundingIdentity(client: ReadClient, pool: Address) {
	const [identity, universeId, questionId] = await Promise.all([
		loadTradingCollateralIdentity(client, pool),
		client.readContract({ address: pool, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'universeId' }),
		client.readContract({ address: pool, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'questionId' }),
	])
	return { ...identity, universeId, questionId }
}

export async function loadTradingCollateral(client: ReadClient, pool: Address, owner: Address, cachedIdentity?: Awaited<ReturnType<typeof loadTradingFundingIdentity>>) {
	const identity = cachedIdentity ?? (await loadTradingFundingIdentity(client, pool))
	const { token, services } = identity
	const [balance, allowance] = await Promise.all([client.readContract({ address: token, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [owner] }), client.readContract({ address: token, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [owner, services] })])
	return { ...identity, balance, allowance, owner }
}
type TradingCollateral = Awaited<ReturnType<typeof loadTradingCollateral>>

function mintQuoteCalls({ securityPool, universeId, questionId }: TradingCollateral, questionLedger: Address, amount: bigint) {
	return [
		{ address: securityPool, abi: purchaseAbi, functionName: 'purchaseQuote', args: [universeId, questionId, amount] },
		{ address: securityPool, abi: purchaseAbi, functionName: 'quoteMintRecoveryRep', args: [universeId, questionId, amount] },
		{ address: questionLedger, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'attoEthToAttoShares', args: [amount] },
	] as const
}

function mintCapacityCall({ securityPool, universeId }: TradingCollateral) {
	return { address: securityPool, abi: purchaseAbi, functionName: 'availableMintCapacity', args: [universeId] } as const
}

export async function quoteTradingCollateral(client: ReadClient, collateral: TradingCollateral, questionLedger: Address, amount: bigint, onRecoveryRequirement?: (required: bigint) => void) {
	const { securityPool, universeId } = collateral
	const [result, recoveryValue, shares, capacity] = await readRequiredMulticall(client, [...mintQuoteCalls(collateral, questionLedger, amount), mintCapacityCall(collateral)] as const)
	const required = requireBigintValue(recoveryValue, 'Recovery REP contribution')
	onRecoveryRequirement?.(required)
	const recovery = await loadRecoveryMintFunding(client, securityPool, universeId, collateral.owner, required)
	if (!Array.isArray(result) || typeof result[0] !== 'bigint') throw new Error('Invalid collateral fee quote.')
	const fee = result[0]
	return { amount, fee, shares, capacity: requireBigintValue(capacity, 'Mint capacity'), recovery, ...defaultMintLimits(fee, shares) }
}

type MintCandidate = { amount: bigint; fee: bigint; shares: bigint; recoveryAttoRep: bigint }

async function readMintCandidates(client: ReadClient, collateral: TradingCollateral, questionLedger: Address, blockNumber: bigint, amounts: bigint[]) {
	const results = await readOptionalMulticall(
		client,
		amounts.flatMap(amount => mintQuoteCalls(collateral, questionLedger, amount)),
		blockNumber,
	)
	return amounts.flatMap((amount, index): MintCandidate[] => {
		const [fee, recovery, shares] = results.slice(index * 3, index * 3 + 3)
		if (fee?.status !== 'success' || recovery?.status !== 'success' || shares?.status !== 'success') return []
		if (!Array.isArray(fee.result) || typeof fee.result[0] !== 'bigint' || typeof recovery.result !== 'bigint' || typeof shares.result !== 'bigint') return []
		return [{ amount, fee: fee.result[0], shares: shares.result, recoveryAttoRep: recovery.result }]
	})
}

/** Finds the largest funded amount at a single block; current allowances do not limit later approvals. */
export async function loadMaximumTradingMintAmount(client: ReadClient, collateral: TradingCollateral, questionLedger: Address) {
	const blockNumber = (await client.getBlock()).number
	if (blockNumber === undefined) throw new Error(maximumMintAmountUnavailable)
	const [wallet, capacity] = await readRequiredMulticall(client, [{ address: collateral.token, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [collateral.owner] }, mintCapacityCall(collateral)] as const, blockNumber)
	const maximum = getMinBigintValue([wallet, requireBigintValue(capacity, 'Mint capacity')]) ?? 0n
	if (maximum === 0n) return undefined
	const quote = (amounts: bigint[]) => readMintCandidates(client, collateral, questionLedger, blockNumber, amounts)
	const [initial] = await quote([maximum])
	if (initial === undefined) throw new Error(maximumMintAmountUnavailable)
	const { balance: recoveryBalance } = await loadRecoveryMintFunding(client, collateral.securityPool, collateral.universeId, collateral.owner, initial.recoveryAttoRep, blockNumber)
	const recoveryBudget = (candidate: MintCandidate) => securityPoolRecoveryMintBudget(candidate.recoveryAttoRep)
	const mintCost = (candidate: MintCandidate) => candidate.amount + defaultMintLimits(candidate.fee, candidate.shares).maximumFee
	const funded = (candidate: MintCandidate) => mintCost(candidate) <= wallet && recoveryBudget(candidate) <= recoveryBalance
	if (funded(initial)) return initial.shares > 0n ? initial.amount : undefined

	const initialRecovery = recoveryBudget(initial)
	const guess = getMinBigintValue([maximum - 1n, (maximum * wallet) / mintCost(initial), initialRecovery === 0n ? maximum : (maximum * recoveryBalance) / initialRecovery]) ?? 0n
	let affordable: MintCandidate | undefined
	let upper = maximum
	let lower = 0n
	const maxRounds = Math.ceil(maximum.toString(2).length / 2) + 2
	// At a fixed block the successful fee, share, and recovery quotes are nondecreasing. Reverts leave a candidate unclassified.
	for (let round = 0; upper - lower > 1n && round < maxRounds; round++) {
		const width = upper - lower
		const candidates = round === 0 && guess > lower ? [guess, guess + 1n, wallet - defaultMintLimits(initial.fee, initial.shares).maximumFee] : [lower + width / 4n, lower + width / 2n, upper - width / 4n]
		const amounts = [...new Set(candidates)].filter(amount => amount > lower && amount < upper)
		for (const candidate of await quote(amounts)) {
			if (funded(candidate)) {
				if (mintCost(candidate) === wallet && candidate.shares > 0n) return candidate.amount
				if (candidate.amount > lower) {
					lower = candidate.amount
					affordable = candidate
				}
			} else if (candidate.amount < upper) upper = candidate.amount
		}
		if (round > 0 && upper - lower === width) throw new Error(maximumMintAmountUnavailable)
	}
	if (upper - lower > 1n) throw new Error(maximumMintAmountUnavailable)
	return affordable !== undefined && affordable.shares > 0n ? affordable.amount : undefined
}

type MintLimits = { maximumFee: bigint; minimumShares: bigint }

function defaultMintLimits(fee: bigint, shares: bigint) {
	const feeTolerancePercent = 10n
	const shareTolerancePercent = 1n
	return {
		maximumFee: (fee * (100n + feeTolerancePercent) + 99n) / 100n,
		minimumShares: (shares * (100n - shareTolerancePercent)) / 100n,
	}
}

function validateMintLimits(fee: bigint, shares: bigint, { maximumFee, minimumShares }: MintLimits) {
	if (maximumFee < 0n || minimumShares < 0n || maximumFee > maxUint256 || minimumShares > maxUint256) throw new Error(invalidMintLimits)
	if (fee > maximumFee) throw new Error(mintFeeChanged)
	if (shares === 0n || shares < minimumShares) throw new Error(mintSharesChanged)
}

function getShareMigrationOutcomeValue(outcome: ReportingOutcomeKey) {
	switch (outcome) {
		case 'invalid':
			return 0n
		case 'yes':
			return 1n
		case 'no':
			return 2n
		default:
			return assertNever(outcome)
	}
}
function getShareOutcomeLabel(outcome: ReportingOutcomeKey) {
	switch (outcome) {
		case 'invalid':
			return commonCopy.invalid
		case 'yes':
			return commonCopy.yes
		case 'no':
			return commonCopy.no
		default:
			return assertNever(outcome)
	}
}
function getShareTokenId(universeId: bigint, outcome: ReportingOutcomeKey) {
	const universeMask = (1n << 248n) - 1n
	return ((universeId & universeMask) << 8n) | (getShareMigrationOutcomeValue(outcome) & 255n)
}
export async function redeemSharesInQuestionLedger(client: WriteClient, questionLedgerAddress: Address) {
	const universeId = await readQuestionLedgerUniverseId(client, questionLedgerAddress)
	const [shareToken, forker, initialBlock] = await Promise.all([
		client.readContract({ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'shareToken' }),
		client.readContract({ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'questionForker' }),
		client.getBlock(),
	])
	const readBalance = async (blockNumber: bigint | undefined) => {
		if (blockNumber === undefined) throw new Error(tradingCopy.redemptionNeedsBlock)
		const [balances, outcome] = await Promise.all([
			client.readContract({ address: shareToken, abi: statoblast_tokens_ShareToken_ShareToken.abi, functionName: 'balanceOfShares', args: [universeId, client.account.address], blockNumber }),
			client.readContract({ address: forker, abi: QUESTION_LEDGER_QUESTION_OUTCOME_ABI, functionName: 'getQuestionOutcome', args: [questionLedgerAddress], blockNumber }),
		])
		const winner = getReportingOutcomeKey(outcome)
		if (winner === 'none') throw new Error(tradingCopy.poolResolutionRequired)
		return { amount: balances[getReportingOutcomeValue(winner)], balances, blockNumber, winner }
	}
	let reviewedBalance = await readBalance(initialBlock.number)
	const upfrontQuote = checksTransactionReview(client) ? undefined : await readRedemptionQuote(client, questionLedgerAddress, reviewedBalance.amount, reviewedBalance.blockNumber)
	const callParams = {
		address: questionLedgerAddress,
		abi: statoblast_QuestionLedger_QuestionLedger.abi,
		functionName: 'redeemShares',
		args: [],
	} as const
	let reviewRows: ReturnType<typeof redemptionRows> = []
	client.onTransactionPlan?.([
		{
			...callParams,
			contractAddress: questionLedgerAddress,
			reviewTitle: tradingCopy.redeemResolvedShares,
			reviewDescription: tradingCopy.redeemSharesReview,
			readReviewRows: () => reviewRows,
			refreshReviewData: async () => {
				reviewedBalance = await readBalance((await client.getBlock()).number)
				return encodeFunctionData(callParams)
			},
			validateBeforeSubmit: async () => {
				const { amount, balances, blockNumber, winner } = await readBalance((await client.getBlock()).number)
				if (winner !== reviewedBalance.winner || amount !== reviewedBalance.amount) throw new Error(changedSinceReview)
				if (amount === 0n) throw new Error(tradingCopy.redemptionInsufficientShares)
				reviewRows = redemptionRows(await readRedemptionQuote(client, questionLedgerAddress, amount, blockNumber), amount, balances, [winner])
			},
		},
	])
	const hash = await writeContractAndWait(client, () => ({ ...callParams, reviewDescription: upfrontQuote?.description ?? tradingCopy.redeemSharesReview }))
	return {
		action: 'redeemShares',
		hash,
		questionLedgerAddress,
		universeId,
	} satisfies TradingActionResult
}
const SHARE_MIGRATION_SOURCE_OUTCOMES = ['invalid', 'yes', 'no'] as const
/**
 * Reads, in one multicall, each child universe's canonical pool in the source pool's share token and what `accountAddress`
 * already migrated into it from each source outcome. `source` is the pool's already-loaded universe and share token.
 */
export async function loadShareMigrationTargets(client: Pick<ReadClient, 'multicall'>, source: Pick<TradingDetails, 'shareTokenAddress' | 'universeId'>, childUniverses: readonly Pick<ZoltarChildUniverseSummary, 'outcomeIndex' | 'universeId'>[], accountAddress: Address | undefined): Promise<ShareMigrationTarget[]> {
	if (childUniverses.length === 0) return []
	const { shareTokenAddress, universeId } = source
	const canonicalPoolCalls = childUniverses.map(child => ({ address: shareTokenAddress, abi: statoblast_tokens_ShareToken_ShareToken.abi, functionName: 'canonicalQuestionLedgerByUniverse', args: [child.universeId] }))
	const migratedAmountCalls =
		accountAddress === undefined
			? []
			: childUniverses.flatMap(child => SHARE_MIGRATION_SOURCE_OUTCOMES.map(outcome => ({ address: shareTokenAddress, abi: statoblast_tokens_ShareToken_ShareToken.abi, functionName: 'getMigratedShareAmountAttoShares', args: [getShareTokenId(universeId, outcome), child.universeId, accountAddress] })))
	const results: readonly unknown[] = await readRequiredMulticall(client, [...canonicalPoolCalls, ...migratedAmountCalls])
	return childUniverses.map((child, childIndex) => {
		const canonicalPool = requireAddressValue(results[childIndex], 'verified child question contract')
		const migrated = (outcomeOffset: number) => (accountAddress === undefined ? 0n : requireBigintValue(results[childUniverses.length + childIndex * SHARE_MIGRATION_SOURCE_OUTCOMES.length + outcomeOffset], 'migrated share amount'))
		return {
			canonicalPool: canonicalPool === zeroAddress ? undefined : canonicalPool,
			migratedAttoShares: { invalidAttoShares: migrated(0), yesAttoShares: migrated(1), noAttoShares: migrated(2) },
			outcomeIndex: child.outcomeIndex,
		}
	})
}
/** Migrates the wallet's whole balance of `shareOutcome`; `migratedAttoShares` is that balance, shown in the transaction review. */
export async function migrateSharesFromUniverse<TReceipt extends Pick<TransactionReceipt, 'status'>>(client: ReadWriteContractClient<TReceipt>, questionLedgerAddress: Address, shareOutcome: ReportingOutcomeKey, targetOutcomeIndexes: bigint[], migratedAttoShares?: bigint) {
	const sortedTargetOutcomeIndexes = sortBigIntsAscending(targetOutcomeIndexes)
	const shareOutcomeLabel = getShareOutcomeLabel(shareOutcome)
	const [universeId, shareTokenAddress] = await Promise.all([
		readQuestionLedgerUniverseId(client, questionLedgerAddress),
		client.readContract({
			address: questionLedgerAddress,
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'shareToken',
			args: [],
		}),
	])
	const collateral = migratedAttoShares === undefined ? undefined : await loadTradingCollateralIdentity(client, questionLedgerAddress)
	const hash = await writeContractAndWait(client, () => ({
		address: shareTokenAddress,
		abi: statoblast_tokens_ShareToken_ShareToken.abi,
		functionName: 'migrate',
		args: [getShareTokenId(universeId, shareOutcome), sortedTargetOutcomeIndexes],
		reviewTitle: tradingCopy.formatMigrateSharesReviewTitle(shareOutcomeLabel),
		reviewDescription: tradingCopy.formatMigrateSharesReviewDescription(shareOutcomeLabel),
		...(migratedAttoShares === undefined ? {} : { reviewAmount: formatCurrencyBalanceWithUnit(migratedAttoShares, tradingCopy.formatOutcomeShares(shareOutcomeLabel), collateral?.decimals) }),
	}))
	return {
		action: 'migrateShares',
		hash,
		questionLedgerAddress,
		shareOutcome,
		targetOutcomeIndexes: sortedTargetOutcomeIndexes,
		universeId,
	} satisfies TradingActionResult
}
const purchaseAbi = parseAbi([
	'function collateralToken() view returns (address)',
	'function services() view returns (address)',
	'function securityPoolOf(address pool) view returns (address)',
	'function isSecurityPool(address securityPool) view returns (bool)',
	'function getQuestionLedger(uint256 questionId,uint248 universeId) view returns (address)',
	'function purchaseQuote(uint248 universeId,uint256 questionId,uint256 amount) view returns (uint256 fee,uint256 premium)',
	'function availableMintCapacity(uint248 universeId) view returns (uint256)',
	'function quoteMintRecoveryRep(uint248 universeId,uint256 questionId,uint256 cash) view returns(uint256)',
	'function createCompleteSetWithRecoveryRep(uint248 universeId,uint256 questionId,uint256 mintAttoEth,address recipient,uint256 minimumShares,uint256 maximumFee,uint256 maximumRecoveryAttoRep)',
	'function createCompleteSet(uint248 universeId,uint256 questionId,uint256 mintAttoEth,address recipient,uint256 minimumShares,uint256 maximumFee)',
])

export async function createCompleteSetInQuestionLedger(client: WriteClient, questionLedgerAddress: Address, amount: bigint, limits?: { maximumFee: bigint | undefined; minimumShares: bigint | undefined }) {
	const validateBeforeSubmit = async () => {
		const game = await client.readContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedgerAddress, functionName: 'escalationGame' })
		if (BigInt(game) !== 0n) throw new Error(mintingAfterReportingStarts)
		const [questionData, questionId] = await Promise.all([
			client.readContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedgerAddress, functionName: 'questionData' }),
			client.readContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedgerAddress, functionName: 'questionId' }),
		])
		const [endTime, block] = await Promise.all([client.readContract({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, address: questionData, functionName: 'getQuestionEndDate', args: [questionId] }), client.getBlock()])
		if (block.timestamp >= endTime) throw new Error('Minting closed when the question ended.')
		return { questionId, blockNumber: block.number }
	}
	const { questionId } = await validateBeforeSubmit()
	const [universeId, factory] = await Promise.all([readQuestionLedgerUniverseId(client, questionLedgerAddress), client.readContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedgerAddress, functionName: 'securityPoolFactory' })])
	const securityPool = await requireCanonicalSecurityPoolOf(client, factory, questionLedgerAddress)
	const quote = async () => {
		const canonicalPool = await client.readContract({ abi: purchaseAbi, address: securityPool, functionName: 'getQuestionLedger', args: [questionId, universeId] })
		if (typeof canonicalPool !== 'string' || canonicalPool.toLowerCase() !== questionLedgerAddress.toLowerCase()) throw new Error(questionPoolVerificationFailed)
		const [quoted, capacity, recoveryValue] = await Promise.all([
			client.readContract({ abi: purchaseAbi, address: securityPool, functionName: 'purchaseQuote', args: [universeId, questionId, amount] }),
			client.readContract({ abi: purchaseAbi, address: securityPool, functionName: 'availableMintCapacity', args: [universeId] }),
			client.readContract({ abi: purchaseAbi, address: securityPool, functionName: 'quoteMintRecoveryRep', args: [universeId, questionId, amount] }),
		])
		if (!Array.isArray(quoted) || typeof quoted[0] !== 'bigint' || quoted.length !== 2 || typeof quoted[1] !== 'bigint') throw new Error('Invalid shared REP purchase quote.')
		const fee = quoted[0]
		if (typeof capacity !== 'bigint' || capacity < amount) throw new Error(insufficientMintCapacity)
		if (typeof fee !== 'bigint' || fee < 0n) throw new Error('Invalid shared REP purchase quote.')
		return { fee, capacity, recoveryAttoRep: requireBigintValue(recoveryValue, 'Recovery REP contribution') }
	}
	const collateral = await loadTradingCollateral(client, questionLedgerAddress, client.account.address)
	const quoted = await quote()
	const purchaseFee = quoted.fee
	const maximumRecoveryAttoRep = securityPoolRecoveryMintBudget(quoted.recoveryAttoRep)
	const estimatedShares = await client.readContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedgerAddress, functionName: 'attoEthToAttoShares', args: [amount] })
	const maximumFee = limits?.maximumFee ?? (purchaseFee * 10_100n + 9_999n) / 10_000n
	const minimumShares = limits?.minimumShares ?? estimatedShares
	validateMintLimits(purchaseFee, estimatedShares, { maximumFee, minimumShares })
	const args = [universeId, questionId, amount, client.account.address, minimumShares, maximumFee] as const
	const mintCall = maximumRecoveryAttoRep === 0n ? { functionName: 'createCompleteSet' as const, args } : { functionName: 'createCompleteSetWithRecoveryRep' as const, args: [...args, maximumRecoveryAttoRep] as const }
	const collateralValue = (value: bigint) => formatCurrencyBalanceWithUnit(value, collateral.symbol, collateral.decimals)
	const collateralPreview = (value: bigint) => {
		const amount = formatAmount(value, { units: collateral.decimals })
		return formatValueWithUnit(amount.approximate ? `≈\u00a0${amount.text}` : amount.text, collateral.symbol)
	}
	const callParams = {
		address: securityPool,
		abi: purchaseAbi,
		...mintCall,
		value: 0n,
		reviewTitle: tradingCopy.mintCompleteSets,
		reviewDescription: mintReview({
			amount: collateralValue(amount),
			purchaseFee: undefined,
			feeCap: collateralValue(maximumFee),
			minimum: formatCurrencyBalance(minimumShares, collateral.decimals),
			recovery: quoted.recoveryAttoRep === 0n ? undefined : { amount: formatCurrencyBalance(quoted.recoveryAttoRep), cap: formatCurrencyBalance(maximumRecoveryAttoRep) },
		}),
	} as const
	let reviewRows: { label: string; value: string }[] = []
	client.onTransactionPlan?.([
		{
			...callParams,
			contractAddress: callParams.address,
			readReviewRows: () => reviewRows,
			validateBeforeSubmit: async () => {
				const latest = await loadTradingCollateral(client, questionLedgerAddress, client.account.address)
				const fresh = await quote()
				if (fresh.fee > maximumFee) throw new Error(mintFeeChanged)
				if (latest.allowance < amount + fresh.fee) throw new Error(collateralCopy.approvalRequired)
				if (latest.balance < amount + fresh.fee) throw new Error('Insufficient collateral for minting and purchase fees.')
				if (fresh.recoveryAttoRep > maximumRecoveryAttoRep) throw new Error('Recovery REP quote changed. Review the amount again.')
				const recovery = await loadRecoveryMintFunding(client, securityPool, universeId, client.account.address, fresh.recoveryAttoRep)
				if (recovery.balance < maximumRecoveryAttoRep) throw new Error(collateralCopy.insufficientRecoveryRep)
				if (recovery.allowance < maximumRecoveryAttoRep) throw new Error(collateralCopy.recoveryApprovalRequired)
				const { blockNumber } = await validateBeforeSubmit()
				if (blockNumber === undefined) throw new Error('Mint review requires a mined block.')
				const [shareToken, mintedShares] = await Promise.all([
					client.readContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedgerAddress, functionName: 'shareToken', blockNumber }),
					client.readContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedgerAddress, functionName: 'attoEthToAttoShares', args: [amount], blockNumber }),
				])
				validateMintLimits(fresh.fee, mintedShares, { maximumFee, minimumShares })
				const [invalidShares, yesShares, noShares] = await client.readContract({ abi: statoblast_tokens_ShareToken_ShareToken.abi, address: shareToken, functionName: 'balanceOfShares', args: [universeId, client.account.address], blockNumber })
				const shareRow = (outcome: ReportingOutcomeKey, balance: bigint) => ({
					label: tradingCopy.formatOutcomeShares(getShareOutcomeLabel(outcome)),
					value: `${formatCurrencyBalance(balance, collateral.decimals)} → ${formatCurrencyBalance(balance + mintedShares, collateral.decimals)}`,
				})
				reviewRows = [
					{ label: estimatedPurchaseFee, value: `${formatCurrencyBalance(fresh.fee, collateral.decimals)} ${collateral.symbol}` },
					{ label: collateralCopy.wallet, value: `${collateralPreview(latest.balance)} → ${collateralPreview(latest.balance - amount - fresh.fee)}` },
					{ label: availableCapacity, value: `${collateralPreview(fresh.capacity)} → ${collateralPreview(fresh.capacity - amount)}` },
					shareRow('yes', yesShares),
					shareRow('no', noShares),
					shareRow('invalid', invalidShares),
				]
			},
		},
	])
	const hash = await writeContractAndWait(client, () => callParams)
	return { action: 'createCompleteSet', hash, questionLedgerAddress, universeId } satisfies TradingActionResult
}
export async function redeemCompleteSetInQuestionLedger(client: WriteClient, questionLedgerAddress: Address, amount: bigint) {
	const universeId = await readQuestionLedgerUniverseId(client, questionLedgerAddress)
	const upfrontQuote = checksTransactionReview(client) ? undefined : await readRedemptionQuote(client, questionLedgerAddress, amount, (await client.getBlock()).number)
	const callParams = {
		address: questionLedgerAddress,
		abi: statoblast_QuestionLedger_QuestionLedger.abi,
		functionName: 'redeemCompleteSet',
		args: [amount],
	} as const
	let reviewRows: ReturnType<typeof redemptionRows> = []
	client.onTransactionPlan?.([
		{
			...callParams,
			contractAddress: questionLedgerAddress,
			reviewTitle: tradingCopy.redeemCompleteSets,
			reviewDescription: tradingCopy.redeemSetsReview,
			readReviewRows: () => reviewRows,
			validateBeforeSubmit: async () => {
				const { number: blockNumber } = await client.getBlock()
				if (blockNumber === undefined) throw new Error(tradingCopy.redemptionNeedsBlock)
				const readBalances = async () => {
					const shareToken = await client.readContract({ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'shareToken', blockNumber })
					const balances = await client.readContract({ address: shareToken, abi: statoblast_tokens_ShareToken_ShareToken.abi, functionName: 'balanceOfShares', args: [universeId, client.account.address], blockNumber })
					if (balances.some(balance => amount > balance)) throw new Error(tradingCopy.redemptionInsufficientShares)
					return balances
				}
				const [balances, quote] = await Promise.all([readBalances(), readRedemptionQuote(client, questionLedgerAddress, amount, blockNumber)])
				reviewRows = redemptionRows(quote, amount, balances, ['yes', 'no', 'invalid'])
			},
		},
	])
	const hash = await writeContractAndWait(client, () => ({ ...callParams, reviewDescription: upfrontQuote?.description ?? tradingCopy.redeemSetsReview }))
	return {
		action: 'redeemCompleteSet',
		hash,
		questionLedgerAddress,
		universeId,
	} satisfies TradingActionResult
}

async function readRedemptionQuote(client: Pick<ReadClient, 'readContract'>, pool: Address, shares: bigint, blockNumber: bigint | undefined) {
	const collateral = await loadTradingCollateralIdentity(client, pool, blockNumber)
	const recoveryAbi = parseAbi(['function attoSharesToAttoRep(uint256 amountAttoShares) view returns (uint256)'])
	const [cash, rep] = await Promise.all([
		client.readContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: pool, functionName: 'attoSharesToAttoEth', args: [shares], blockNumber }),
		client.readContract({ abi: recoveryAbi, address: pool, functionName: 'attoSharesToAttoRep', args: [shares], blockNumber }),
	])
	const collateralAmount = formatCurrencyBalanceWithUnit(cash, collateral.symbol, collateral.decimals)
	const recovery = requireBigintValue(rep, 'recovery REP quote')
	const repAmount = formatCurrencyBalanceWithUnit(recovery, commonCopy.rep)
	return { collateralAmount, repAmount, recovery, decimals: collateral.decimals, description: tradingCopy.redemptionEstimate(formatCurrencyBalanceWithUnit(shares, 'shares', collateral.decimals), collateralAmount, repAmount) }
}

function redemptionRows(quote: Awaited<ReturnType<typeof readRedemptionQuote>>, amount: bigint, balances: readonly [bigint, bigint, bigint], outcomes: readonly ReportingOutcomeKey[]) {
	return [
		...outcomes.map(outcome => {
			const balance = balances[getReportingOutcomeValue(outcome)]
			return { label: tradingCopy.formatOutcomeShares(getShareOutcomeLabel(outcome)), value: `${formatCurrencyBalance(balance, quote.decimals)} → ${formatCurrencyBalance(balance - amount, quote.decimals)}` }
		}),
		{ label: tradingCopy.estimatedRedemptionCollateral, value: quote.collateralAmount },
		...(quote.recovery === 0n ? [] : [{ label: tradingCopy.estimatedRedemptionRep, value: quote.repAmount }]),
	]
}
