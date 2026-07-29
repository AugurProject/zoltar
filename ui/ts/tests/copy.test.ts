import { expect, test } from 'bun:test'
import * as forkAuctionCopy from '../copy/forkAuction.js'
import * as appCopy from '../copy/app.js'
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
	expect(forkAuctionCopy.parentEscalationClaimEmptyEscrowDetail).toBe('No parent escrowed REP is currently visible for a direct claim by the connected wallet.')
	expect(forkAuctionCopy.parentEscalationClaimEmptyEscrowDetail).not.toMatch(/migrat/i)
})

test('security-pool count summaries own their complete prose', () => {
	expect(securityPoolCopy.formatVaultDirectorySummary(3n, 8n)).toBe('Showing 3 of 8 active vaults, newest activity first. Enter a vault address above to inspect any specific vault.')
})

test('market and Open Oracle values own their complete spacing and units', () => {
	expect(marketCopy.selectedForkQuestionSummary).toBe('Selected fork question')
	expect(openOracleCopy.formatTimingValue(12n, openOracleCopy.secondsAbbreviation)).toBe('12 s')
	expect(openOracleCopy.formatTimingValue(12n, openOracleCopy.blocks)).toBe('12 blocks')
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
