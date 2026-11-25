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

const obsoleteCopy =
	/7 weeks|3-day|eight weeks|52 days|\bheadroom\b|adds 1 REP|settlement demand|healthy capacity|spare healthy commitment|(?:above|below|liquidation) boundary|conservative (?:health|price)|funding recipient|clear(?:ed|ing)? (?:no )?deposits|settled records|admission policy|question admission|base purchase fee|resolution premium|idle REP|proposed price|price you propose|requested commitment|source universe|source-backed rights|source recovery|child preparation|child not deployed|\b(?:bonus|vaults?|accounts?|repairs?|requests?|providers?|principal|sponsor|callback|charged|ledger|retire|retirement|retiring|scanner|liquidator|escalation|cohort|underwriters|keepers)\b/i

function checkCopy(directory: URL, names: readonly string[], include: (node: ts.Node) => boolean) {
	const violations: string[] = []
	for (const name of names) {
		const source = ts.createSourceFile(name, readFileSync(new URL(name, directory), 'utf8'), ts.ScriptTarget.Latest, true)
		const visit = (node: ts.Node) => {
			if ((ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) && include(node) && obsoleteCopy.test(node.text)) {
				const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
				violations.push(`${name}:${line + 1} ${node.text}`)
			}
			ts.forEachChild(node, visit)
		}
		ts.forEachChild(source, visit)
	}
	return violations
}

test('Statoblast and shared UI copy follow the redesign glossary and use live values', () => {
	const copyDirectories = [new URL('../../../statoblastShared/ts/copy/', import.meta.url), new URL('../../../coreShared/ts/copy/', import.meta.url)]
	const violations = copyDirectories.flatMap(directory => {
		const files = [...new Bun.Glob('*.ts').scanSync({ cwd: fileURLToPath(directory) })].sort()
		expect(files.length).toBeGreaterThan(0)
		return checkCopy(directory, files, node => {
			const parent = node.parent
			// Object keys and the verbs used to match transaction titles are internal discriminators.
			if (ts.isPropertyAssignment(parent) && (parent.name === node || (node.getSourceFile().fileName === 'transactionActionTenses.ts' && parent.name.getText() === 'verb'))) return false
			return true
		})
	})
	expect(violations).toEqual([])
})

test('shared Statoblast errors and decoding labels follow the redesign glossary', () => {
	const directory = new URL('../../../../shared/statoblast/ts/statoblast/', import.meta.url)
	const files = [...new Bun.Glob('*.ts').scanSync({ cwd: fileURLToPath(directory) })].filter(name => !name.endsWith('.test.ts')).sort()
	expect(files).toContain('securityPoolAuctionRead.ts')
	expect(files).toContain('securityPoolFork.ts')
	const labelPosition = new Map<string, number>([
		['address', 1],
		['uint', 1],
		['decodeAddress', 1],
		['decodeUint', 1],
		['decodeBool', 1],
		['decodeFields', 2],
		['verifyAuctionVaultCode', 2],
	])
	expect(
		checkCopy(directory, files, node => {
			const expression = ts.isTemplateSpan(node.parent) ? node.parent.parent : ts.isTemplateExpression(node.parent) ? node.parent : node
			const parent = expression.parent
			if (ts.isNewExpression(parent)) return parent.expression.getText() === 'Error' && parent.arguments?.[0] === expression
			if (!ts.isCallExpression(parent)) return false
			const index = labelPosition.get(parent.expression.getText())
			return index !== undefined && parent.arguments[index] === expression
		}),
	).toEqual([])
})
