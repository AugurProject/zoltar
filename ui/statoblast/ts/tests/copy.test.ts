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

const depositSettlement = /\b(?:(?:settle(?:s|d|ment)?|settling)\s+(?:(?:invalid|yes|no|winning|losing|reporting|inherited|these|those|your|the|selected|all|of)\s+)*deposits?|deposits?\s+(?:(?:were|are|is|have been)\s+)?(?:settle(?:s|d|ment)?|settling))\b/i

test.each([
	'Headroom',
	'Adds 1 REP',
	'Settlement demand',
	'Unused healthy capacity',
	'Spare healthy commitment',
	'Below boundary',
	'Liquidation boundary',
	'Conservative health',
	'Conservative price',
	'Funding recipient',
	'Clear No deposits',
	'Settled records',
	'Admission policy',
	'Question admission',
	'Base purchase fee',
	'Resolution premium',
	'Idle REP',
	'Proposed price',
	'Enter the price you propose',
	'Requested commitment',
	'Source universe',
	'Source-backed rights',
	'Source recovery',
	'Child preparation',
	'Committed REP',
	'REP/WETH',
	'10 g\u0077ei',
	'Max reward',
	'Not deployed',
	'Premium',
	'Bonus',
	'Vault',
	'Account',
	'Maximum commitment to repair',
	'Repair auction and full repair',
	'Request',
	'Provider',
	'Principal',
	'Sponsor',
	'Callback',
	'Charged',
	'Retire',
	'Retirement',
	'Retiring',
	'Scanner',
	'Liquidator',
	'Escalation',
	'Cohort',
	'Underwriters',
	'Keepers',
	'Wait 3 days',
	'One-week window',
	'100% required',
	'Settle No deposits (0 REP payout)',
	'Settled Invalid deposits',
	'Settling Yes deposits',
	'Deposit settlement failed',
	'Deposits settled',
	'Settlement of deposits',
	'Books',
	'Engines',
	'Carry',
	'Unexpected settlement book response',
	'Unexpected settlement engine response',
	'Unexpected carry leaf page response',
	'Unexpected frozen book ID response',
	'Unexpected capital services response',
	'Unexpected auction engine response',
	'Unexpected engine controller response',
	'Unexpected commitment index response',
	'Unexpected historical carry node response',
	'Unexpected report candidate response',
	'Unexpected escrow funder response',
	'Unexpected question ledger response',
])('rejects the glossary term in %s', message => {
	expect(glossaryViolation(message)).toBe(true)
})

test.each(['Claim deposits', 'Lost · no action needed', 'Full reward share', 'Repair auction', 'Settle price report'])('allows %s', message => {
	expect(glossaryViolation(message)).toBe(false)
})

const obsoleteCopy =
	/\bheadroom\b|adds 1 REP|settlement demand|healthy capacity|spare healthy commitment|(?:above|below|liquidation) boundary|conservative (?:health|price)|funding recipient|clear(?:ed|ing)? (?:no )?deposits|settled records|capital services|commitment index|report candidate|escrow funder|admission policy|question admission|base purchase fee|resolution premium|idle REP|proposed price|price you propose|requested commitment|source universe|source-backed rights|source recovery|child preparation|committed REP|REP\s*\/\s*WETH|\bgwei\b|max reward|not deployed|\bpremium\b|\b(?:books?|engines?|carry|bonus|vaults?|accounts?|repairs?|requests?|providers?|principal|sponsor|callback|charged|ledger|retire|retirement|retiring|scanner|liquidator|escalation|cohort|underwriters|keepers)\b/i

