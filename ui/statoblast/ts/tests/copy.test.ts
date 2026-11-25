import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
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

test('registration describes the actual question horizon in days or seconds', () => {
	expect(securityPoolCopy.formatQuestionHorizonReason(30n * 86_400n)).toContain('30-day question horizon')
	expect(securityPoolCopy.formatQuestionHorizonReason(90n)).toContain('90-second question horizon')
})

test('all Statoblast copy modules use the redesign glossary and live values', () => {
	const copyDirectory = new URL('../../../statoblastShared/ts/copy/', import.meta.url)
	const files = [...new Bun.Glob('*.ts').scanSync({ cwd: fileURLToPath(copyDirectory) })].sort()
	const obsoleteCopy =
		/7 weeks|3-day|eight weeks|(?:1|5)% headroom|adds 1 REP|settlement demand|healthy capacity|spare healthy commitment|(?:above|below|liquidation) boundary|conservative (?:health|price)|funding recipient|clear no deposits|admission policy|idle REP|proposed price|child preparation|child not deployed|\b(?:bonus|vaults?|accounts?|repairs?|requests?|providers?|principal|sponsor|callback|charged|ledger|retirement|retiring|scanner|liquidator|escalation|cohort)\b/i
	const violations: string[] = []
	expect(files).toContain('questionPage.ts')
	expect(files).toContain('securityPoolTakeover.ts')
	expect(files).toContain('forkRecovery.ts')
	expect(files).toContain('openOracle.ts')
	for (const name of files) {
		const source = ts.createSourceFile(name, readFileSync(new URL(name, copyDirectory), 'utf8'), ts.ScriptTarget.Latest, true)
		const visit = (node: ts.Node) => {
			// A quoted object key is an internal discriminator rather than rendered copy.
			if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return
			if ((ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) && obsoleteCopy.test(node.text)) {
				const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
				violations.push(`${name}:${line + 1} ${node.text}`)
			}
			ts.forEachChild(node, visit)
		}
		ts.forEachChild(source, visit)
	}
	expect(violations).toEqual([])
})
