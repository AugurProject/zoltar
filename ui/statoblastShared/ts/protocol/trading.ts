import { collateralPresentation } from './collateral.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { SECURITY_POOL_QUESTION_OUTCOME_ABI } from './securityPoolAbi.js'
import { requireAddressValue, requireBigintValue } from './decoders.js'
import { loadCentralPortfolioQuestion } from './securityPoolPortfolioState.js'
import type { LinearFeeState } from '@zoltar/statoblast-shared/statoblast/retentionRate'
import { encodeFunctionData, getAddress, isAddress, parseAbi, zeroAddress, type Address, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { sortBigIntsAscending } from '@zoltar/core-shared/serialization/bigInt'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { statoblast_SecurityPool_SecurityPool, statoblast_tokens_ShareToken_ShareToken } from '../contractArtifact.js'
import type { ReadClient, ReportingOutcomeKey, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { TradingActionResult, TradingDetails, TradingShareBalances } from '../types/contracts.js'
import { getMinBigintValue, isBigintTriple } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { type WriteContractClient, readRequiredMulticall, writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { readSecurityPoolUniverseId } from './securityPoolActions.js'
import { formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as tradingCopy from '../copy/trading.js'
import * as collateralCopy from '../copy/collateral.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'

type ReadWriteContractClient<TReceipt extends Pick<TransactionReceipt, 'status'> = TransactionReceipt> = Pick<ReadClient, 'readContract'> & WriteContractClient<TReceipt>
type SecurityPoolMintCapacity = {
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
export async function loadSecurityPoolMintCapacity(client: Pick<ReadClient, 'getBlock' | 'multicall'>, securityPoolAddress: Address): Promise<SecurityPoolMintCapacity> {
	const currentBlock = await client.getBlock()
	if (typeof currentBlock.number !== 'bigint') throw new Error('Mint capacity requires a mined block.')
	const [escalationGame, custody] = await readRequiredMulticall(
		client,
		[
			{ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddress, functionName: 'escalationGame', args: [] },
			{ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddress, functionName: 'portfolioCustody', args: [] },
		],
		currentBlock.number,
	)
	const capital = requireAddressValue(custody, 'portfolio custody')
	if (capital === zeroAddress) throw new Error('Question ledger is not bound to a portfolio.')
	const central = await loadCentralPortfolioQuestion(client, securityPoolAddress, capital, currentBlock.number)
	const escalationGameActive = requireAddressValue(escalationGame, 'escalation game') !== zeroAddress
	return { ...central, currentTimestamp: currentBlock.timestamp, escalationGameActive, mintingCapacityAttoEth: escalationGameActive ? 0n : central.mintingCapacityAttoEth }
}
export async function loadTradingDetails(client: ReadClient, securityPoolAddress: Address, accountAddress: Address | undefined): Promise<TradingDetails> {
	if (accountAddress === undefined) {
		const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
		return {
			maxRedeemableCompleteSetsAttoShares: undefined,
			shareBalances: undefined,
			universeId,
		}
	}
	const [universeId, shareTokenAddress] = await readRequiredMulticall(client, [
		{
			address: securityPoolAddress,
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'universeId',
			args: [],
		},
		{
			address: securityPoolAddress,
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'shareToken',
			args: [],
		},
	])
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
		universeId,
	}
}
async function loadTradingCollateralIdentity(client: Pick<ReadClient, 'readContract'>, pool: Address, blockNumber?: bigint) {
	const factory = await client.readContract({ address: pool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'securityPoolFactory', blockNumber })
	const portfolio = requireAddressValue(await client.readContract({ address: factory, abi: purchaseAbi, functionName: 'getSecurityPoolPortfolio', args: [pool], blockNumber }), 'Portfolio')
	const [tokenValue, servicesValue] = await Promise.all([client.readContract({ address: portfolio, abi: purchaseAbi, functionName: 'collateralToken', blockNumber }), client.readContract({ address: portfolio, abi: purchaseAbi, functionName: 'services', blockNumber })])
	const token = requireAddressValue(tokenValue, 'Collateral token')
	const services = requireAddressValue(servicesValue, 'Collateral spender')
	return { ...collateralPresentation(token), token, services, portfolio }
}

async function loadTradingFundingIdentity(client: ReadClient, pool: Address) {
	const [identity, universeId, questionId] = await Promise.all([
		loadTradingCollateralIdentity(client, pool),
		client.readContract({ address: pool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'universeId' }),
		client.readContract({ address: pool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'questionId' }),
	])
	return { ...identity, universeId, questionId }
}

export async function loadTradingCollateral(client: ReadClient, pool: Address, owner: Address, cachedIdentity?: Awaited<ReturnType<typeof loadTradingFundingIdentity>>) {
	const identity = cachedIdentity ?? (await loadTradingFundingIdentity(client, pool))
	const { token, services } = identity
	const [balance, allowance] = await Promise.all([client.readContract({ address: token, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [owner] }), client.readContract({ address: token, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [owner, services] })])
	return { ...identity, balance, allowance }
}
export async function quoteTradingCollateral(client: ReadClient, collateral: Awaited<ReturnType<typeof loadTradingCollateral>>, amount: bigint) {
	const { universeId, questionId } = collateral
	const result = await client.readContract({ address: collateral.portfolio, abi: purchaseAbi, functionName: 'purchaseQuote', args: [universeId, questionId, amount] })
	if (!Array.isArray(result) || typeof result[0] !== 'bigint') throw new Error('Invalid collateral fee quote.')
	return { amount, maximumFee: (result[0] * 10_100n + 9_999n) / 10_000n }
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
export async function redeemSharesInSecurityPool(client: WriteClient, securityPoolAddress: Address) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const [shareToken, forker, block] = await Promise.all([
		client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'shareToken' }),
		client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'securityPoolForker' }),
		client.getBlock(),
	])
	const balances = await client.readContract({ address: shareToken, abi: statoblast_tokens_ShareToken_ShareToken.abi, functionName: 'balanceOfShares', args: [universeId, client.account.address], blockNumber: block.number })
	const outcome = await client.readContract({ address: forker, abi: SECURITY_POOL_QUESTION_OUTCOME_ABI, functionName: 'getQuestionOutcome', args: [securityPoolAddress], blockNumber: block.number })
	const amount = balances[Number(outcome)]
	if (amount === undefined) throw new Error('Winning outcome is unavailable.')
	const reviewDescription = await redemptionReview(client, securityPoolAddress, amount, block.number)
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: statoblast_SecurityPool_SecurityPool.abi,
		functionName: 'redeemShares',
		reviewDescription,
		args: [],
	}))
	return {
		action: 'redeemShares',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies TradingActionResult
}
/** Migrates the wallet's whole balance of `shareOutcome`; `migratedAttoShares` is that balance, shown in the transaction review. */
export async function migrateSharesFromUniverse<TReceipt extends Pick<TransactionReceipt, 'status'>>(client: ReadWriteContractClient<TReceipt>, securityPoolAddress: Address, shareOutcome: ReportingOutcomeKey, targetOutcomeIndexes: bigint[], migratedAttoShares?: bigint) {
	const sortedTargetOutcomeIndexes = sortBigIntsAscending(targetOutcomeIndexes)
	const shareOutcomeLabel = getShareOutcomeLabel(shareOutcome)
	const [universeId, shareTokenAddress] = await Promise.all([
		readSecurityPoolUniverseId(client, securityPoolAddress),
		client.readContract({
			address: securityPoolAddress,
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'shareToken',
			args: [],
		}),
	])
	const hash = await writeContractAndWait(client, () => ({
		address: shareTokenAddress,
		abi: statoblast_tokens_ShareToken_ShareToken.abi,
		functionName: 'migrate',
		args: [getShareTokenId(universeId, shareOutcome), sortedTargetOutcomeIndexes],
		reviewTitle: tradingCopy.formatMigrateSharesReviewTitle(shareOutcomeLabel),
		reviewDescription: tradingCopy.formatMigrateSharesReviewDescription(shareOutcomeLabel),
		...(migratedAttoShares === undefined ? {} : { reviewAmount: formatCurrencyBalanceWithUnit(migratedAttoShares, tradingCopy.formatMigrateSharesReviewUnit(shareOutcomeLabel)) }),
	}))
	return {
		action: 'migrateShares',
		hash,
		securityPoolAddress,
		shareOutcome,
		targetOutcomeIndexes: sortedTargetOutcomeIndexes,
		universeId,
	} satisfies TradingActionResult
}
const purchaseAbi = parseAbi([
	'function collateralToken() view returns (address)',
	'function services() view returns (address)',
	'function getSecurityPoolPortfolio(address pool) view returns (address)',
	'function getPool(uint256 questionId,uint248 universeId) view returns (address)',
	'function purchaseQuote(uint248 universeId,uint256 questionId,uint256 amount) view returns (uint256 fee,uint256 premium)',
	'function availableMintCapacity(uint248 universeId) view returns (uint256)',
	'function createCompleteSet(uint248 universeId,uint256 questionId,uint256 mintAttoEth,address recipient,uint256 minimumShares,uint256 maximumFee)',
])

