import type { SystemContractKind } from './system-interfaces.ts'

type Discovery = { readonly argument: string; readonly kind: SystemContractKind; readonly label: string }
export const discoveries: Readonly<Record<string, readonly Discovery[]>> = {
	PairCreated: [{ argument: 'pair', kind: 'ammPair', label: 'Augur AMM Pair' }],
	DeploySecurityPool: [
		{ argument: 'securityPool', kind: 'securityPool', label: 'Security Pool' },
		{ argument: 'truthAuction', kind: 'truthAuction', label: 'Truth Auction' },
		{ argument: 'priceOracleManagerAndOperatorQueuer', kind: 'priceCoordinator', label: 'Price Coordinator' },
		{ argument: 'shareToken', kind: 'shareToken', label: 'Share Token' },
	],
	DeployChild: [{ argument: 'childReputationToken', kind: 'reputationToken', label: 'Child REP' }],
	EscalationGameSet: [{ argument: 'escalationGame', kind: 'escalationGame', label: 'Escalation Game' }],
}

export const dependencyDiscoveryKinds = {
	uniswapPair: 'uniswapV2Pair',
	uniswapPool: 'uniswapV3Pool',
	liquidationApprovalRegistry: 'liquidationApprovalRegistry',
} as const satisfies Readonly<Record<string, SystemContractKind>>

export const discoveredContractKinds = [...new Set([...Object.values(discoveries).flatMap(rules => rules.map(rule => rule.kind)), ...Object.values(dependencyDiscoveryKinds)])]
