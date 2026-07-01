import type { DeploymentStepId, ForkAuctionAction, OpenOracleActionResult, ReportingActionResult, SecurityPoolOverviewActionResult, SecurityVaultActionResult, TradingActionResult } from '../../types/contracts.js'

export const ACTION_SAFETY_IDS = [
	'child-universe.deploy',
	'deployment.deployNextMissing',
	'deployment.step.deploymentStatusOracle',
	'deployment.step.escalationGameFactory',
	'deployment.step.multicall3',
	'deployment.step.openOracle',
	'deployment.step.priceOracleManagerAndOperatorQueuerFactory',
	'deployment.step.proxyDeployer',
	'deployment.step.scalarOutcomes',
	'deployment.step.securityPoolFactory',
	'deployment.step.securityPoolForker',
	'deployment.step.securityPoolUtils',
	'deployment.step.shareTokenFactory',
	'deployment.step.uniformPriceDualCapBatchAuctionFactory',
	'deployment.step.zoltar',
	'deployment.step.zoltarQuestionData',
	'market.createQuestion',
	'fork-auction.claimAuctionProceeds',
	'fork-auction.createChildUniverse',
	'fork-auction.finalizeTruthAuction',
	'fork-auction.forkZoltar',
	'fork-auction.forkUniverse',
	'fork-auction.forkWithOwnEscalation',
	'fork-auction.initiateFork',
	'fork-auction.migrateEscalationDeposits',
	'fork-auction.migrateRepToZoltar',
	'fork-auction.migrateUnresolvedEscalation',
	'fork-auction.migrateVault',
	'fork-auction.refundLosingBids',
	'fork-auction.settleAuctionRefunds',
	'fork-auction.settleForkedEscalation',
	'fork-auction.startTruthAuction',
	'fork-auction.submitBid',
	'open-oracle.approveToken1',
	'open-oracle.approveToken2',
	'open-oracle.createReportInstance',
	'open-oracle.dispute',
	'open-oracle.executeStagedOperation',
	'open-oracle.queueOperation',
	'open-oracle.readOnly',
	'open-oracle.requestPrice',
	'open-oracle.settle',
	'open-oracle.submitInitialReport',
	'open-oracle.wrapWeth',
	'reporting.reportOutcome',
	'reporting.triggerZoltarFork',
	'reporting.withdrawEscalation',
	'security-pool.createPool',
	'security-pool.executeStagedOperation',
	'security-pool.queueLiquidation',
	'security-pool.requestPrice',
	'security-vault.approveRep',
	'security-vault.depositRep',
	'security-vault.executeStagedOperation',
	'security-vault.queueSetSecurityBondAllowance',
	'security-vault.queueWithdrawRep',
	'security-vault.readOnly',
	'security-vault.redeemFees',
	'security-vault.redeemRep',
	'security-vault.requestPrice',
	'trading.createCompleteSet',
	'trading.migrateShares',
	'trading.redeemCompleteSet',
	'trading.redeemShares',
	'zoltar.approveForkRep',
	'zoltar.forkZoltar',
	'zoltar-migration.prepareRep',
	'zoltar-migration.splitRep',
] as const

export type ActionSafetyId = (typeof ACTION_SAFETY_IDS)[number]

export const DEPLOYMENT_STEP_SAFETY_IDS: Record<DeploymentStepId, ActionSafetyId> = {
	proxyDeployer: 'deployment.step.proxyDeployer',
	deploymentStatusOracle: 'deployment.step.deploymentStatusOracle',
	multicall3: 'deployment.step.multicall3',
	uniformPriceDualCapBatchAuctionFactory: 'deployment.step.uniformPriceDualCapBatchAuctionFactory',
	scalarOutcomes: 'deployment.step.scalarOutcomes',
	securityPoolUtils: 'deployment.step.securityPoolUtils',
	openOracle: 'deployment.step.openOracle',
	zoltarQuestionData: 'deployment.step.zoltarQuestionData',
	zoltar: 'deployment.step.zoltar',
	shareTokenFactory: 'deployment.step.shareTokenFactory',
	priceOracleManagerAndOperatorQueuerFactory: 'deployment.step.priceOracleManagerAndOperatorQueuerFactory',
	securityPoolForker: 'deployment.step.securityPoolForker',
	escalationGameFactory: 'deployment.step.escalationGameFactory',
	securityPoolFactory: 'deployment.step.securityPoolFactory',
}

