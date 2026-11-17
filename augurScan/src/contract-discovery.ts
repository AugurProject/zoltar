import type { SystemContractKind } from './system-interfaces.ts'

type Discovery = { readonly argument: string; readonly kind: SystemContractKind; readonly label: string }
export const discoveries: Readonly<Record<string, readonly Discovery[]>> = {
	PairCreated: [{ argument: 'pair', kind: 'ammPair', label: 'Augur AMM Pair' }],
	DeploySecurityPool: [
		{ argument: 'securityPool', kind: 'securityPool', label: 'Security Pool' },
		{ argument: 'openOraclePriceCoordinator', kind: 'priceCoordinator', label: 'Price Coordinator' },
		{ argument: 'shareToken', kind: 'shareToken', label: 'Share Token' },
	],
	DeployChild: [{ argument: 'childReputationToken', kind: 'reputationToken', label: 'Child REP' }],
	SharedPriceFeedSet: [{ argument: 'priceFeed', kind: 'sharedPoolPriceFeed', label: 'Shared Pool Price Feed' }],
	EscalationGameSet: [{ argument: 'escalationGame', kind: 'escalationGame', label: 'Escalation Game' }],
}

export const dependencyDiscoveryKinds = {
	uniswapPair: 'uniswapV2Pair',
	uniswapPool: 'uniswapV3Pool',
} as const satisfies Readonly<Record<string, SystemContractKind>>

// Contracts with no address in any event argument. The indexer reads them from the portfolio, its capital
// ledgers and its shared price feed (`indexer/portfolio-discovery.ts`) and authenticates each binding.
export const portfolioComponentKinds = {
	portfolio: { kind: 'securityPoolPortfolio', label: 'Security Portfolio' },
	forkCoordinator: { kind: 'securityPoolPortfolioForkCoordinator', label: 'Portfolio Fork Coordinator' },
	services: { kind: 'securityPoolPortfolioServices', label: 'Portfolio Services' },
	settlement: { kind: 'securityPoolPortfolioSettlement', label: 'Portfolio Settlement' },
	settlementBook: { kind: 'securityPoolSettlementBook', label: 'Portfolio Settlement Book' },
	reporterLedger: { kind: 'securityPoolReporterLedger', label: 'Portfolio Reporter Ledger' },
	capitalLedger: { kind: 'securityPoolCapitalLedger', label: 'Portfolio Capital Ledger' },
	commitmentIndex: { kind: 'securityPoolCommitmentIndex', label: 'Capital Commitment Index' },
	feeStreams: { kind: 'securityPoolCapitalFeeStreams', label: 'Capital Fee Streams' },
	portfolioAuction: { kind: 'securityPoolPortfolioAuction', label: 'Portfolio Collateral Repair Auction' },
	uniformPriceAuction: { kind: 'securityPoolUniformPriceAuction', label: 'Uniform Price Auction' },
	reportEscrow: { kind: 'sharedPoolReportEscrow', label: 'Shared Report Escrow' },
} as const satisfies Readonly<Record<string, { readonly kind: SystemContractKind; readonly label: string }>>

// Registered so their addresses are labelled and their logs decoded, but never scanned by address. The commitment
// index and fee streams declare no events. A report escrow emits one event in its lifetime, in the transaction of
// the feed decision that registers it, so the receipt that transaction already supplies carries it; scanning a new
// address for every price report would grow the log filter without bound.
export const receiptOnlyContractKinds: ReadonlySet<string> = new Set<SystemContractKind>([portfolioComponentKinds.commitmentIndex.kind, portfolioComponentKinds.feeStreams.kind, portfolioComponentKinds.reportEscrow.kind])

export const discoveredContractKinds: readonly SystemContractKind[] = [...new Set<SystemContractKind>([...Object.values(discoveries).flatMap(rules => rules.map(rule => rule.kind)), ...Object.values(dependencyDiscoveryKinds), ...Object.values(portfolioComponentKinds).map(component => component.kind)])]
