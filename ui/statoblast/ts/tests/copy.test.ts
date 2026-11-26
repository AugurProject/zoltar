import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
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

const depositSettlementWord = /\b(?:settle(?:s|d|ment|ments|able)?|settling|unsettled)\b/i

test.each([
	'Headroom',
	'Settlement demands',
	'Healthy capacities',
	'Source recoveries',
	'Headrooms',
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
	'Repair auctions',
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
	'Carry nodes',
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

test.each(['Claim deposits', 'Lost, no action needed', 'Full reward share', 'Repair auction', 'Settle price report', 'Your REP carries to the child universes.'])('allows %s', message => {
	expect(glossaryViolation(message)).toBe(false)
})

const obsoleteCopy =
	/\bheadrooms?\b|adds 1 REP|settlement demands?|healthy capacit(?:y|ies)|spare healthy commitments?|(?:above|below|liquidation) boundar(?:y|ies)|conservative (?:health|prices?)|funding recipients?|clear(?:s|ed|ing)? (?:no )?deposits?|settled records?|capital services|commitment index(?:es|ices)?|report candidates?|escrow funders?|admission polic(?:y|ies)|question admissions?|base purchase fees?|resolution premiums?|idle REP|proposed prices?|prices? you propose|requested commitments?|source universes?|source-backed rights?|source recover(?:y|ies)|child preparations?|committed REP|REP\s*\/\s*WETH|\bgwei\b|max rewards?|not deployed|\bcarry (?:lea(?:f|ves)|pages?|nodes?|snapshots?)\b|\b(?:premiums?|books?|bonus(?:es)?|vaults?|repairs?|principals?|sponsors?|callbacks?|charged|retire(?:s|d|ments?)?|retiring|scanners?|liquidators?|escalations?|cohorts?|underwriters?|keepers?)\b/i
const generalWords = /\b(?:accounts?|requests?|providers?|engines?|ledgers?)\b/i
const fixedMagnitude = /\b(?:\d+(?:[.,]\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*%|[ -]+(?:percent|seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b)/i

function glossaryViolation(text: string) {
	const depositSettlement = /\bdeposits?\b/i.test(text) && depositSettlementWord.test(text)
	return obsoleteCopy.test(text.replace(/\brepair auction\b/gi, '')) || generalWords.test(text) || depositSettlement || fixedMagnitude.test(text)
}

const machineFields = new Set(['abi', 'className', 'data-testid', 'download', 'errorName', 'eventName', 'functionName', 'href', 'id', 'key', 'kind', 'method', 'role', 'style', 'testId', 'transportMode', 'type'])
const abiBuilders = new Set(['parseAbi', 'parseAbiItem', 'parseAbiParameters'])
const comparisonOperators = new Set([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.InKeyword])
const machineArguments = new Map([
	['Reflect.get', 1],
	['actionId', 0],
	['decodeFields', 1],
	['securityPoolPriceAction', 1],
	['read', 1],
	['setReadTransportMode', 0],
])
const abiParameterType = /^(?:address|bool|bytes(?:[0-9]+)?|string|u?int(?:[0-9]+)?|tuple)(?:\[[0-9]*\])*$/
const storedRecordReaders = new Set(['address', 'bigint', 'boolean', 'hex', 'number', 'optional', 'record', 'string'])
const matchOperations = new Set(['includes', 'startsWith', 'endsWith'])
const unrenderedSharedCopy = new Map([
	['ui/coreShared/ts/copy/common.ts', new Set(['notDeployed', 'questionLedgerAddress'])],
	['ui/coreShared/ts/copy/userMessages.ts', new Set(['missingUniverseDetail'])],
])

function propertyName(node: ts.PropertyName) {
	return ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : undefined
}

function isAbiName(property: ts.PropertyAssignment) {
	if (propertyName(property.name) !== 'name' || !ts.isObjectLiteralExpression(property.parent)) return false
	const fields = property.parent.properties.filter(ts.isPropertyAssignment)
	const type = fields.find(field => propertyName(field.name) === 'type')?.initializer
	if (type === undefined || !ts.isStringLiteralLike(type)) return false
	if (abiParameterType.test(type.text)) return true
	return /^(?:function|event|error|constructor)$/.test(type.text) && fields.some(field => propertyName(field.name) === 'inputs' && ts.isArrayLiteralExpression(field.initializer))
}

// Strings are product text unless syntax fixes their role as code, such as a lookup key or an ABI name.
function isMachineText(node: ts.Node, file: string) {
	let current = node
	for (let parent = current.parent; parent !== undefined; current = parent, parent = current.parent) {
		if (ts.isLiteralTypeNode(parent) || ts.isTemplateLiteralTypeNode(parent) || ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isImportTypeNode(parent)) return true
		if (ts.isElementAccessExpression(parent) && current === parent.argumentExpression) return true
		if ((ts.isPropertyAssignment(parent) || ts.isBindingElement(parent)) && current === parent.name) return true
		if (ts.isJsxAttribute(parent) && (machineFields.has(parent.name.getText()) || /^data-/.test(parent.name.getText()))) return true
		if (ts.isPropertyAssignment(parent)) {
			const name = propertyName(parent.name) ?? ''
			if (machineFields.has(name) || name.startsWith('--')) return true
			if (name === 'verb' && file.endsWith('/transactionActionTenses.ts')) return true
			if (isAbiName(parent)) return true
		}
		if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
			if (unrenderedSharedCopy.get(file)?.has(parent.name.text) === true) return true
			if (file.endsWith('/transactionTray.ts') && parent.name.text === 'key') return true
			if (file.endsWith('/errors.ts') && parent.name.text === 'closeableErrorPatterns') return true
			if (file.endsWith('/chainBackend.ts') && parent.name.text === 'readTransportMode') return true
		}
		if (ts.isCaseClause(parent) && current === parent.expression) return true
		if (ts.isBinaryExpression(parent) && comparisonOperators.has(parent.operatorToken.kind)) return true
		if (ts.isReturnStatement(parent) && ts.isStringLiteralLike(node) && /^[a-z]+(?:-[a-z]+)+$/.test(node.text)) return true
		if (ts.isCallExpression(parent)) {
			const expression = parent.expression.getText()
			const name = ts.isPropertyAccessExpression(parent.expression) ? parent.expression.name.text : expression
			if (abiBuilders.has(expression) || expression === 'Symbol' || /^console\.(?:debug|error|info|log|warn)$/.test(expression) || parent.expression.kind === ts.SyntaxKind.ImportKeyword) return true
			if (matchOperations.has(name) && parent.arguments[0] === current) return true
			if (parent.arguments[machineArguments.get(expression) ?? machineArguments.get(name) ?? -1] === current) return true
			if (expression.startsWith('read.') && storedRecordReaders.has(name) && parent.arguments[0] === current) return true
		}
		if (ts.isStringLiteralLike(node) && (/^(?:PRODID:)/.test(node.text) || /^(?:[\w.-]+\/)*[\w.-]+\.(?:html|ics)$/.test(node.text))) return true
		// Once a literal becomes a full expression, only its own role is relevant. For example, a literal in a JSX ternary still renders.
		if (!ts.isExpression(parent) && !ts.isTemplateSpan(parent) && !ts.isJsxExpression(parent) && !ts.isPropertyAssignment(parent)) return false
	}
	return false
}

function findViolations(source: ts.SourceFile, file = source.fileName) {
	const violations: string[] = []
	const visit = (node: ts.Node) => {
		if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateExpression(node)) {
			// Check static fragments together and visit substitutions independently.
			const text = ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join(' ') : node.text
			if (!isMachineText(node, file) && glossaryViolation(text)) {
				const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
				violations.push(`${file}:${line + 1} ${text.replace(/\s+/g, ' ').trim()}`)
			}
		}
		ts.forEachChild(node, visit)
	}
	ts.forEachChild(source, visit)
	return violations
}

test.each([
	["commit('Settle your REP deposits')", 'Settle your REP deposits'],
	["commit('Settle 3 deposits')", 'Settle 3 deposits'],
	["commit('Unsettled deposits')", 'Unsettled deposits'],
	["commit('Deposits not settled')", 'Deposits not settled'],
	["commit('Deposits can be settled')", 'Deposits can be settled'],
	["commit('Settlement for your deposits')", 'Settlement for your deposits'],
	["commit('Settleable deposits')", 'Settleable deposits'],
	["commit('Bonuses')", 'Bonuses'],
	["commit('Ledgers')", 'Ledgers'],
	["commit('Sponsors')", 'Sponsors'],
	["<p>{'Settle deposits'}</p>", 'Settle deposits'],
	["<p>{x ? 'Settlement engine' : undefined}</p>", 'Settlement engine'],
	["const m = 'Settle deposits'; throw new Error(m)", 'Settle deposits'],
	["const m = ['Settle deposits']", 'Settle deposits'],
	["const m = { failure: 'Settlement engine' }", 'Settlement engine'],
	["const m = { pending: 'Waiting for the ledger' }", 'Waiting for the ledger'],
	["const m = { success: 'Account added' }", 'Account added'],
	["const m = { reason: 'Unknown provider' }", 'Unknown provider'],
	["const m = { actionLabel: 'Create request' }", 'Create request'],
	["const m = { name: 'Settlement engine', type: 'error' }", 'Settlement engine'],
	["const m = { invalidMessage: 'Settlement engine' }", 'Settlement engine'],
	["setOpenOracleCreateFieldError(fields, 'amount', 'Settle deposits')", 'Settle deposits'],
	["formatOpenOracleDisputeWriteErrorMessage(error, 'Settle deposits')", 'Settle deposits'],
	["formatOpenOracleSettleWriteErrorMessage(error, 'Settle deposits')", 'Settle deposits'],
	['const message = `The ${type} ledger failed`', 'The ledger failed'],
])('finds reserved product wording in %s', (fixture, message) => {
	const source = ts.createSourceFile('fixture.tsx', fixture, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
	expect(findViolations(source)).toEqual([`fixture.tsx:1 ${message}`])
})

test('leaves non-text ABI names, CSS, lookup keys and discriminants alone', () => {
	const fixture = [
		"import { a } from './settlement-engine.js'",
		"const abi = [{ name: 'ledger', type: 'function', inputs: [{ name: 'account', type: 'address' }] }]",
		"const request = { functionName: 'provider' }",
		"const byStatus = { 'Settlement engine': { kind: 'ledger' } }",
		"const find = (value: string) => value === 'account' ? byStatus['Settlement engine'] : undefined",
		"const element = <p className='settlement-engine' data-testid='ledger' />",
		"console.error('Failed to inspect the provider account')",
	].join('\n')
	expect(findViolations(ts.createSourceFile('fixture.tsx', fixture, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX))).toEqual([])
})

const root = fileURLToPath(new URL('../../../../', import.meta.url))

function productionSource(path: string) {
	return /^(?:ui|shared)\/[^/]+\/ts\/.*\.tsx?$/.test(path) && !/(?:\/tests?\/|\.test\.tsx?$|\/generated\/|\/contractArtifact\.ts$)/.test(path)
}

function runtimeImports(source: ts.SourceFile) {
	const imports: string[] = []
	const visit = (node: ts.Node) => {
		if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly !== true && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text)
		if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text)
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const path = node.arguments[0]
			if (path !== undefined && ts.isStringLiteralLike(path)) imports.push(path.text)
		}
		ts.forEachChild(node, visit)
	}
	ts.forEachChild(source, visit)
	return imports
}

