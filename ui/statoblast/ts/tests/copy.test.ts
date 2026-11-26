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
	/\bheadroom\b|adds 1 REP|settlement demand|healthy capacity|spare healthy commitment|(?:above|below|liquidation) boundary|conservative (?:health|price)|funding recipient|clear(?:ed|ing)? (?:no )?deposits|settled records|admission policy|question admission|base purchase fee|resolution premium|idle REP|proposed price|price you propose|requested commitment|source universe|source-backed rights|source recovery|child preparation|committed REP|REP\s*\/\s*WETH|\bgwei\b|max reward|not deployed|\bpremium\b|\b(?:bonus|vaults?|accounts?|repairs?|requests?|providers?|principal|sponsor|callback|charged|ledger|retire|retirement|retiring|scanner|liquidator|escalation|cohort|underwriters|keepers)\b/i

const fixedMagnitude = /\b(?:\d+(?:[.,]\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*%|[ -]+(?:percent|seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b)/i

function glossaryViolation(text: string) {
	return obsoleteCopy.test(text.replace(/\brepair auction\b/gi, '')) || fixedMagnitude.test(text)
}

function checkCopy(directory: URL, names: readonly string[], include: (node: ts.Node) => boolean) {
	const violations: string[] = []
	for (const name of names) {
		const source = ts.createSourceFile(name, readFileSync(new URL(name, directory), 'utf8'), ts.ScriptTarget.Latest, true)
		const visit = (node: ts.Node) => {
			if ((ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) && include(node) && glossaryViolation(node.text)) {
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

const labelPosition = new Map<string, number>([
	['address', 1],
	['uint', 1],
	['decodeAddress', 1],
	['decodeUint', 1],
	['decodeBool', 1],
	['decodeFields', 2],
	['verifyAuctionVaultCode', 2],
	['requireAddressValue', 1],
	['getErrorMessage', 1],
	['setIndexError', 0],
	['setError', 0],
])

function isMessage(node: ts.Node) {
	if (ts.isJsxText(node)) return true
	let expression = node
	if (ts.isTemplateSpan(node.parent)) expression = node.parent.parent
	else if (ts.isTemplateExpression(node.parent)) expression = node.parent
	while (ts.isBinaryExpression(expression.parent) && (expression.parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || expression.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)) expression = expression.parent
	if (ts.isConditionalExpression(expression.parent)) expression = expression.parent
	if (ts.isJsxExpression(expression.parent)) expression = expression.parent
	const parent = expression.parent
	if (ts.isReturnStatement(parent)) return !ts.isStringLiteralLike(expression) || !/^[a-z-]+$/.test(expression.text)
	if (ts.isNewExpression(parent)) return /^(?:Error|RangeError|TypeError)$/.test(parent.expression.getText()) && parent.arguments?.[0] === expression
	if (ts.isJsxAttribute(parent)) return /^(?:label|title|description|hint|placeholder|detail)$/.test(parent.name.getText())
	if (ts.isPropertyAssignment(parent)) return parent.name !== expression && /^(?:message|reviewTitle|reviewDescription)$/.test(parent.name.getText())
	if (!ts.isCallExpression(parent)) return false
	const index = labelPosition.get(parent.expression.getText())
	return index !== undefined && parent.arguments[index] === expression
}

test('Statoblast errors, review messages and decoding labels follow the redesign glossary', () => {
	const roots = [
		['../../../../shared/statoblast/ts/statoblast/', '*.ts'],
		['../../../../shared/statoblast/ts/escalationGame/', '*.ts'],
		['../../../statoblastShared/ts/', '{protocol,features,lib}/**/*.{ts,tsx}'],
		['../', 'app/**/*.{ts,tsx}'],
	] as const
	const violations = roots.flatMap(([path, pattern]) => {
		const directory = new URL(path, import.meta.url)
		const files = [...new Bun.Glob(pattern).scanSync({ cwd: fileURLToPath(directory) })].filter(name => !/\.test\.tsx?$/.test(name)).sort()
		expect(files.length).toBeGreaterThan(0)
		return checkCopy(directory, files, isMessage)
	})
	expect(violations).toEqual([])
})
