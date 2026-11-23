import { securityPoolRecoveryMintBudget } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { loadRecoveryMintFunding } from './recoveryMintFunding.js'
import { collateralPresentation } from './collateral.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { QUESTION_LEDGER_QUESTION_OUTCOME_ABI } from './questionLedgerAbi.js'
import { requireAddressValue, requireBigintValue } from './decoders.js'
import { loadCentralSecurityPoolQuestion } from './securityPoolState.js'
import type { LinearFeeState } from '@zoltar/statoblast-shared/statoblast/linearFees'
import { encodeFunctionData, getAddress, parseAbi, zeroAddress, type Address, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { sortBigIntsAscending } from '@zoltar/core-shared/serialization/bigInt'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { statoblast_QuestionLedger_QuestionLedger, statoblast_tokens_ShareToken_ShareToken } from '../contractArtifact.js'
import type { ReadClient, ReportingOutcomeKey, WriteClient, ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ShareMigrationTarget, TradingActionResult, TradingDetails, TradingShareBalances } from '../types/contracts.js'
import { getMinBigintValue, isBigintTriple } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { type WriteContractClient, readRequiredMulticall, writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { readQuestionLedgerUniverseId } from './questionLedgerActions.js'
import { formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as tradingCopy from '../copy/trading.js'
import * as collateralCopy from '../copy/collateral.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'

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
	if (capital === zeroAddress) throw new Error('Question ledger is not bound to a security pool.')
	const central = await loadCentralSecurityPoolQuestion(client, questionLedgerAddress, capital, currentBlock.number)
	const escalationGameActive = requireAddressValue(escalationGame, 'escalation game') !== zeroAddress
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
	if ((await client.readContract({ address: factory, abi: purchaseAbi, functionName: 'isSecurityPool', args: [securityPool], ...block })) !== true) throw new Error('Market security pool was not deployed by the canonical factory.')
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
export async function quoteTradingCollateral(client: ReadClient, collateral: Awaited<ReturnType<typeof loadTradingCollateral>>, amount: bigint, onRecoveryRequirement?: (required: bigint) => void) {
	const { universeId, questionId } = collateral
	const [result, recoveryValue] = await Promise.all([
		client.readContract({ address: collateral.securityPool, abi: purchaseAbi, functionName: 'purchaseQuote', args: [universeId, questionId, amount] }),
		client.readContract({ address: collateral.securityPool, abi: purchaseAbi, functionName: 'quoteMintRecoveryRep', args: [universeId, questionId, amount] }),
	])
	const required = requireBigintValue(recoveryValue, 'Recovery REP contribution')
	securityPoolRecoveryMintBudget(required)
	onRecoveryRequirement?.(required)
	const recovery = await loadRecoveryMintFunding(client, collateral.securityPool, universeId, collateral.owner, required)
	if (!Array.isArray(result) || typeof result[0] !== 'bigint') throw new Error('Invalid collateral fee quote.')
	return { amount, fee: result[0], recovery }
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
	const [shareToken, forker, block] = await Promise.all([
		client.readContract({ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'shareToken' }),
		client.readContract({ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'questionForker' }),
		client.getBlock(),
	])
	const balances = await client.readContract({ address: shareToken, abi: statoblast_tokens_ShareToken_ShareToken.abi, functionName: 'balanceOfShares', args: [universeId, client.account.address], blockNumber: block.number })
	const outcome = await client.readContract({ address: forker, abi: QUESTION_LEDGER_QUESTION_OUTCOME_ABI, functionName: 'getQuestionOutcome', args: [questionLedgerAddress], blockNumber: block.number })
	const amount = balances[Number(outcome)]
	if (amount === undefined) throw new Error('Winning outcome is unavailable.')
	const reviewDescription = await redemptionReview(client, questionLedgerAddress, amount, block.number)
	const hash = await writeContractAndWait(client, () => ({
		address: questionLedgerAddress,
		abi: statoblast_QuestionLedger_QuestionLedger.abi,
		functionName: 'redeemShares',
		reviewDescription,
		args: [],
	}))
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
		const canonicalPool = requireAddressValue(results[childIndex], 'canonical child pool')
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
		...(migratedAttoShares === undefined ? {} : { reviewAmount: formatCurrencyBalanceWithUnit(migratedAttoShares, tradingCopy.formatMigrateSharesReviewUnit(shareOutcomeLabel), collateral?.decimals) }),
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

export async function createCompleteSetInQuestionLedger(client: WriteClient, questionLedgerAddress: Address, amount: bigint) {
	const validateBeforeSubmit = async () => {
		const game = await client.readContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedgerAddress, functionName: 'escalationGame' })
		if (BigInt(game) !== 0n) throw new Error('Minting closed after escalation starts.')
		const [questionData, questionId] = await Promise.all([
			client.readContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedgerAddress, functionName: 'questionData' }),
			client.readContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedgerAddress, functionName: 'questionId' }),
		])
		const [endTime, block] = await Promise.all([client.readContract({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, address: questionData, functionName: 'getQuestionEndDate', args: [questionId] }), client.getBlock()])
		if (block.timestamp >= endTime) throw new Error('Minting closed when the question ended.')
		return questionId
	}
	const questionId = await validateBeforeSubmit()
	const [universeId, factory] = await Promise.all([readQuestionLedgerUniverseId(client, questionLedgerAddress), client.readContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedgerAddress, functionName: 'securityPoolFactory' })])
	const securityPool = await requireCanonicalSecurityPoolOf(client, factory, questionLedgerAddress)
	const quote = async () => {
		const canonicalPool = await client.readContract({ abi: purchaseAbi, address: securityPool, functionName: 'getQuestionLedger', args: [questionId, universeId] })
		if (typeof canonicalPool !== 'string' || canonicalPool.toLowerCase() !== questionLedgerAddress.toLowerCase()) throw new Error('Security pool question pool is not canonical.')
		const [quoted, capacity, recoveryValue] = await Promise.all([
			client.readContract({ abi: purchaseAbi, address: securityPool, functionName: 'purchaseQuote', args: [universeId, questionId, amount] }),
			client.readContract({ abi: purchaseAbi, address: securityPool, functionName: 'availableMintCapacity', args: [universeId] }),
			client.readContract({ abi: purchaseAbi, address: securityPool, functionName: 'quoteMintRecoveryRep', args: [universeId, questionId, amount] }),
		])
		if (!Array.isArray(quoted) || typeof quoted[0] !== 'bigint' || quoted.length !== 2 || typeof quoted[1] !== 'bigint') throw new Error('Invalid shared REP purchase quote.')
		const fee = quoted[0]
		if (typeof capacity !== 'bigint' || capacity < amount) throw new Error('Insufficient shared REP backing after queued retirement.')
		if (typeof fee !== 'bigint' || fee < 0n) throw new Error('Invalid shared REP purchase quote.')
		return { fee, recoveryAttoRep: requireBigintValue(recoveryValue, 'Recovery REP contribution') }
	}
	const collateral = await loadTradingCollateral(client, questionLedgerAddress, client.account.address)
	const quoted = await quote()
	const purchaseFee = quoted.fee
	const maximumRecoveryAttoRep = securityPoolRecoveryMintBudget(quoted.recoveryAttoRep)
	const maximumFee = (purchaseFee * 10_100n + 9_999n) / 10_000n
	const minimumShares = await client.readContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedgerAddress, functionName: 'attoEthToAttoShares', args: [amount] })
	const args = [universeId, questionId, amount, client.account.address, minimumShares, maximumFee] as const
	const mintCall = maximumRecoveryAttoRep === 0n ? { functionName: 'createCompleteSet' as const, args } : { functionName: 'createCompleteSetWithRecoveryRep' as const, args: [...args, maximumRecoveryAttoRep] as const }
	const callParams = {
		address: securityPool,
		abi: purchaseAbi,
		...mintCall,
		value: 0n,
		reviewTitle: 'Buy complete sets',
		reviewDescription: `Estimated purchase fee: ${formatCurrencyBalanceWithUnit(purchaseFee, collateral.symbol, collateral.decimals)}. Includes 1% fee budget headroom; only the actual fee is transferred. Recovery contribution: ${formatCurrencyBalanceWithUnit(quoted.recoveryAttoRep, commonCopy.rep)}. Maximum recovery REP contribution: ${formatCurrencyBalanceWithUnit(maximumRecoveryAttoRep, commonCopy.rep)}, including 1% headroom and rounding; only the actual contribution is transferred.`,
	} as const
	client.onTransactionPlan?.([
		{
			...callParams,
			contractAddress: callParams.address,
			validateBeforeSubmit: async () => {
				const latest = await loadTradingCollateral(client, questionLedgerAddress, client.account.address)
				const fresh = await quote()
				if (fresh.fee > maximumFee) throw new Error('Purchase fee changed. Review the amount again.')
				if (latest.allowance < amount + fresh.fee) throw new Error(collateralCopy.approvalRequired)
				if (latest.balance < amount + fresh.fee) throw new Error('Insufficient collateral for minting and purchase fees.')
				if (fresh.recoveryAttoRep > maximumRecoveryAttoRep) throw new Error('Recovery REP quote changed. Review the amount again.')
				const recovery = await loadRecoveryMintFunding(client, securityPool, universeId, client.account.address, fresh.recoveryAttoRep)
				if (recovery.balance < maximumRecoveryAttoRep) throw new Error(collateralCopy.insufficientRecoveryRep)
				if (recovery.allowance < maximumRecoveryAttoRep) throw new Error(collateralCopy.recoveryApprovalRequired)
				await client.estimateGas({ account: client.account, to: callParams.address, data: encodeFunctionData(callParams), value: callParams.value })
				await validateBeforeSubmit()
			},
		},
	])
	const hash = await writeContractAndWait(client, () => callParams)
	return { action: 'createCompleteSet', hash, questionLedgerAddress, universeId } satisfies TradingActionResult
}
export async function redeemCompleteSetInQuestionLedger(client: WriteClient, questionLedgerAddress: Address, amount: bigint) {
	const universeId = await readQuestionLedgerUniverseId(client, questionLedgerAddress)
	const block = await client.getBlock()
	const reviewDescription = await redemptionReview(client, questionLedgerAddress, amount, block.number)
	const hash = await writeContractAndWait(client, () => ({
		address: questionLedgerAddress,
		abi: statoblast_QuestionLedger_QuestionLedger.abi,
		functionName: 'redeemCompleteSet',
		reviewDescription,
		args: [amount],
	}))
	return {
		action: 'redeemCompleteSet',
		hash,
		questionLedgerAddress,
		universeId,
	} satisfies TradingActionResult
}

async function redemptionReview(client: Pick<ReadClient, 'readContract'>, pool: Address, shares: bigint, blockNumber: bigint | undefined) {
	const collateral = await loadTradingCollateralIdentity(client, pool, blockNumber)
	const recoveryAbi = parseAbi(['function attoSharesToAttoRep(uint256 amountAttoShares) view returns (uint256)'])
	const [cash, rep] = await Promise.all([
		client.readContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: pool, functionName: 'attoSharesToAttoEth', args: [shares], blockNumber }),
		client.readContract({ abi: recoveryAbi, address: pool, functionName: 'attoSharesToAttoRep', args: [shares], blockNumber }),
	])
	return `Redeem ${formatCurrencyBalanceWithUnit(shares, 'shares', collateral.decimals)} for approximately ${formatCurrencyBalanceWithUnit(cash, collateral.symbol, collateral.decimals)} and ${formatCurrencyBalanceWithUnit(requireBigintValue(rep, 'recovery REP quote'), 'REP')} in this universe.`
}