const fixedMagnitude = /\b(?:\d+(?:[.,]\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*%|[ -]+(?:percent|seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b)/i

function glossaryViolation(text: string) {
	return obsoleteCopy.test(text.replace(/\brepair auction\b/gi, '')) || depositSettlement.test(text) || fixedMagnitude.test(text)
}

function findViolations(source: ts.SourceFile, include: (node: ts.Node) => boolean) {
	const violations: string[] = []
	const visit = (node: ts.Node) => {
		if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateExpression(node)) {
			// Only the static words are checked, including phrases split by a dynamic amount or outcome.
			const text = ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join(' ') : node.text
			if (include(node) && glossaryViolation(text)) {
				const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
				violations.push(`${source.fileName}:${line + 1} ${text}`)
			}
		}
		ts.forEachChild(node, visit)
	}
	ts.forEachChild(source, visit)
	return violations
}

function checkCopy(directory: URL, names: readonly string[], include: (node: ts.Node) => boolean) {
	return names.flatMap(name => findViolations(ts.createSourceFile(name, readFileSync(new URL(name, directory), 'utf8'), ts.ScriptTarget.Latest, true), include))
}

test('Statoblast and shared UI copy follow the redesign glossary and use live values', () => {
	const copyDirectories = ['statoblastShared', 'coreShared'] as const
	const violations = copyDirectories.flatMap(app => {
		const directory = new URL(`../../../${app}/ts/copy/`, import.meta.url)
		const files = [...new Bun.Glob('*.ts').scanSync({ cwd: fileURLToPath(directory) })].sort()
		expect(files.length).toBeGreaterThan(0)
		return checkCopy(directory, files, node => {
			const parent = node.parent
			// Object keys and the verbs used to match transaction titles are internal discriminators.
			if (ts.isPropertyAssignment(parent) && (parent.name === node || (node.getSourceFile().fileName === 'transactionActionTenses.ts' && parent.name.getText() === 'verb'))) return false
			// Zoltar and Trading use this for their deployment status. Statoblast labels child universes separately.
			if (app === 'coreShared' && node.getSourceFile().fileName === 'common.ts' && ts.isVariableDeclaration(parent) && parent.name.getText() === 'notDeployed') return false
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
	['bigintToSafeNumber', 1],
	['verifyAuctionVaultCode', 2],
	['verifyBoundCloneCode', 2],
	['requireAddressValue', 1],
	['requireBigintValue', 1],
	['requireArrayValue', 1],
	['requireBigintArray', 1],
	['requireBooleanValue', 1],
	['requireHexValue', 1],
	['requireIntegerLikeValue', 1],
	['requireObjectValue', 1],
	['requireTupleValue', 2],
	['requireCarryLeafView', 1],
	['verifyCapitalModuleClone', 4],
	['verifyModule', 4],
	['verifyRuntimeCode', 3],
	['createVisibleGateMessage', 0],
	['createHiddenLoadingGateMessage', 0],
	['setTransferMessage', 0],
	['setOpenError', 0],
	['setSearchError', 0],
	['runTradingAction', 2],
	['runOracleAction', 2],
	['formatRefreshErrorMessage', 1],
	['refreshErrorFallback', 0],
	['getErrorMessage', 1],
	['setIndexError', 0],
	['setError', 0],
	['createUserFacingError', 0],
	['createProviderRpcError', 1],
	['createTransactionFailureError', 1],
	['parseAddressInput', 1],
	['parseBigIntListInput', 1],
	['requireDefined', 1],
	['sendSecurityPoolTransaction', 2],
	['withStatoblastRequestTimeout', 1],
	['withTimeout', 2],
	['reportBootstrapProgress', 1],
])

function isMessage(node: ts.Node) {
	if (ts.isJsxText(node)) return true
	let expression = node
	for (let parent = expression.parent; parent !== undefined; parent = expression.parent) {
		if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent)) expression = parent
		else if (ts.isBinaryExpression(parent) && (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || parent.operatorToken.kind === ts.SyntaxKind.PlusToken)) expression = parent
		else if (ts.isConditionalExpression(parent) && parent.condition !== expression) expression = parent
		else break
	}
	if (ts.isJsxExpression(expression.parent)) expression = expression.parent
	const parent = expression.parent
	if (ts.isReturnStatement(parent)) return !ts.isStringLiteralLike(expression) || !/^[a-z]+(?:-[a-z]+)+$/.test(expression.text)
	if (ts.isNewExpression(parent)) return /(?:Error|Mismatch)$/.test(parent.expression.getText()) && parent.arguments?.[0] === expression
	if (ts.isParameter(parent)) return parent.name.getText() === 'label' && parent.initializer === expression
	if (ts.isJsxAttribute(parent)) return /^(?:label|title|description|hint|placeholder|detail|disabledReason|aria-label|alt)$/.test(parent.name.getText())
	if (ts.isPropertyAssignment(parent)) return parent.name !== expression && /^(?:message|reviewTitle|reviewDescription|refreshErrorFallback|label|title|description|hint|placeholder|detail|explanation|disabledReason)$/.test(parent.name.getText())
	if (!ts.isCallExpression(parent)) return false
	const index = labelPosition.get(ts.isPropertyAccessExpression(parent.expression) ? parent.expression.name.text : parent.expression.getText())
	return index !== undefined && parent.arguments[index] === expression
}

test('finds product text in positional arguments, conditional fallbacks, and templates', () => {
	const source = ts.createSourceFile(
		'fixture.ts',
		[
			"requireTupleValue(raw, 2, 'commitment index')",
			"decode.requireBigintValue(raw, 'frozen book ID')",
			'createVisibleGateMessage(`Settle ${outcome} deposits`)',
			"show({ refreshErrorFallback: 'Auction engine unavailable' })",
			"setTransferMessage(error instanceof Error ? error.message : 'Check the question ledger')",
			"createUserFacingError('Wallet account changed')",
			"refreshErrorFallback('Settle No deposits')",
			"readContract({ functionName: 'carry' })",
		].join('\n'),
		ts.ScriptTarget.Latest,
		true,
	)
	expect(findViolations(source, isMessage)).toEqual(['fixture.ts:1 commitment index', 'fixture.ts:2 frozen book ID', 'fixture.ts:3 Settle   deposits', 'fixture.ts:4 Auction engine unavailable', 'fixture.ts:5 Check the question ledger', 'fixture.ts:6 Wallet account changed', 'fixture.ts:7 Settle No deposits'])
})

test('Statoblast errors, review messages and decoding labels follow the redesign glossary', () => {
	const roots = [
		['../../../../shared/statoblast/ts/', '**/*.ts'],
		['../../../statoblastShared/ts/', '{protocol,features,lib,simulation}/**/*.{ts,tsx}'],
		['../../../coreShared/ts/', '**/*.{ts,tsx}'],
		['../../../../shared/core/ts/', '**/*.ts'],
		['../', '{app,simulation}/**/*.{ts,tsx}'],
	] as const
	const violations = roots.flatMap(([path, pattern]) => {
		const directory = new URL(path, import.meta.url)
		const files = [...new Bun.Glob(pattern).scanSync({ cwd: fileURLToPath(directory) })].filter(name => !/\.test\.tsx?$/.test(name) && !/^(?:tests|copy)\//.test(name)).sort()
		expect(files.length).toBeGreaterThan(0)
		return checkCopy(directory, files, isMessage)
	})
	expect(violations).toEqual([])
})
