import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import * as openOracleCopy from '@zoltar/ui-statoblast-shared/copy/openOracle.js'
import { expect, test } from 'bun:test'
import * as forkAuctionCopy from '@zoltar/ui-statoblast-shared/copy/forkAuction.js'
import * as liquidationCopy from '@zoltar/ui-statoblast-shared/copy/liquidation.js'
import * as securityPoolCopy from '@zoltar/ui-statoblast-shared/copy/securityPool.js'
import * as reportingCopy from '@zoltar/ui-statoblast-shared/copy/reporting.js'

test('vault operation copy uses accounting roles', () => {
	expect(securityPoolCopy.formatWithdrawingRep('REP')).toBe('Withdrawing REP…')
	expect(securityPoolCopy.settingCommitmentLimitPending).toBe('Setting commitment limit…')
})

test('fork migration empty states are complete templates', () => {
	expect(forkAuctionCopy.formatNoUnresolvedDeposits('No')).toBe('No unresolved deposits remain on No for this wallet.')
	expect(forkAuctionCopy.formatNoClaimableParentEscalationDeposits('Yes')).toBe('No parent deposits on Yes are currently available for a direct claim by this wallet.')
	expect(forkAuctionCopy.walletDisputeStakedRepEmpty).not.toMatch(/migrat/i)
	expect(forkAuctionCopy.formatCheckingPoolRepMigratedToChildUniverse('Yes')).toContain('pool-held REP')
	expect(forkAuctionCopy.formatPoolRepAlreadyMigrated('Yes')).toContain('Pool-held REP')
	expect(forkAuctionCopy.formatPoolRepStagedForVaultMigration('Yes')).toContain('Pool-held REP')
})

test('truth-auction settlement copy identifies REP backing-unit credits', () => {
	const settlementCopy = [forkAuctionCopy.mixedSettlementPreviewDetail, forkAuctionCopy.winningSettlementPreviewDetail, forkAuctionCopy.winningBidBatchSettlementDetail, forkAuctionCopy.mixedBidBatchSettlementDetail, forkAuctionCopy.startTruthAuctionDetail, forkAuctionCopy.finalizeTruthAuctionReviewDescription]
	for (const copy of settlementCopy) expect(copy).toContain('REP backing units')
	expect(forkAuctionCopy.startTruthAuctionDetail).toContain('credited for withdrawal during settlement')
	expect(forkAuctionCopy.estimatedVaultRepBackingAttoRep).toBe('Estimated REP backing')
})

test('truth-auction dynamic values use nonbreaking separators', () => {
	expect(forkAuctionCopy.formatEthPerRepValue('12')).toBe('12\u00a0ETH per REP')
	expect(forkAuctionCopy.formatDepthChartPointLabel({ depth: '3', price: '12', status: forkAuctionCopy.depthChartClearingStatus })).toBe('Select bid price 12\u00a0ETH per REP. 3\u00a0ETH bid at or above this price. Current clearing price.')
	expect(forkAuctionCopy.zeroEth).toBe('0\u00a0ETH')
})

test('security-pool count summaries own their complete prose', () => {
	expect(securityPoolCopy.formatVaultDirectorySummary(3n, 8n)).toBe('Showing 3 active vaults of 8 known vaults, newest first.')
	expect(securityPoolCopy.vaultRegistryScanCapped).toBe('Vault scan limit reached. Some active vaults may not be shown.')
	expect(securityPoolCopy.vaultRegistryScanEmpty).toBe('No active vaults found within the scan limit.')
	expect(securityPoolCopy.formatNoCurrentVaultPositions(1n)).toBe('No active vaults among 1 known vault.')
	expect(securityPoolCopy.formatNoCurrentVaultPositions(3n)).toBe('No active vaults among 3 known vaults.')
})

test('security-pool dynamic values use nonbreaking separators', () => {
	expect(securityPoolCopy.formatInsufficientRepBalanceDetail('12')).toContain('12\u00a0REP')
})

test('liquidation actions and pending labels use sentence case independently of titles', () => {
	expect(liquidationCopy.executeVaultLiquidation).toBe('Execute vault liquidation')
	expect(liquidationCopy.executeVaultLiquidation).toBe('Execute vault liquidation')
	expect(liquidationCopy.queueLiquidation).toBe('Queue liquidation')
	expect(liquidationCopy.queueLiquidation).toBe('Queue liquidation')
	expect(liquidationCopy.liquidateVault).toBe('Liquidate vault')
	expect(liquidationCopy.liquidateVault).toBe('Liquidate vault')
})

test('oracle actions distinguish action labels from review titles', () => {
	expect(securityPoolCopy.requestNewPrice).toBe('Request new price')
})

test('price launchers share their idle and pending labels', () => {
	expect(commonCopy.launchAction(securityPoolCopy.requestNewPrice)).toBe('Request new price…')
	expect(securityPoolCopy.requestingNewPrice).toBe('Requesting new price…')
})

test('creation outcomes use sentence case', () => {
	expect(transactionCopy.creatingQuestion).toBe('Creating question')
	expect(transactionCopy.questionCreated).toBe('Question created')
	expect(transactionCopy.creatingSecurityPool).toBe('Creating security pool')
	expect(transactionCopy.securityPoolCreated).toBe('Security pool created')
	expect(securityPoolCopy.poolCreated).toBe('Pool created')
	expect(openOracleCopy.reportCreated).toBe('Report created')
})

test('truth auction bid counts use the singular for one bid', () => {
	expect(forkAuctionCopy.formatBidCountLabel(1n)).toBe('1 bid')
	expect(forkAuctionCopy.formatBidCountLabel(0n)).toBe('0 bids')
	expect(forkAuctionCopy.formatBidCountLabel(2n)).toBe('2 bids')
})

test('a trailing position without a known minimum omits the amount instead of showing a placeholder', () => {
	expect(reportingCopy.losingStatusDetail('3', 'noon', '1')).toBe('Add at least 3 REP before noon or your 1 REP is lost.')
	expect(reportingCopy.losingStatusDetail(undefined, 'noon', '1')).toBe('Report more on this side before noon or your 1 REP is lost.')
})

test('step progress counts the escalation phases', () => {
	expect(reportingCopy.phaseProgress(2, 'Response window')).toBe(`Step 2 of ${reportingCopy.phaseLabels.length} · Response window`)
})