export const OPEN_ORACLE_ACTION_SAFETY_IDS: Record<OpenOracleActionResult['action'], ActionSafetyId> = {
	approveToken1: 'open-oracle.approveToken1',
	approveToken2: 'open-oracle.approveToken2',
	createReportInstance: 'open-oracle.createReportInstance',
	dispute: 'open-oracle.dispute',
	executeStagedOperation: 'open-oracle.executeStagedOperation',
	queueOperation: 'open-oracle.queueOperation',
	requestPrice: 'open-oracle.requestPrice',
	settle: 'open-oracle.settle',
	submitInitialReport: 'open-oracle.submitInitialReport',
	wrapWeth: 'open-oracle.wrapWeth',
}

export const REPORTING_ACTION_SAFETY_IDS: Record<ReportingActionResult['action'], ActionSafetyId> = {
	reportOutcome: 'reporting.reportOutcome',
	withdrawEscalation: 'reporting.withdrawEscalation',
}

export const SECURITY_POOL_OVERVIEW_ACTION_SAFETY_IDS: Record<SecurityPoolOverviewActionResult['action'], ActionSafetyId> = {
	queueLiquidation: 'security-pool.queueLiquidation',
}

export const SECURITY_VAULT_ACTION_SAFETY_IDS: Record<SecurityVaultActionResult['action'], ActionSafetyId> = {
	approveRep: 'security-vault.approveRep',
	depositRep: 'security-vault.depositRep',
	queueSetSecurityBondAllowance: 'security-vault.queueSetSecurityBondAllowance',
	queueWithdrawRep: 'security-vault.queueWithdrawRep',
	redeemFees: 'security-vault.redeemFees',
	redeemRep: 'security-vault.redeemRep',
	updateVaultFees: 'security-vault.executeStagedOperation',
}

export const TRADING_ACTION_SAFETY_IDS: Record<TradingActionResult['action'], ActionSafetyId> = {
	createCompleteSet: 'trading.createCompleteSet',
	migrateShares: 'trading.migrateShares',
	redeemCompleteSet: 'trading.redeemCompleteSet',
	redeemShares: 'trading.redeemShares',
}

export const FORK_AUCTION_ACTION_SAFETY_IDS: Record<ForkAuctionAction, ActionSafetyId> = {
	createChildUniverse: 'child-universe.deploy',
	finalizeTruthAuction: 'fork-auction.finalizeTruthAuction',
	forkUniverse: 'fork-auction.forkUniverse',
	forkWithOwnEscalation: 'fork-auction.forkWithOwnEscalation',
	claimAuctionProceeds: 'fork-auction.claimAuctionProceeds',
	initiateFork: 'fork-auction.initiateFork',
	migrateEscalationDeposits: 'fork-auction.migrateEscalationDeposits',
	migrateRepToZoltar: 'fork-auction.migrateRepToZoltar',
	migrateUnresolvedEscalation: 'fork-auction.migrateUnresolvedEscalation',
	migrateVault: 'fork-auction.migrateVault',
	refundLosingBids: 'fork-auction.refundLosingBids',
	settleForkedEscalation: 'fork-auction.settleForkedEscalation',
	startTruthAuction: 'fork-auction.startTruthAuction',
	submitBid: 'fork-auction.submitBid',
}

export function getDeploymentStepSafetyId(stepId: DeploymentStepId): ActionSafetyId {
	return DEPLOYMENT_STEP_SAFETY_IDS[stepId]
}

export function getOpenOracleActionSafetyId(action: OpenOracleActionResult['action']): ActionSafetyId {
	return OPEN_ORACLE_ACTION_SAFETY_IDS[action]
}

export function getReportingActionSafetyId(action: ReportingActionResult['action']): ActionSafetyId {
	return REPORTING_ACTION_SAFETY_IDS[action]
}

export function getSecurityPoolOverviewActionSafetyId(action: SecurityPoolOverviewActionResult['action']): ActionSafetyId {
	return SECURITY_POOL_OVERVIEW_ACTION_SAFETY_IDS[action]
}

export function getSecurityVaultActionSafetyId(action: SecurityVaultActionResult['action']): ActionSafetyId {
	return SECURITY_VAULT_ACTION_SAFETY_IDS[action]
}

export function getTradingActionSafetyId(action: TradingActionResult['action']): ActionSafetyId {
	return TRADING_ACTION_SAFETY_IDS[action]
}

export function getForkAuctionActionSafetyId(action: ForkAuctionAction): ActionSafetyId {
	return FORK_AUCTION_ACTION_SAFETY_IDS[action]
}
