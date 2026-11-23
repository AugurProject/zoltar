import { recoveryRepPurchase } from '../copy/marketBlockers.js'
import { securityPoolMintFee, securityPoolMintWithinBudget, type SecurityPoolMintFees } from '@zoltar/trading-shared/trading/securityPoolMint'
import { statoblast_SecurityPool_SecurityPool as securityPoolArtifact, statoblast_QuestionLedger_QuestionLedger as poolArtifact } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { loadCentralSecurityPoolQuestion } from '@zoltar/ui-statoblast-shared/protocol/securityPoolState.js'
import type { PublicClient } from '@zoltar/core-shared/evm/ethereum'
import type { LiveMarket } from './liveMarket.js'

export async function loadMintFees(client: PublicClient, central: Awaited<ReturnType<typeof loadCentralSecurityPoolQuestion>>, blockNumber: bigint) {
	const target = { abi: securityPoolArtifact.abi, address: central.securityPoolAddress, blockNumber }
	const [securityMultiplierBps, purchaseFeeBps, minimumPurchaseFeeAttoEth, annualFeeBps] = await Promise.all([
		client.readContract({ ...target, functionName: 'statoblastSecurityMultiplierBps' }),
		client.readContract({ ...target, functionName: 'purchaseFeeBps' }),
		client.readContract({ ...target, functionName: 'minimumPurchaseFeeAttoEth' }),
		client.readContract({ ...target, functionName: 'annualFeeBps' }),
	])
	return { securityMultiplierBps, purchaseFeeBps, minimumPurchaseFeeAttoEth, annualFeeBps, feePrincipalAttoEth: central.feePrincipalAttoEth }
}

function mintWithMargin(budget: bigint, state: SecurityPoolMintFees) {
	const maximum = securityPoolMintWithinBudget(budget, state)
	if (maximum === 0n) return 0n
	// Keep one percent of the fee available for accrual before mining. The router
	// refunds everything it does not spend; the user's total ETH ceiling is unchanged.
	const margin = (securityPoolMintFee(maximum, state) + 99n) / 100n
	return securityPoolMintWithinBudget(budget > margin ? budget - margin : 0n, state)
}

export function recoveryMintBlocker(market: Pick<LiveMarket, 'settlementRecoveryAttoRep'>) {
	return (market.settlementRecoveryAttoRep ?? 0n) > 0n ? recoveryRepPurchase : undefined
}

export function estimateBudgetMint(market: Pick<LiveMarket, 'mintFees' | 'settlementCollateralAttoEth' | 'shareTokenSupplyAttoShares' | 'settlementRecoveryAttoRep'>, budget: bigint) {
	if (market.mintFees === undefined || recoveryMintBlocker(market) !== undefined) return undefined
	return mintWithMargin(budget, { ...market.mintFees, cashAttoEth: market.settlementCollateralAttoEth, outcomeSupplyAttoShares: market.shareTokenSupplyAttoShares })
}

export async function loadBudgetMint(client: PublicClient, market: LiveMarket, budget: bigint, blockNumber: bigint) {
	const capital = await client.readContract({ abi: poolArtifact.abi, address: market.pool, functionName: 'securityPoolCustody', blockNumber })
	const central = await loadCentralSecurityPoolQuestion(client, market.pool, capital, blockNumber)
	if (central.settlementRecoveryAttoRep > 0n) throw new Error(recoveryRepPurchase)
	const fees = await loadMintFees(client, central, blockNumber)
	const cash = mintWithMargin(budget, { ...fees, cashAttoEth: central.settlementCollateralAttoEth, outcomeSupplyAttoShares: central.shareTokenSupplyAttoShares })
	if (cash === 0n) throw new Error('ETH budget is too small to cover the portfolio purchase fee')
	const recovery = await client.readContract({ abi: securityPoolArtifact.abi, address: central.securityPoolAddress, functionName: 'quoteMintRecoveryRep', args: [market.universeId, market.questionId, cash], blockNumber })
	if (recovery > 0n) throw new Error(recoveryRepPurchase)
	return cash
}
