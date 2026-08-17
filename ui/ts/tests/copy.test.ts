import { expect, test } from 'bun:test'
import * as forkAuctionCopy from '../copy/forkAuction.js'
import * as appCopy from '../copy/app.js'
import * as commonCopy from '../copy/common.js'
import * as marketCopy from '../copy/market.js'
import * as liquidationCopy from '../copy/liquidation.js'
import * as openOracleCopy from '../copy/openOracle.js'
import * as reportingCopy from '../copy/reporting.js'
import * as securityPoolCopy from '../copy/securityPool.js'
import * as simulationCopy from '../copy/simulation.js'
import * as tradingCopy from '../copy/trading.js'
import * as zoltarCopy from '../copy/zoltar.js'

test('fork migration empty states are complete templates', () => {
	expect(forkAuctionCopy.formatNoUnresolvedDeposits('yes')).toBe('No yes unresolved deposits remain for this wallet.')
	expect(forkAuctionCopy.formatNoClaimableParentEscalationDeposits('Yes')).toBe('No Yes parent escalation deposits are currently available for a direct claim by this wallet.')
	expect(forkAuctionCopy.parentEscalationClaimEmptyDisputeStakedRepDetail).toBe('No parent dispute-staked REP is currently visible for a direct claim by the connected wallet.')
	expect(forkAuctionCopy.parentEscalationClaimEmptyDisputeStakedRepDetail).not.toMatch(/migrat/i)
})

test('vault operation and fork migration copy uses accounting roles without promising queueing', () => {
	expect(securityPoolCopy.settingCapacityOwnership).toBe('Setting capacity ownership…')
	expect(securityPoolCopy.withdrawingRep).toBe('Withdrawing REP…')
	expect(forkAuctionCopy.selectedChildPoolRepReadinessLoading).toContain('pool-held REP')
	expect(forkAuctionCopy.poolRepAlreadyMigratedDetail).toContain('Pool-held REP')
	expect(forkAuctionCopy.poolRepStagedForVaultMigrationDetail).toContain('Pool-held REP')
})

test('truth-auction settlement copy identifies REP backing-unit credits', () => {
	const capacityOwnership = 'auctioned capacity ownership'
	const settlementCopy = [
		forkAuctionCopy.formatWinningClaimCapacityOwnershipHeadline(capacityOwnership),
		forkAuctionCopy.formatWinningClaimSettlementNotice(capacityOwnership),
		forkAuctionCopy.formatMixedSettlementPreviewDetail(capacityOwnership),
		forkAuctionCopy.formatWinningSettlementPreviewDetail(capacityOwnership),
		forkAuctionCopy.formatWinningBidBatchSettlementDetail(capacityOwnership),
		forkAuctionCopy.formatMixedBidBatchSettlementDetail(capacityOwnership),
		forkAuctionCopy.formatFinalizedSettlementDetail(capacityOwnership),
		forkAuctionCopy.formatStartTruthAuctionDetail(capacityOwnership),
	]
	for (const copy of settlementCopy) expect(copy).toContain('REP backing units')
	expect(forkAuctionCopy.estimatedVaultRepBackingAttoRep).toBe('Estimated REP backing')
})

test('security-pool count summaries own their complete prose', () => {
	expect(securityPoolCopy.formatVaultDirectorySummary(3n, 8n)).toBe('Showing 3 current positions from 8 known vaults, newest-registered first.')
	expect(securityPoolCopy.vaultRegistryScanCapped).toBe('Registry scan limit reached. Some current positions may not be shown.')
	expect(securityPoolCopy.vaultRegistryScanEmpty).toBe('No current positions found within the scan limit.')
	expect(securityPoolCopy.formatNoCurrentVaultPositions(1n)).toBe('No current positions among 1 known vault.')
	expect(securityPoolCopy.formatNoCurrentVaultPositions(3n)).toBe('No current positions among 3 known vaults.')
})

test('reporting risk copy keeps escalation claims with their committed depositor', () => {
	expect(reportingCopy.escalationClaimNonTradeableDetail).toContain('remain with their committed depositor through liquidation')
	expect(reportingCopy.escalationClaimNonTradeableDetail).toContain('truth auction can proportionally reduce both principal and reward')
	expect(reportingCopy.escalationClaimNonTradeableDetail).not.toContain('can move')
})