export async function createCompleteSetInSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint) {
	const validateBeforeSubmit = async () => {
		const game = await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddress, functionName: 'escalationGame' })
		if (BigInt(game) !== 0n) throw new Error('Minting closed after escalation starts.')
		const [questionData, questionId] = await Promise.all([client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddress, functionName: 'questionData' }), client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddress, functionName: 'questionId' })])
		const [endTime, block] = await Promise.all([client.readContract({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, address: questionData, functionName: 'getQuestionEndDate', args: [questionId] }), client.getBlock()])
		if (block.timestamp >= endTime) throw new Error('Minting closed when the question ended.')
		return questionId
	}
	const questionId = await validateBeforeSubmit()
	const [universeId, factory] = await Promise.all([readSecurityPoolUniverseId(client, securityPoolAddress), client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddress, functionName: 'securityPoolFactory' })])
	const portfolioValue = await client.readContract({ abi: purchaseAbi, address: factory, functionName: 'getSecurityPoolPortfolio', args: [securityPoolAddress] })
	if (typeof portfolioValue !== 'string' || !isAddress(portfolioValue)) throw new Error('Invalid shared pool purchase authority.')
	const portfolio = getAddress(portfolioValue)
	if (portfolio === zeroAddress) throw new Error('Question has no portfolio.')
	const quote = async () => {
		const canonicalPool = await client.readContract({ abi: purchaseAbi, address: portfolio, functionName: 'getPool', args: [questionId, universeId] })
		if (typeof canonicalPool !== 'string' || canonicalPool.toLowerCase() !== securityPoolAddress.toLowerCase()) throw new Error('Portfolio question pool is not canonical.')
		const [quoted, capacity] = await Promise.all([client.readContract({ abi: purchaseAbi, address: portfolio, functionName: 'purchaseQuote', args: [universeId, questionId, amount] }), client.readContract({ abi: purchaseAbi, address: portfolio, functionName: 'availableMintCapacity', args: [universeId] })])
		if (!Array.isArray(quoted) || typeof quoted[0] !== 'bigint' || quoted.length !== 2 || typeof quoted[1] !== 'bigint') throw new Error('Invalid shared REP purchase quote.')
		const fee = quoted[0]
		if (typeof capacity !== 'bigint' || capacity < amount) throw new Error('Insufficient shared REP backing after queued retirement.')
		if (typeof fee !== 'bigint' || fee < 0n) throw new Error('Invalid shared REP purchase quote.')
		return fee
	}
	const collateral = await loadTradingCollateral(client, securityPoolAddress, client.account.address)
	const purchaseFee = await quote()
	const maximumFee = (purchaseFee * 10_100n + 9_999n) / 10_000n
	const minimumShares = await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddress, functionName: 'attoEthToAttoShares', args: [amount] })
	const callParams = {
		address: portfolio,
		abi: purchaseAbi,
		functionName: 'createCompleteSet',
		args: [universeId, questionId, amount, client.account.address, minimumShares, maximumFee],
		value: 0n,
		reviewTitle: 'Buy complete sets',
		reviewDescription: `Estimated purchase fee: ${formatCurrencyBalanceWithUnit(purchaseFee, collateral.symbol, collateral.decimals)}. Includes 1% fee budget headroom; only the actual fee is transferred.`,
	} as const
	client.onTransactionPlan?.([
		{
			...callParams,
			contractAddress: callParams.address,
			validateBeforeSubmit: async () => {
				const latest = await loadTradingCollateral(client, securityPoolAddress, client.account.address)
				if (latest.allowance < amount + maximumFee) throw new Error(collateralCopy.approvalRequired)
				if (latest.balance < amount + maximumFee) throw new Error('Insufficient collateral for minting and purchase fees.')
				if ((await quote()) > maximumFee) throw new Error('Purchase fee changed. Review the amount again.')
				await client.estimateGas({ account: client.account, to: callParams.address, data: encodeFunctionData(callParams), value: callParams.value })
				await validateBeforeSubmit()
			},
		},
	])
	const hash = await writeContractAndWait(client, () => callParams)
	return { action: 'createCompleteSet', hash, securityPoolAddress, universeId } satisfies TradingActionResult
}
export async function redeemCompleteSetInSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const block = await client.getBlock()
	const reviewDescription = await redemptionReview(client, securityPoolAddress, amount, block.number)
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: statoblast_SecurityPool_SecurityPool.abi,
		functionName: 'redeemCompleteSet',
		reviewDescription,
		args: [amount],
	}))
	return {
		action: 'redeemCompleteSet',
		hash,
		securityPoolAddress,
		universeId,
	} satisfies TradingActionResult
}

async function redemptionReview(client: Pick<ReadClient, 'readContract'>, pool: Address, shares: bigint, blockNumber: bigint | undefined) {
	const collateral = await loadTradingCollateralIdentity(client, pool, blockNumber)
	const recoveryAbi = parseAbi(['function attoSharesToAttoRep(uint256 amountAttoShares) view returns (uint256)'])
	const [cash, rep] = await Promise.all([client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool, functionName: 'attoSharesToAttoEth', args: [shares], blockNumber }), client.readContract({ abi: recoveryAbi, address: pool, functionName: 'attoSharesToAttoRep', args: [shares], blockNumber })])
	return `Redeem ${formatCurrencyBalanceWithUnit(shares, 'shares', collateral.decimals)} for approximately ${formatCurrencyBalanceWithUnit(cash, collateral.symbol, collateral.decimals)} and ${formatCurrencyBalanceWithUnit(requireBigintValue(rep, 'recovery REP quote'), 'REP')} in this universe.`
}
