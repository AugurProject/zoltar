import { expect, test } from 'bun:test'
import * as forkAuctionCopy from '../copy/forkAuction.js'
import * as liquidationCopy from '../copy/liquidation.js'
import * as securityPoolCopy from '../copy/securityPool.js'

test('vault operation copy uses accounting roles', () => {
	expect(securityPoolCopy.settingCapacityOwnership).toBe('Setting capacity ownership…')
	expect(securityPoolCopy.withdrawingRep).toBe('Withdrawing REP…')
})

test('fork migration empty states are complete templates', () => {
	expect(forkAuctionCopy.formatNoUnresolvedDeposits('yes')).toBe('No yes unresolved deposits remain for this wallet.')
	expect(forkAuctionCopy.formatNoClaimableParentEscalationDeposits('Yes')).toBe('No Yes parent escalation deposits are currently available for a direct claim by this wallet.')
	expect(forkAuctionCopy.parentEscalationClaimEmptyDisputeStakedRepDetail).toBe('No parent dispute-staked REP is currently visible for a direct claim by the connected wallet.')
	expect(forkAuctionCopy.parentEscalationClaimEmptyDisputeStakedRepDetail).not.toMatch(/migrat/i)
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

test('truth-auction dynamic values use nonbreaking separators', () => {
	expect(forkAuctionCopy.formatEthPerRepValue('12')).toBe('12\u00a0ETH / REP')
	expect(forkAuctionCopy.formatSelectPriceValueEthRepFromDepthChart('12')).toContain('12\u00a0ETH / REP')
	expect(forkAuctionCopy.zeroEth).toBe('0\u00a0ETH')
})

test('security-pool count summaries own their complete prose', () => {
	expect(securityPoolCopy.formatVaultDirectorySummary(3n, 8n)).toBe('Showing 3 current positions from 8 known vaults, newest-registered first.')
	expect(securityPoolCopy.vaultRegistryScanCapped).toBe('Registry scan limit reached. Some current positions may not be shown.')
	expect(securityPoolCopy.vaultRegistryScanEmpty).toBe('No current positions found within the scan limit.')
	expect(securityPoolCopy.formatNoCurrentVaultPositions(1n)).toBe('No current positions among 1 known vault.')
	expect(securityPoolCopy.formatNoCurrentVaultPositions(3n)).toBe('No current positions among 3 known vaults.')
})

test('security-pool dynamic values use nonbreaking separators', () => {
	expect(securityPoolCopy.formatInsufficientRepBalanceDetail('12')).toContain('12\u00a0REP')
})

test('liquidation actions and pending labels use sentence case independently of titles', () => {
	expect(liquidationCopy.executeVaultLiquidation).toBe('Execute vault liquidation')
	expect(liquidationCopy.executeVaultLiquidationTitle).toBe('Execute Vault Liquidation')
	expect(liquidationCopy.queueLiquidation).toBe('Queue liquidation')
	expect(liquidationCopy.queueVaultLiquidation).toBe('Queue Vault Liquidation')
	expect(liquidationCopy.liquidateVault).toBe('Liquidate vault')
	expect(liquidationCopy.liquidateVaultTitle).toBe('Liquidate Vault')
})

test('oracle actions distinguish action labels from review titles', () => {
	expect(securityPoolCopy.requestNewPrice).toBe('Request new price')
	expect(securityPoolCopy.requestNewPriceTitle).toBe('Request New Price')
})
