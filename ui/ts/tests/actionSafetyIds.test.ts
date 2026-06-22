import { describe, expect, test } from 'bun:test'
import {
	DEPLOYMENT_STEP_SAFETY_IDS,
	FORK_AUCTION_ACTION_SAFETY_IDS,
	OPEN_ORACLE_ACTION_SAFETY_IDS,
	REPORTING_ACTION_SAFETY_IDS,
	SECURITY_POOL_OVERVIEW_ACTION_SAFETY_IDS,
	SECURITY_VAULT_ACTION_SAFETY_IDS,
	TRADING_ACTION_SAFETY_IDS,
	getDeploymentStepSafetyId,
	getForkAuctionActionSafetyId,
	getOpenOracleActionSafetyId,
	getReportingActionSafetyId,
	getSecurityPoolOverviewActionSafetyId,
	getSecurityVaultActionSafetyId,
	getTradingActionSafetyId,
} from '../lib/actionSafety/ids.js'

describe('action safety id helpers', () => {
	test('map deployment steps to stable ids', () => {
		expect(getDeploymentStepSafetyId('proxyDeployer')).toBe(DEPLOYMENT_STEP_SAFETY_IDS.proxyDeployer)
		expect(getDeploymentStepSafetyId('deploymentStatusOracle')).toBe(DEPLOYMENT_STEP_SAFETY_IDS.deploymentStatusOracle)
		expect(getDeploymentStepSafetyId('multicall3')).toBe(DEPLOYMENT_STEP_SAFETY_IDS.multicall3)
		expect(getDeploymentStepSafetyId('uniformPriceDualCapBatchAuctionFactory')).toBe(DEPLOYMENT_STEP_SAFETY_IDS.uniformPriceDualCapBatchAuctionFactory)
		expect(getDeploymentStepSafetyId('scalarOutcomes')).toBe(DEPLOYMENT_STEP_SAFETY_IDS.scalarOutcomes)
		expect(getDeploymentStepSafetyId('securityPoolUtils')).toBe(DEPLOYMENT_STEP_SAFETY_IDS.securityPoolUtils)
		expect(getDeploymentStepSafetyId('openOracle')).toBe(DEPLOYMENT_STEP_SAFETY_IDS.openOracle)
		expect(getDeploymentStepSafetyId('zoltarQuestionData')).toBe(DEPLOYMENT_STEP_SAFETY_IDS.zoltarQuestionData)
		expect(getDeploymentStepSafetyId('zoltar')).toBe(DEPLOYMENT_STEP_SAFETY_IDS.zoltar)
		expect(getDeploymentStepSafetyId('shareTokenFactory')).toBe(DEPLOYMENT_STEP_SAFETY_IDS.shareTokenFactory)
		expect(getDeploymentStepSafetyId('priceOracleManagerAndOperatorQueuerFactory')).toBe(DEPLOYMENT_STEP_SAFETY_IDS.priceOracleManagerAndOperatorQueuerFactory)
		expect(getDeploymentStepSafetyId('securityPoolForker')).toBe(DEPLOYMENT_STEP_SAFETY_IDS.securityPoolForker)
		expect(getDeploymentStepSafetyId('escalationGameFactory')).toBe(DEPLOYMENT_STEP_SAFETY_IDS.escalationGameFactory)
		expect(getDeploymentStepSafetyId('securityPoolFactory')).toBe(DEPLOYMENT_STEP_SAFETY_IDS.securityPoolFactory)
	})

	test('map open oracle actions to stable ids', () => {
		expect(getOpenOracleActionSafetyId('approveToken1')).toBe(OPEN_ORACLE_ACTION_SAFETY_IDS.approveToken1)
		expect(getOpenOracleActionSafetyId('approveToken2')).toBe(OPEN_ORACLE_ACTION_SAFETY_IDS.approveToken2)
		expect(getOpenOracleActionSafetyId('createReportInstance')).toBe(OPEN_ORACLE_ACTION_SAFETY_IDS.createReportInstance)
		expect(getOpenOracleActionSafetyId('dispute')).toBe(OPEN_ORACLE_ACTION_SAFETY_IDS.dispute)
		expect(getOpenOracleActionSafetyId('executeStagedOperation')).toBe(OPEN_ORACLE_ACTION_SAFETY_IDS.executeStagedOperation)
		expect(getOpenOracleActionSafetyId('queueOperation')).toBe(OPEN_ORACLE_ACTION_SAFETY_IDS.queueOperation)
		expect(getOpenOracleActionSafetyId('requestPrice')).toBe(OPEN_ORACLE_ACTION_SAFETY_IDS.requestPrice)
		expect(getOpenOracleActionSafetyId('settle')).toBe(OPEN_ORACLE_ACTION_SAFETY_IDS.settle)
		expect(getOpenOracleActionSafetyId('submitInitialReport')).toBe(OPEN_ORACLE_ACTION_SAFETY_IDS.submitInitialReport)
		expect(getOpenOracleActionSafetyId('wrapWeth')).toBe(OPEN_ORACLE_ACTION_SAFETY_IDS.wrapWeth)
	})

	test('map reporting actions to stable ids', () => {
		expect(getReportingActionSafetyId('reportOutcome')).toBe(REPORTING_ACTION_SAFETY_IDS.reportOutcome)
		expect(getReportingActionSafetyId('withdrawEscalation')).toBe(REPORTING_ACTION_SAFETY_IDS.withdrawEscalation)
	})

	test('map security pool actions to stable ids', () => {
		expect(getSecurityPoolOverviewActionSafetyId('queueLiquidation')).toBe(SECURITY_POOL_OVERVIEW_ACTION_SAFETY_IDS.queueLiquidation)
	})

	test('map security vault actions to stable ids', () => {
		expect(getSecurityVaultActionSafetyId('approveRep')).toBe(SECURITY_VAULT_ACTION_SAFETY_IDS.approveRep)
		expect(getSecurityVaultActionSafetyId('depositRep')).toBe(SECURITY_VAULT_ACTION_SAFETY_IDS.depositRep)
		expect(getSecurityVaultActionSafetyId('queueSetSecurityBondAllowance')).toBe(SECURITY_VAULT_ACTION_SAFETY_IDS.queueSetSecurityBondAllowance)
		expect(getSecurityVaultActionSafetyId('queueWithdrawRep')).toBe(SECURITY_VAULT_ACTION_SAFETY_IDS.queueWithdrawRep)
		expect(getSecurityVaultActionSafetyId('redeemFees')).toBe(SECURITY_VAULT_ACTION_SAFETY_IDS.redeemFees)
		expect(getSecurityVaultActionSafetyId('redeemRep')).toBe(SECURITY_VAULT_ACTION_SAFETY_IDS.redeemRep)
		expect(getSecurityVaultActionSafetyId('updateVaultFees')).toBe(SECURITY_VAULT_ACTION_SAFETY_IDS.updateVaultFees)
	})

	test('map trading actions to stable ids', () => {
		expect(getTradingActionSafetyId('createCompleteSet')).toBe(TRADING_ACTION_SAFETY_IDS.createCompleteSet)
		expect(getTradingActionSafetyId('migrateShares')).toBe(TRADING_ACTION_SAFETY_IDS.migrateShares)
		expect(getTradingActionSafetyId('redeemCompleteSet')).toBe(TRADING_ACTION_SAFETY_IDS.redeemCompleteSet)
		expect(getTradingActionSafetyId('redeemShares')).toBe(TRADING_ACTION_SAFETY_IDS.redeemShares)
	})

	test('map fork auction actions to stable ids', () => {
		expect(getForkAuctionActionSafetyId('claimAuctionProceeds')).toBe(FORK_AUCTION_ACTION_SAFETY_IDS.claimAuctionProceeds)
		expect(getForkAuctionActionSafetyId('createChildUniverse')).toBe(FORK_AUCTION_ACTION_SAFETY_IDS.createChildUniverse)
		expect(getForkAuctionActionSafetyId('finalizeTruthAuction')).toBe(FORK_AUCTION_ACTION_SAFETY_IDS.finalizeTruthAuction)
		expect(getForkAuctionActionSafetyId('forkUniverse')).toBe(FORK_AUCTION_ACTION_SAFETY_IDS.forkUniverse)
		expect(getForkAuctionActionSafetyId('forkWithOwnEscalation')).toBe(FORK_AUCTION_ACTION_SAFETY_IDS.forkWithOwnEscalation)
		expect(getForkAuctionActionSafetyId('initiateFork')).toBe(FORK_AUCTION_ACTION_SAFETY_IDS.initiateFork)
		expect(getForkAuctionActionSafetyId('migrateEscalationDeposits')).toBe(FORK_AUCTION_ACTION_SAFETY_IDS.migrateEscalationDeposits)
		expect(getForkAuctionActionSafetyId('migrateRepToZoltar')).toBe(FORK_AUCTION_ACTION_SAFETY_IDS.migrateRepToZoltar)
		expect(getForkAuctionActionSafetyId('migrateUnresolvedEscalation')).toBe(FORK_AUCTION_ACTION_SAFETY_IDS.migrateUnresolvedEscalation)
		expect(getForkAuctionActionSafetyId('migrateVault')).toBe(FORK_AUCTION_ACTION_SAFETY_IDS.migrateVault)
		expect(getForkAuctionActionSafetyId('refundLosingBids')).toBe(FORK_AUCTION_ACTION_SAFETY_IDS.refundLosingBids)
		expect(getForkAuctionActionSafetyId('settleForkedEscalation')).toBe(FORK_AUCTION_ACTION_SAFETY_IDS.settleForkedEscalation)
		expect(getForkAuctionActionSafetyId('startTruthAuction')).toBe(FORK_AUCTION_ACTION_SAFETY_IDS.startTruthAuction)
		expect(getForkAuctionActionSafetyId('submitBid')).toBe(FORK_AUCTION_ACTION_SAFETY_IDS.submitBid)
	})
})
