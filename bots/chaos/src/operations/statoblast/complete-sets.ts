import { collateralSpendContinuation } from './collateral-approval.ts'
import { EcosystemSnapshot, OperationDefinition, OperationWalletAssetDebit, PlanningOptions, PoolSnapshot } from '../types.ts'

import { inputInteger, inputMatches } from '../input-values.ts'

import { BINARY_OUTCOME_NONE, operationalPools, shareTokenId, sharesToEth, walletShares } from './planning.ts'

import { allowance, tokenInventory, erc20AllowanceEvidence, amount, choose, eligible, encodeStep, erc20WalletDebit, erc1155WalletDebit, eventEvidence, mixSeed, optionAmount, planBase } from '../planning.ts'

import { erc20Abi, securityPoolAbi, securityPoolPortfolioAbi } from '@zoltar/bot-shared/contracts/abi'
import { timestampDeadlineHasRequiredSafety } from '../timing.ts'

function mintDeadline(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions) {
	const question = snapshot.questions.find(candidate => candidate.id === pool.questionId)
	if (question === undefined || amount(question.endTime) === 0n) return undefined
	const deadline = amount(question.endTime) - 1n
	return timestampDeadlineHasRequiredSafety(amount(snapshot.anchor.timestamp), deadline, options) ? deadline.toString() : undefined
}

function purchase(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions) {
	const quote = pool.purchaseQuote
	if (quote === undefined || !inputMatches(options, 'pool', pool.address) || !inputMatches(options, 'amount', quote.mintAttoEth) || !operationalPools(snapshot).includes(pool) || mintDeadline(snapshot, pool, options) === undefined) return undefined
	const mint = amount(quote.mintAttoEth)
	const value = mint + amount(quote.feeAttoEth)
	if (
		mint === 0n ||
		amount(quote.minimumShares) === 0n ||
		value > optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n) ||
		amount(snapshot.wallet.ethBalanceAttoEth) < optionAmount(options, 'minimumEthReserveAttoEth', 10n ** 16n) ||
		amount(snapshot.wallet.tokens.find(token => token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase())?.balance ?? '0') < value
	)
		return undefined
	return { quote, mint, value }
}

