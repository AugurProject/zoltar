import * as securityPoolPriceCopy from '@zoltar/ui-statoblast-shared/copy/securityPoolPrice.js'
import * as securityPoolSharedForkCopy from '@zoltar/ui-statoblast-shared/copy/securityPoolSharedFork.js'
import * as securityPoolCapitalCopy from '@zoltar/ui-statoblast-shared/copy/securityPoolCapital.js'
import * as securityPoolCopy from '@zoltar/ui-statoblast-shared/copy/securityPool.js'
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
	const copy = [reportingCopy, securityPoolCopy, securityPoolCapitalCopy, securityPoolSharedForkCopy, securityPoolPriceCopy]
	const labels = [...copy.flatMap(module => Object.values(module).filter(value => typeof value === 'string')), reportingCopy.clearDeposits('No')]
	for (const label of labels) expect(label).not.toMatch(/7 weeks|3-day|eight weeks|5% headroom|adds 1 REP|settlement demand|unused healthy capacity|retiring|conservative health|liquidation boundary|scanner or liquidator|funding recipient|vault owners|clear no deposits|\bprincipal\b/i)
})