test('Statoblast copy and imported sources follow the redesign glossary', () => {
	const configPath = resolve(root, 'tsconfig.json')
	const config = ts.readConfigFile(configPath, ts.sys.readFile)
	expect(config.error).toBeUndefined()
	const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
	const resolutionCache = ts.createModuleResolutionCache(root, file => file, options)
	const paths = [...new Bun.Glob('ui/statoblast/ts/**/*.{ts,tsx}').scanSync({ cwd: root })].filter(productionSource)
	expect(paths.length).toBeGreaterThan(0)
	const sources = new Map<string, ts.SourceFile>()
	const load = (path: string) => {
		const fileName = resolve(root, path)
		const source = ts.createSourceFile(fileName, readFileSync(fileName, 'utf8'), ts.ScriptTarget.Latest, true)
		sources.set(path, source)
		return source
	}
	for (const path of paths) {
		if (sources.has(path)) continue
		const source = load(path)
		for (const specifier of runtimeImports(source)) {
			const resolved = ts.resolveModuleName(specifier, source.fileName, options, ts.sys, resolutionCache).resolvedModule?.resolvedFileName
			if (resolved === undefined) continue
			const dependency = relative(root, resolved)
			if (productionSource(dependency) && !sources.has(dependency)) paths.push(dependency)
		}
	}
	// Audit all Statoblast-owned feature copy, then just the runtime-reachable files of other products.
	for (const path of new Bun.Glob('ui/statoblastShared/ts/**/*.{ts,tsx}').scanSync({ cwd: root })) {
		if (productionSource(path) && !sources.has(path)) load(path)
	}
	for (const scope of ['ui/zoltarShared/', 'shared/openOracle/']) expect([...sources.keys()].some(path => path.startsWith(scope))).toBe(true)
	const violations = [...sources].flatMap(([file, source]) => findViolations(source, file))
	expect(violations).toEqual([])
})
