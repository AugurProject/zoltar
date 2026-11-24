import * as securityPoolPriceCopy from '@zoltar/ui-statoblast-shared/copy/securityPoolPrice.js'
import * as securityPoolSharedForkCopy from '@zoltar/ui-statoblast-shared/copy/securityPoolSharedFork.js'
import * as securityPoolCapitalCopy from '@zoltar/ui-statoblast-shared/copy/securityPoolCapital.js'
import * as securityPoolCopy from '@zoltar/ui-statoblast-shared/copy/securityPool.js'
import * as glossaryCopy from '@zoltar/ui-statoblast-shared/copy/glossary.js'
import * as auctionCopy from '@zoltar/ui-statoblast-shared/copy/securityPoolRepairAuction.js'
import * as appCopy from '@zoltar/ui-statoblast-shared/copy/app.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import * as openOracleCopy from '@zoltar/ui-statoblast-shared/copy/openOracle.js'
import { expect, test } from 'bun:test'
import * as reportingCopy from '@zoltar/ui-statoblast-shared/copy/reporting.js'

test('creation outcomes use sentence case', () => {
	expect(transactionCopy.creatingQuestion).toBe('Creating question')
	expect(transactionCopy.questionCreated).toBe('Question created')
	expect(openOracleCopy.reportCreated).toBe('Report created')
})

test('a trailing position without a known minimum omits the amount instead of showing a placeholder', () => {
	// Amounts arrive rendered with their own unit, so the sentence keeps each one in place.
	expect(reportingCopy.losingStatusDetail('3 REP', 'noon', '1 REP').join('')).toBe('Add at least 3 REP before noon or your 1 REP is lost.')
	expect(reportingCopy.losingStatusDetail(undefined, 'noon', '1 REP').join('')).toBe('Report more on this side before noon or your 1 REP is lost.')
	// The rendered amount marks its own rounding, so the sentence does not hedge it again with "about".
	expect(reportingCopy.winningStatusDetail('1 REP', '≈ 1.33 REP').join('')).toBe('Your 1 REP would be worth ≈ 1.33 REP if it ended now.')
	expect(reportingCopy.winningPosition('≈ 1.33 REP').join('')).toBe('Leading · worth ≈ 1.33 REP if it ended now')
})

test('step progress counts the escalation phases', () => {
	expect(reportingCopy.phaseProgress(2, 'Response window')).toBe(`Step 2 of ${reportingCopy.phaseLabels.length} · Response window`)
})

test('Statoblast workflow copy uses the redesign glossary and live values', () => {
	const copy = [reportingCopy, securityPoolCopy, securityPoolCapitalCopy, securityPoolSharedForkCopy, securityPoolPriceCopy, glossaryCopy, auctionCopy, appCopy]
	const labels = [
		...copy.flatMap(module => Object.values(module).filter(value => typeof value === 'string')),
		...securityPoolCapitalCopy.prepareStages,
		...Object.values(securityPoolCapitalCopy.retirementPreviewStatus),
		openOracleCopy.settlementGasExceedsTransactionCap,
		reportingCopy.clearDeposits('No'),
		securityPoolCopy.fixedQuestionRulesReview(1n, [1n]),
		securityPoolCopy.fixedQuestionLimit(1),
		securityPoolCapitalCopy.reductionWithCure('1 WETH', true),
		securityPoolCapitalCopy.reductionWithCure('1 WETH', false),
		reportingCopy.forkTriggerWarning('No', '1'),
		reportingCopy.reportForkReviewDescription('No'),
		securityPoolCopy.mintReview({ amount: '1 WETH', purchaseFee: '0.01 WETH', feeCap: '0.02 WETH', minimum: '1', recovery: undefined }),
		auctionCopy.bidReview(1n, 1n, 1n),
	]
	for (const label of labels) {
		expect(label).not.toMatch(
			/7 weeks|3-day|eight weeks|5% headroom|adds 1 REP|settlement demand|healthy capacity|spare healthy commitment|(?:above|below|liquidation) boundary|conservative health|funding recipient|vault owners|clear no deposits|admission policy|\b(?:principal|ledger|callback|retirement|retiring|sponsor|scanner|liquidator|escalation|cohort)\b/i,
		)
	}
})
