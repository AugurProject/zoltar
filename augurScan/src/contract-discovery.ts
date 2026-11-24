import type { SystemContractKind } from './system-interfaces.ts'

type Discovery = { readonly argument: string; readonly kind: SystemContractKind; readonly label: string }
export const discoveries: Readonly<Record<string, readonly Discovery[]>> = {
	PairCreated: [{ argument: 'pair', kind: 'ammPair', label: 'Augur AMM Pair' }],
	DeployQuestionLedger: [
		{ argument: 'questionLedger', kind: 'questionLedger', label: 'Question Ledger' },
		{ argument: 'openOraclePriceCoordinator', kind: 'priceCoordinator', label: 'Price Coordinator' },
		{ argument: 'shareToken', kind: 'shareToken', label: 'Share Token' },
	],
	DeployChild: [{ argument: 'childReputationToken', kind: 'reputationToken', label: 'Child REP' }],
	SharedPriceFeedSet: [{ argument: 'priceFeed', kind: 'sharedPoolPriceFeed', label: 'Shared Pool Price Feed' }],
	SharedPriceFeedRegistered: [{ argument: 'priceFeed', kind: 'sharedPoolPriceFeed', label: 'Shared Pool Price Feed' }],
	EscalationGameSet: [{ argument: 'escalationGame', kind: 'escalationGame', label: 'Escalation Game' }],
}

export const dependencyDiscoveryKinds = {
	uniswapPair: 'uniswapV2Pair',
	uniswapPool: 'uniswapV3Pool',
} as const satisfies Readonly<Record<string, SystemContractKind>>

// Contracts with no address in any event argument. The indexer reads them from the security pool, its capital
// ledgers and its shared price feed (`indexer/security-pool-discovery.ts`) and authenticates each binding.
export const securityPoolComponentKinds = {
	securityPool: { kind: 'securityPool', label: 'Security Pool' },
	forkCoordinator: { kind: 'securityPoolForkCoordinator', label: 'Security Pool Fork Coordinator' },
	services: { kind: 'securityPoolServices', label: 'Security Pool Services' },
	settlement: { kind: 'securityPoolSettlement', label: 'Security Pool Settlement' },
	settlementBook: { kind: 'securityPoolSettlementBook', label: 'Security Pool Settlement Book' },
	reporterLedger: { kind: 'securityPoolReporterLedger', label: 'Security Pool Reporter Ledger' },
	capitalLedger: { kind: 'securityPoolCapitalLedger', label: 'Security Pool Capital Ledger' },
	commitmentIndex: { kind: 'securityPoolCommitmentIndex', label: 'Capital Commitment Index' },
	feeStreams: { kind: 'securityPoolCapitalFeeStreams', label: 'Capital Fee Streams' },
	securityPoolRepairAuction: { kind: 'securityPoolRepairAuction', label: 'Security Pool Collateral Repair Auction' },
	uniformPriceAuction: { kind: 'securityPoolUniformPriceRepairAuction', label: 'Uniform Price Auction' },
	reportEscrow: { kind: 'sharedPoolReportEscrow', label: 'Shared Report Escrow' },
} as const satisfies Readonly<Record<string, { readonly kind: SystemContractKind; readonly label: string }>>

// Registered so their addresses are labelled and their logs decoded, but never scanned by address. The commitment
// index and fee streams declare no events. A report escrow emits one event in its lifetime, in the transaction of
// the feed decision that registers it, so the receipt that transaction already supplies carries it; scanning a new
// address for every price report would grow the log filter without bound.
export const receiptOnlyContractKinds: ReadonlySet<string> = new Set<SystemContractKind>([securityPoolComponentKinds.commitmentIndex.kind, securityPoolComponentKinds.feeStreams.kind, securityPoolComponentKinds.reportEscrow.kind])

export const discoveredContractKinds: readonly SystemContractKind[] = [...new Set<SystemContractKind>([...Object.values(discoveries).flatMap(rules => rules.map(rule => rule.kind)), ...Object.values(dependencyDiscoveryKinds), ...Object.values(securityPoolComponentKinds).map(component => component.kind)])]
