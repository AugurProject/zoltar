import { portfolioMintFee, portfolioMintWithinBudget, type PortfolioMintFees } from '@zoltar/trading-shared/trading/portfolioMint'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { loadCentralPortfolioQuestion } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolioState.js'
import type { PublicClient } from '@zoltar/core-shared/evm/ethereum'
import type { LiveMarket } from './liveMarket.js'

export async function loadMintFees(client: PublicClient, central: Awaited<ReturnType<typeof loadCentralPortfolioQuestion>>, blockNumber: bigint) {
	const target = { abi: portfolioArtifact.abi, address: central.portfolioAddress, blockNumber }
	const [securityMultiplierBps, purchaseFeeBps, minimumPurchaseFeeAttoEth, annualFeeBps] = await Promise.all([
		client.readContract({ ...target, functionName: 'statoblastSecurityMultiplierBps' }),
		client.readContract({ ...target, functionName: 'purchaseFeeBps' }),
		client.readContract({ ...target, functionName: 'minimumPurchaseFeeAttoEth' }),
		client.readContract({ ...target, functionName: 'annualFeeBps' }),
	])
	return { securityMultiplierBps, purchaseFeeBps, minimumPurchaseFeeAttoEth, annualFeeBps, feePrincipalAttoEth: central.feePrincipalAttoEth }
}

function mintWithMargin(budget: bigint, state: PortfolioMintFees) {
	const maximum = portfolioMintWithinBudget(budget, state)
	if (maximum === 0n) return 0n
	// Keep one percent of the fee available for accrual before mining. The router
	// refunds everything it does not spend; the user's total ETH ceiling is unchanged.
	const margin = (portfolioMintFee(maximum, state) + 99n) / 100n
	return portfolioMintWithinBudget(budget > margin ? budget - margin : 0n, state)
}

export function estimateBudgetMint(market: Pick<LiveMarket, 'mintFees' | 'settlementCollateralAttoEth' | 'shareTokenSupplyAttoShares'>, budget: bigint) {
	if (market.mintFees === undefined) return undefined
	return mintWithMargin(budget, { ...market.mintFees, cashAttoEth: market.settlementCollateralAttoEth, outcomeSupplyAttoShares: market.shareTokenSupplyAttoShares })
}

export async function loadBudgetMint(client: PublicClient, market: LiveMarket, budget: bigint, blockNumber: bigint) {
	const capital = await client.readContract({ abi: poolArtifact.abi, address: market.pool, functionName: 'portfolioCustody', blockNumber })
	const central = await loadCentralPortfolioQuestion(client, market.pool, capital, blockNumber)
	const fees = await loadMintFees(client, central, blockNumber)
	const cash = mintWithMargin(budget, { ...fees, cashAttoEth: central.settlementCollateralAttoEth, outcomeSupplyAttoShares: central.shareTokenSupplyAttoShares })
	if (cash === 0n) throw new Error('ETH budget is too small to cover the portfolio purchase fee')
	return cash
}