export function completeSetDefinition(kind: 'create' | 'redeem' | 'winning'): OperationDefinition {
	let id = 'statoblast.complete-set.create'
	let method = 'createCompleteSet'
	let actionLabel = 'Create complete set'
	let signature = 'CompleteSetCreated(address,uint256,uint256,uint256,uint256)'
	if (kind === 'redeem') {
		id = 'statoblast.complete-set.redeem'
		method = 'redeemCompleteSet'
		actionLabel = 'Redeem complete set'
		signature = 'CompleteSetRedeemed(address,uint256,uint256,uint256,uint256)'
	} else if (kind === 'winning') {
		id = 'statoblast.shares.redeem-winning'
		method = 'redeemShares'
		actionLabel = 'Redeem winning shares'
		signature = 'SharesRedeemed(address,uint256,uint256,uint256,uint256)'
	}
	const definition: OperationDefinition = {
		buildPlan(snapshot, options) {
			const candidates = snapshot.pools.filter(pool => {
				if (!inputMatches(options, 'pool', pool.address)) return false
				if (kind === 'create') return purchase(snapshot, pool, options) !== undefined
				const shares = snapshot.wallet.shares.find(candidate => candidate.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && candidate.universeId === pool.universeId)
				if (shares === undefined) return false
				if (kind === 'redeem') {
					const complete = [shares.invalid, shares.yes, shares.no].map(balance => amount(balance)).reduce((minimum, balance) => (balance < minimum ? balance : minimum))
					return complete > 0n && sharesToEth(pool, complete) > 0n && pool.systemState === 0 && snapshot.universes.find(universe => universe.id === pool.universeId)?.forkTime === '0'
				}
				const winningBalance = [shares.invalid, shares.yes, shares.no][pool.questionOutcome]
				return pool.systemState === 0 && pool.questionOutcome !== BINARY_OUTCOME_NONE && winningBalance !== undefined && amount(winningBalance) > 0n && sharesToEth(pool, amount(winningBalance)) > 0n
			})
			const pool = choose(candidates, mixSeed(options.seed, id))
			if (pool === undefined) return undefined
			let spend = 0n
			const quotedPurchase = kind === 'create' ? purchase(snapshot, pool, options) : undefined
			if (kind === 'create') {
				if (quotedPurchase === undefined) return undefined
				spend = quotedPurchase.mint
			} else if (kind === 'redeem') {
				const shares = snapshot.wallet.shares.find(candidate => candidate.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && candidate.universeId === pool.universeId)
				if (shares === undefined) return undefined
				spend = [amount(shares.invalid), amount(shares.yes), amount(shares.no)].reduce((minimum, value) => (value < minimum ? value : minimum))
				spend = inputInteger(options, 'amount', spend, 1n, spend)
				if (sharesToEth(pool, spend) === 0n) return undefined
			}
			let args: (bigint | string)[] | undefined
			if (kind === 'redeem') args = [spend]
			if (kind === 'create' && quotedPurchase !== undefined) args = [amount(pool.universeId), amount(pool.questionId), spend, snapshot.wallet.address, amount(quotedPurchase.quote.minimumShares), amount(quotedPurchase.quote.feeAttoEth)]
			const shares = walletShares(snapshot, pool)
			if (kind !== 'create' && shares === undefined) return undefined
			let walletAssetDebits: OperationWalletAssetDebit[] = quotedPurchase === undefined ? [] : [erc20WalletDebit(snapshot.deployments.weth, quotedPurchase.value, 'weth')]
			if (kind === 'redeem') walletAssetDebits = [0, 1, 2].map(outcome => erc1155WalletDebit(pool.shareToken, shareTokenId(pool.universeId, outcome), spend))
			if (kind === 'winning' && shares !== undefined) {
				const winningBalance = [shares.invalid, shares.yes, shares.no][pool.questionOutcome]
				if (winningBalance === undefined || amount(winningBalance) === 0n) return undefined
				walletAssetDebits = [erc1155WalletDebit(pool.shareToken, shareTokenId(pool.universeId, pool.questionOutcome), amount(winningBalance))]
			}
			return planBase({
				definitionId: id,
				ecosystem: 'statoblast',
				label: actionLabel,
				metadata: { amount: spend.toString(), pool: pool.address, ...(quotedPurchase === undefined ? {} : { collateralToken: snapshot.deployments.weth, portfolio: pool.portfolio, collateralSpender: quotedPurchase.quote.spender, collateralBudget: quotedPurchase.value.toString() }) },
				deadlineTimestamp: kind === 'create' ? mintDeadline(snapshot, pool, options) : undefined,
				postconditions: [kind === 'create' ? 'All three outcome share balances increase equally' : 'Pool collateral and wallet share balances decrease consistently'],
				risk: kind === 'create' ? 'medium' : 'low',
				snapshot,
				maximumCleanupTransactionCount: quotedPurchase === undefined ? undefined : 1,
				steps: [
					...(quotedPurchase !== undefined && allowance(tokenInventory(snapshot, snapshot.deployments.weth), quotedPurchase.quote.spender) < quotedPurchase.value
						? [
								encodeStep({
									abi: erc20Abi,
									args: [quotedPurchase.quote.spender, quotedPurchase.value],
									evidence: [erc20AllowanceEvidence(snapshot.deployments.weth, snapshot.wallet.address, quotedPurchase.quote.spender, quotedPurchase.value)],
									functionName: 'approve',
									id: 'approve-portfolio-collateral',
									label: 'Approve portfolio collateral',
									to: snapshot.deployments.weth,
								}),
							]
						: []),
					encodeStep({ abi: kind === 'create' ? securityPoolPortfolioAbi : securityPoolAbi, args, evidence: [eventEvidence(pool.address, signature)], functionName: method, id: method, label: method, to: kind === 'create' ? pool.portfolio : pool.address, value: 0n, walletAssetDebits }),
				],
			})
		},

		classification: 'selectable',
		contract: kind === 'create' ? 'SecurityPoolPortfolio' : 'SecurityPool',
		description: `Exercises the ${kind} complete-set/share workflow with wallet-owned inventory.`,
		discoveryInputs: ['share balances', 'pool lifecycle', 'wallet ETH'],
		ecosystem: 'statoblast',
		evaluate(snapshot, options) {
			if (kind === 'create') {
				return eligible(snapshot.pools.some(pool => purchase(snapshot, pool, options) !== undefined) ? undefined : 'No anchored portfolio purchase fits the WETH budget and ETH gas reserve')
			}
			const possible = snapshot.pools.some(pool => {
				const shares = snapshot.wallet.shares.find(candidate => candidate.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && candidate.universeId === pool.universeId)
				if (shares === undefined) return false
				if (kind === 'redeem') {
					const complete = [shares.invalid, shares.yes, shares.no].map(balance => amount(balance)).reduce((minimum, balance) => (balance < minimum ? balance : minimum))
					return pool.systemState === 0 && snapshot.universes.find(universe => universe.id === pool.universeId)?.forkTime === '0' && complete > 0n && sharesToEth(pool, complete) > 0n
				}
				const winningBalance = [shares.invalid, shares.yes, shares.no][pool.questionOutcome]
				return pool.systemState === 0 && pool.questionOutcome !== BINARY_OUTCOME_NONE && winningBalance !== undefined && amount(winningBalance) > 0n && sharesToEth(pool, amount(winningBalance)) > 0n
			})
			return eligible(possible ? undefined : 'No redeemable wallet shares')
		},
		id,
		label: kind,
		method,
		risk: kind === 'create' ? 'medium' : 'low',
	}
	if (kind === 'create') definition.buildContinuationPlan = (snapshot, options, context) => collateralSpendContinuation({ snapshot, options, context, buildPlan: definition.buildPlan, approvalId: 'approve-portfolio-collateral', actionId: method, label: 'Revoke portfolio collateral approval', risk: 'medium' })
	return definition
}