test('market and Open Oracle values own their complete spacing and units', () => {
	expect(marketCopy.selectedForkQuestionSummary).toBe('Selected fork question')
	expect(openOracleCopy.formatTimingValue(12n, openOracleCopy.secondsAbbreviation)).toBe('12\u00a0s')
	expect(openOracleCopy.formatTimingValue(12n, openOracleCopy.blocks)).toBe('12\u00a0blocks')
})

test('dynamic value and unit copy uses nonbreaking separators', () => {
	expect(commonCopy.formatApproveTokenAmount('12', 'ETH')).toBe('Approve 12\u00a0ETH')
	expect(zoltarCopy.formatAddMigrationRepDetail('12')).toContain('12\u00a0REP')
	expect(zoltarCopy.formatMigrationRepShortfall('12')).toContain('12\u00a0more\u00a0REP')
	expect(zoltarCopy.formatMigrationPreparationRequired('12')).toContain('12\u00a0REP')
	expect(zoltarCopy.formatSplitCapacityDetail('12')).toContain('12\u00a0REP')
	expect(zoltarCopy.formatMigrationBalanceExceeded('12', '8', '4')).toContain('12\u00a0REP')
	expect(zoltarCopy.formatMigrationBalanceExceeded('12', '8', '4')).toContain('4\u00a0wallet\u00a0REP')
	expect(securityPoolCopy.formatInsufficientRepBalanceDetail('12')).toContain('12\u00a0REP')
	expect(forkAuctionCopy.formatEthPerRepValue('12')).toBe('12\u00a0ETH / REP')
	expect(forkAuctionCopy.formatSelectPriceValueEthRepFromDepthChart('12')).toContain('12\u00a0ETH / REP')
	expect(forkAuctionCopy.zeroEth).toBe('0\u00a0ETH')
})

test('transaction actions and pending labels use sentence case independently of titles', () => {
	expect(marketCopy.createQuestionPendingLabel).toBe('Creating question…')
	expect(appCopy.changeWallet).toBe('Change wallet')
	expect(appCopy.switchToEthereumMainnet).toBe('Switch to Ethereum mainnet')
	expect(marketCopy.alreadyForked).toBe('Already forked')
	expect(liquidationCopy.executeVaultLiquidation).toBe('Execute vault liquidation')
	expect(liquidationCopy.executeVaultLiquidationTitle).toBe('Execute Vault Liquidation')
	expect(liquidationCopy.queueLiquidation).toBe('Queue liquidation')
	expect(liquidationCopy.queueVaultLiquidation).toBe('Queue Vault Liquidation')
	expect(liquidationCopy.liquidateVault).toBe('Liquidate vault')
	expect(liquidationCopy.liquidateVaultTitle).toBe('Liquidate Vault')
	expect(reportingCopy.reportOnSelectedSide).toBe('Report on selected side')
	expect(reportingCopy.triggerZoltarFork).toBe('Trigger universe fork')
	expect(reportingCopy.formatSettleSelectedDepositsLabel('Yes')).toBe('Settle selected Yes deposits')
	expect(reportingCopy.formatSettleAllDepositsLabel('Yes')).toBe('Settle all Yes deposits')
	expect(securityPoolCopy.requestNewPrice).toBe('Request new price')
	expect(securityPoolCopy.requestNewPriceTitle).toBe('Request New Price')
	expect(tradingCopy.redeemSharesActionLabel).toBe('Redeem resolved shares')
	expect(tradingCopy.redeemResolvedSharesTitle).toBe('Redeem Resolved Shares')
	expect(simulationCopy.removeCorruptedSaves).toBe('Remove corrupted saves')
	expect(simulationCopy.removeCorruptedSavedStatesTitle).toBe('Remove Corrupted Saved States')
	expect(zoltarCopy.forkRepApprovalPending).toBe('Approving REP threshold…')
	expect(zoltarCopy.viewForkDetails).toBe('View fork details')
	expect(zoltarCopy.viewForkDetailsTitle).toBe('View Fork Details')
})
