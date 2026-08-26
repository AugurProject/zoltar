import { expect, test } from 'bun:test'
import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../copy/market.js'
import * as openOracleCopy from '../copy/openOracle.js'
import * as reportingCopy from '../copy/reporting.js'
import * as simulationCopy from '@zoltar/ui-core-shared/copy/simulation.js'
import * as tradingCopy from '../copy/trading.js'
import * as zoltarCopy from '../copy/zoltar.js'

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
})

test('transaction actions and pending labels use sentence case independently of titles', () => {
	expect(marketCopy.createQuestionPendingLabel).toBe('Creating question…')
	expect(appCopy.changeWallet).toBe('Change wallet')
	expect(appCopy.switchToEthereumMainnet).toBe('Switch to Ethereum mainnet')
	expect(marketCopy.alreadyForked).toBe('Already forked')
	expect(reportingCopy.reportOnSelectedSide).toBe('Report on selected side')
	expect(reportingCopy.triggerZoltarFork).toBe('Trigger universe fork')
	expect(reportingCopy.formatSettleSelectedDepositsLabel('Yes')).toBe('Settle selected Yes deposits')
	expect(reportingCopy.formatSettleAllDepositsLabel('Yes')).toBe('Settle all Yes deposits')
	expect(tradingCopy.redeemSharesActionLabel).toBe('Redeem resolved shares')
	expect(tradingCopy.redeemResolvedSharesTitle).toBe('Redeem Resolved Shares')
	expect(simulationCopy.removeCorruptedSaves).toBe('Remove corrupted saves')
	expect(simulationCopy.removeCorruptedSavedStatesTitle).toBe('Remove Corrupted Saved States')
	expect(zoltarCopy.forkRepApprovalPending).toBe('Approving REP threshold…')
	expect(zoltarCopy.viewForkDetails).toBe('View fork details')
	expect(zoltarCopy.viewForkDetailsTitle).toBe('View Fork Details')
})
