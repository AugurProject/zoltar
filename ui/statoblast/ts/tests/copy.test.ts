import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import * as securityPoolCopy from '@zoltar/ui-statoblast-shared/copy/securityPool.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import * as openOracleCopy from '@zoltar/ui-statoblast-shared/copy/openOracle.js'
import { expect, test } from 'bun:test'
import * as reportingCopy from '@zoltar/ui-statoblast-shared/copy/reporting.js'
import { getStatoblastUiDeploymentSteps } from '@zoltar/ui-statoblast-shared/protocol/deployment.js'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'

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
	'Dispute growth cutoff',
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
	'Unexpected capital fork authority response',
	'Unexpected canonical capital response',
	'Unexpected security pool custody response',
	'Unexpected fork coordinator response',
	'Unexpected reporting bootstrap response',
	'Unexpected fee accrual state response',
	'Fork controller',
	'Auction controllers',
	'Bid escrow',
	'Auction modules',
	'Pool services',
	'Clone code',
	'Price epochs',
	'Token bindings',
	'Factory mismatch',
	'Factories did not match',
	'Auction deployer',
	'Unrecognized runtime code',
	'Input must fit uint256.',
	'Input must fit uint.',
	'Zoltar',
	'Protocol mismatch',
	'Queue group ID',
	'Proofs did not match',
	'Minimum stake',
	'Opening stakes',
])('rejects the glossary term in %s', message => {
	expect(glossaryViolation(message)).toBe(true)
})

test.each([
	'Claim deposits',
	'Lost, no action needed',
	'Full reward share',
	'Repair auction',
	'Settle price report',
	'Your REP carries to the child universes.',
	'Auction vault address',
	'This report would stake REP.',
	'Your report staked REP on the selected outcome.',
	'Your REP stays staked.',
])('allows %s', message => {
	expect(glossaryViolation(message)).toBe(false)
})

const obsoleteCopy =
	/\bheadrooms?\b|\bdispute growth cutoffs?\b|adds 1 REP|settlement demands?|healthy capacit(?:y|ies)|spare healthy commitments?|(?:above|below|liquidation) boundar(?:y|ies)|conservative (?:health|prices?)|funding recipients?|clear(?:s|ed|ing)? (?:no )?deposits?|settled records?|capital services|commitment index(?:es|ices)?|report candidates?|escrow funders?|admission polic(?:y|ies)|question admissions?|base purchase fees?|resolution premiums?|idle REP|proposed prices?|prices? you propose|requested commitments?|source universes?|source-backed rights?|source recover(?:y|ies)|child preparations?|committed REP|REP\s*\/\s*WETH|\bgwei\b|max rewards?|not deployed|\bcarry (?:lea(?:f|ves)|pages?|nodes?|snapshots?)\b|\b(?:premiums?|books?|bonus(?:es)?|vaults?|repairs?|principals?|sponsors?|callbacks?|charged|retire(?:s|d|ments?)?|retiring|scanners?|liquidators?|escalations?|cohorts?|underwriters?|keepers?)\b/i
const generalWords = /\b(?:accounts?|requests?|providers?|engines?|ledgers?|zoltar)\b/i
const requiredDeploymentPromptWarning = 'If a deployment request is still open in your wallet, reject it there before starting a new deployment.'
const internalTerms = /\b(?:authorit(?:y|ies)|canonical|custody|coordinators?|bootstrap(?:ped|ping|s)?|accruals?|settlement engines?|auction engines?|question ledgers?|controllers?|escrows?|modules?|services|clones?|epochs?|bindings?|factor(?:y|ies)|deployers?|runtime|uint\d*)\b/i
const statoblastInternalTerms = /\b(?:protocols?|queue groups?|proofs?)\b/i
const stakeNoun = /\bstakes?\b/i
const stakeVerb = /\b(?:would|will|can|could|must|to)\s+stake\b|^stakes(?=\s+REP\b)/gi
const fixedMagnitude = /\b(?:\d+(?:[.,]\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*%|[ -]+(?:percent|seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b)/i

function glossaryViolation(text: string, banStatoblastTerms = true) {
	const depositSettlement = /\bdeposits?\b/i.test(text) && depositSettlementWord.test(text)
	const statoblastTerm = banStatoblastTerms && (generalWords.test(text.replace(requiredDeploymentPromptWarning, '')) || statoblastInternalTerms.test(text) || stakeNoun.test(text.replace(stakeVerb, '')))
	return obsoleteCopy.test(text.replace(/\b(?:repair auction|auction vaults?)\b/gi, '')) || internalTerms.test(text) || statoblastTerm || depositSettlement || fixedMagnitude.test(text)
}

function hasRawDeploymentName(label: string) {
	const words = label.match(/\b[A-Z][A-Za-z\d]*\b/g) ?? []
	return words.some(word => word !== 'OpenOracle' && /[a-z]/.test(word) && /[A-Z\d]/.test(word.slice(1)))
}

test.each(['GenesisReputationToken', 'DeploymentStatusOracle', 'Multicall3', 'Set up (QuestionLedger)'])('rejects a raw name in the deployment label %s', label => {
	expect(hasRawDeploymentName(label)).toBe(true)
})

test('Statoblast deployment labels describe the contracts in plain language', () => {
	for (const profile of [MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE]) {
		const labels = getStatoblastUiDeploymentSteps(profile).map(step => step.label)
		expect(labels.filter(hasRawDeploymentName)).toEqual([])
		expect(labels).toContain('OpenOracle')
		expect(labels).toContain('Deployment status contract')
		expect(labels).toContain('Batch read contract')
		if (profile.id === 'sepolia') expect(labels).toContain('Test REP token contract')
	}
})

test('keeps the approved deployment warning while banning other uses of request', () => {
	expect(glossaryViolation(`No deployment was found. ${requiredDeploymentPromptWarning}`)).toBe(false)
	expect(glossaryViolation(`Send another request. ${requiredDeploymentPromptWarning}`)).toBe(true)
	const file = 'ui/statoblastShared/ts/copy/securityPoolTransactions.ts'
	const source = ts.createSourceFile(file, `const warning = ${JSON.stringify(requiredDeploymentPromptWarning)}`, ts.ScriptTarget.Latest, true)
	expect(findViolations(source)).toEqual([])
})

const machineFields = new Set(['abi', 'className', 'data-testid', 'dependencies', 'download', 'errorName', 'eventName', 'functionName', 'href', 'id', 'key', 'kind', 'method', 'role', 'style', 'testId', 'transportMode', 'type'])
const storageKeyPrefix = /^zoltar-ui:[a-z0-9-]+:/
const abiBuilders = new Set(['keccak256', 'parseAbi', 'parseAbiItem', 'parseAbiParameters'])
const comparisonOperators = new Set([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.InKeyword])
const machineArguments = new Map([
	['Reflect.get', 1],
	['actionId', 0],
	['callWorker', 0],
	['decodeFields', 1],
	['securityPoolPriceAction', 1],
	['read', 1],
	['setReadTransportMode', 0],
	['verifyModule', 6],
])
const abiParameterType = /^(?:address|bool|bytes(?:[0-9]+)?|string|u?int(?:[0-9]+)?|tuple)(?:\[[0-9]*\])*$/
const storedRecordReaders = new Set(['address', 'bigint', 'boolean', 'hex', 'number', 'optional', 'record', 'string'])
const matchOperations = new Set(['includes', 'startsWith', 'endsWith'])
const sharedCopyRenderedUnchangedByDesign = new Map([
	['ui/coreShared/ts/copy/common.ts', new Set(['notDeployed', 'questionLedgerAddress'])],
	['ui/coreShared/ts/copy/userMessages.ts', new Set(['missingUniverseDetail'])],
])

// Shared modules can serve several products. The Statoblast wording rules cover its own
// packages and explicitly named exports shared with its shell and feature views.
const sharedCopyUsingStatoblastTerminology = new Map([
	['ui/coreShared/ts/copy/app.ts', new Set(['formatAccountMenuLabel', 'qaAccountDisconnected', 'qaWalletDisconnectedDetail', 'walletConnectionFailed', 'deploymentIncompleteReason'])],
	['ui/coreShared/ts/copy/common.ts', new Set(['connectWallet', 'walletConnectionRequired', 'formatConnectWalletBefore'])],
	['ui/coreShared/ts/copy/simulation.ts', new Set(['formatQaAccountNumber', 'formatGenesisRepTokenUpdateFailed', 'qaAccount', 'simulationQaAccount'])],
	['ui/coreShared/ts/copy/transaction.ts', new Set(['currentStateCheckFailed', 'formatOldDataCheck'])],
	['ui/coreShared/ts/copy/userMessages.ts', new Set(['walletAddressChanged', 'walletDisconnected', 'walletInstallationRequired'])],
	['ui/zoltarShared/ts/copy/forkTargets.ts', new Set(['targetChildUniverses'])],
	['ui/zoltarShared/ts/copy/zoltar.ts', new Set(['formatParentForkResponseActiveReason', 'formatUnknownReportingOutcome'])],
	['ui/zoltarShared/ts/protocol/helpers.ts', new Set(['getEscalationSideLabel'])],
])

function appliesStatoblastWordingBan(node: ts.Node, file: string) {
	if (/^(?:ui\/(?:statoblast|statoblastShared)|shared\/statoblast)\//.test(file)) return true
	const names = sharedCopyUsingStatoblastTerminology.get(file)
	if (names === undefined) return false
	for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
		if ((ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent)) && parent.name !== undefined && ts.isIdentifier(parent.name) && names.has(parent.name.text)) return true
	}
	return false
}

function propertyName(node: ts.PropertyName) {
	return ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : undefined
}

function isAbiDeclarationField(property: ts.PropertyAssignment) {
	const name = propertyName(property.name)
	if ((name !== 'name' && name !== 'internalType') || !ts.isObjectLiteralExpression(property.parent)) return false
	const fields = property.parent.properties.filter(ts.isPropertyAssignment)
	const type = fields.find(field => propertyName(field.name) === 'type')?.initializer
	if (type === undefined || !ts.isStringLiteralLike(type)) return false
	if (abiParameterType.test(type.text)) return true
	return name === 'name' && /^(?:function|event|error|constructor)$/.test(type.text) && fields.some(field => propertyName(field.name) === 'inputs' && ts.isArrayLiteralExpression(field.initializer))
}

// Strings are product text unless syntax fixes their role as code, such as a lookup key or an ABI name.
function isMachineText(node: ts.Node, file: string) {
	if (ts.isStringLiteralLike(node) && storageKeyPrefix.test(node.text)) return true
	if (ts.isTemplateExpression(node) && storageKeyPrefix.test(node.head.text)) return true
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
			if (isAbiDeclarationField(parent)) return true
			// Canonical signer funding uses this argument to compose a transaction action key, which has its own display copy.
			if (name === 'label' && ts.isCallExpression(parent.parent.parent) && parent.parent.parent.expression.getText() === 'fundCanonicalDeployerSigner') return true
		}
		if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
			if (sharedCopyRenderedUnchangedByDesign.get(file)?.has(parent.name.text) === true) return true
			if (file.endsWith('/transactionTray.ts') && parent.name.text === 'key') return true
			if (file.endsWith('/errors.ts') && parent.name.text === 'closeableErrorPatterns') return true
			if (file.endsWith('/chainBackend.ts') && parent.name.text === 'readTransportMode') return true
			if (file.endsWith('/tevmBackend.ts') && parent.name.text === 'PROGRESS_REPORTING_CALLS') return true
		}
		if (ts.isCaseClause(parent) && current === parent.expression) return true
		if (ts.isBinaryExpression(parent) && comparisonOperators.has(parent.operatorToken.kind)) return true
		if (ts.isReturnStatement(parent) && ts.isStringLiteralLike(node) && /^[a-z]+(?:-[a-z]+)+$/.test(node.text)) return true
		if (ts.isReturnStatement(parent) && file.endsWith('/ethereum/abi/parser.ts') && ts.isStringLiteralLike(node) && abiParameterType.test(node.text)) return true
		if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
			const expression = parent.expression.getText()
			const name = ts.isPropertyAccessExpression(parent.expression) ? parent.expression.name.text : expression
			if (abiBuilders.has(expression) || expression === 'Symbol' || /^console\.(?:debug|error|info|log|warn)$/.test(expression) || parent.expression.kind === ts.SyntaxKind.ImportKeyword) return true
			if (ts.isNewExpression(parent) && expression === 'Set' && parent.typeArguments?.[0]?.getText() === "DeploymentStatus['id']" && parent.arguments?.[0] === current) return true
			if (matchOperations.has(name) && parent.arguments?.[0] === current) return true
			if (parent.arguments?.[machineArguments.get(expression) ?? machineArguments.get(name) ?? -1] === current) return true
			if (storedRecordReaders.has(name) && parent.arguments?.[0] === current) {
				if (expression.startsWith('read.')) return true
				if (ts.findAncestor(parent, ancestor => ts.isCallExpression(ancestor) && ancestor.expression.getText() === 'decodeStoredValue') !== undefined) return true
			}
		}
		if (ts.isStringLiteralLike(node) && (/^(?:PRODID:)/.test(node.text) || /^(?:[\w.-]+\/)*[\w.-]+\.(?:html|ics)$/.test(node.text))) return true
		// Once a literal becomes a full expression, only its own role is relevant. For example, a literal in a JSX ternary still renders.
		if (!ts.isExpression(parent) && !ts.isTemplateSpan(parent) && !ts.isJsxExpression(parent) && !ts.isPropertyAssignment(parent)) return false
	}
	return false
}

function priorConstInitializer(node: ts.Identifier): ts.Expression | undefined {
	for (let scope = node.parent; scope !== undefined; scope = scope.parent) {
		if (ts.isFunctionLike(scope) && scope.parameters.some(parameter => ts.isIdentifier(parameter.name) && parameter.name.text === node.text)) return undefined
		if (!ts.isBlock(scope) && !ts.isSourceFile(scope) && !ts.isModuleBlock(scope)) continue
		for (const statement of scope.statements) {
			if (!ts.isVariableStatement(statement)) continue
			const { declarations, flags } = statement.declarationList
			const declaration = declarations.find(({ name }) => ts.isIdentifier(name) && name.text === node.text)
			if (declaration === undefined) continue
			if ((flags & ts.NodeFlags.Const) === 0 || declaration.pos >= node.pos) return undefined
			return declaration.initializer
		}
	}
	return undefined
}

function constantArray(node: ts.Node, seen: Set<ts.Node>): ts.ArrayLiteralExpression | undefined {
	if (seen.has(node)) return undefined
	if (ts.isArrayLiteralExpression(node)) return node
	const next = new Set(seen).add(node)
	if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) return constantArray(node.expression, next)
	if (!ts.isIdentifier(node)) return undefined
	const initializer = priorConstInitializer(node)
	return initializer === undefined ? undefined : constantArray(initializer, next)
}

function templateText(node: ts.TemplateExpression, seen: Set<ts.Node>, allowUnresolved = false): string | undefined {
	let text = node.head.text
	for (const span of node.templateSpans) {
		const value = compoundText(span.expression, seen)
		if (value === undefined && !allowUnresolved) return undefined
		text += (value ?? ' ') + span.literal.text
	}
	return text
}

function compoundText(node: ts.Node, seen = new Set<ts.Node>()): string | undefined {
	if (seen.has(node)) return undefined
	const next = new Set(seen).add(node)
	if (ts.isStringLiteralLike(node)) return node.text
	if (ts.isTemplateExpression(node)) return templateText(node, next)
	if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) return compoundText(node.expression, next)
	if (ts.isIdentifier(node)) {
		const initializer = priorConstInitializer(node)
		return initializer === undefined ? undefined : compoundText(initializer, next)
	}
	if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
		const left = compoundText(node.left, next)
		const right = compoundText(node.right, next)
		return left === undefined || right === undefined ? undefined : left + right
	}
	if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined
	const { expression: receiver, name } = node.expression
	if (name.text === 'concat') {
		const parts = [receiver, ...node.arguments].map(part => compoundText(part, next))
		return parts.some(part => part === undefined) ? undefined : parts.join('')
	}
	if (name.text !== 'join' || node.arguments.length > 1) return undefined
	const array = constantArray(receiver, next)
	if (array === undefined) return undefined
	const separatorArg = node.arguments[0]
	const separator = separatorArg === undefined ? ',' : compoundText(separatorArg, next)
	const parts = array.elements.map(part => compoundText(part, next))
	return separator === undefined || parts.some(part => part === undefined) ? undefined : parts.join(separator)
}

const decoderTextArguments = new Map<string, readonly number[]>([
	['address', [1]],
	['decodeAddress', [1]],
	['decodeBool', [1]],
	['decodeFields', [2]],
	['decodeUint', [1]],
	['positive', [1]],
	['uint', [1, 2]],
])

function decoderTextKind(node: ts.Node) {
	let argument = node
	let call = argument.parent
	while (ts.isParenthesizedExpression(call) || (ts.isConditionalExpression(call) && (argument === call.whenTrue || argument === call.whenFalse))) {
		argument = call
		call = argument.parent
	}
	if (!ts.isCallExpression(call)) return undefined
	const target = call.expression
	const name = ts.isPropertyAccessExpression(target) ? target.name : target
	if (!ts.isIdentifier(name)) return undefined
	if (/^require(?:(?:Address|Array|Bigint|Boolean|IntegerLike|Object|Tuple)Value|BigintArray)$/.test(name.text) && call.arguments.at(-1) === argument) return 'response-label'
	if (decoderTextArguments.get(name.text)?.some(index => call.arguments[index] === argument)) return 'error-text'
	return undefined
}

function findViolations(source: ts.SourceFile, file = source.fileName) {
	const violations: string[] = []
	const visit = (node: ts.Node) => {
		const joined = ts.isBinaryExpression(node) || ts.isCallExpression(node) || ts.isTemplateExpression(node) ? compoundText(node) : undefined
		const textKind = ts.isParenthesizedExpression(node) ? undefined : decoderTextKind(node)
		// Check static fragments together and visit template substitutions independently.
		let text = joined
		if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) text = node.text
		else if (text === undefined && ts.isTemplateExpression(node)) text = templateText(node, new Set([node]), true)
		else if (text === undefined && textKind !== undefined) text = compoundText(node)
		const label = text?.trimStart() ?? ''
		const capitalizedLabel = textKind === 'response-label' && /^[A-Z][a-z]/.test(label) && !/^(?:OpenOracle|REP|ETH|WETH)\b/.test(label)
		if (text !== undefined && (textKind !== undefined || !isMachineText(node, file)) && (capitalizedLabel || glossaryViolation(text, appliesStatoblastWordingBan(node, file)))) {
			const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
			violations.push(`${file}:${line + 1} ${text.replace(/\s+/g, ' ').trim()}`)
		}
		if (joined === undefined) ts.forEachChild(node, visit)
	}
	ts.forEachChild(source, visit)
	return violations
}

test.each([
	["commit('Settle your REP deposits')", 'Settle your REP deposits'],
	["const amountLabel = 'Opening stake'", 'Opening stake'],
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
	["const message = 'Settle ' + 'deposits'", 'Settle deposits'],
	["const message = ('Set' + 'tle ') + ('depos' + 'its')", 'Settle deposits'],
	["const message = ['Settle', 'deposits'].join(' ')", 'Settle deposits'],
	["const message = ['Set', 'tle ', 'deposits'].join('')", 'Settle deposits'],
	["const parts = ['Settle', 'deposits']; const message = parts.join(' ')", 'Settle deposits'],
	["const left = ['Set', 'tle ', 'deposits'] as const; const parts = left; const message = parts.join('')", 'Settle deposits'],
	["const message = 'Set'.concat('tle ', 'deposits')", 'Settle deposits'],
	["const prefix = 'Settle '; const message = prefix + 'deposits'", 'Settle deposits'],
	["const prefix = 'Settle '; const message = `${prefix}deposits`", 'Settle deposits'],
	["const prefix = 'run'; const message = `${prefix}time mismatch`", 'runtime mismatch'],
	["requireAddressValue(value, 'Collateral token')", 'Collateral token'],
	["requireTupleValue(value, 2, 'Mint capacity')", 'Mint capacity'],
	["const head = 'Collateral'; requireAddressValue(value, head + ' token')", 'Collateral token'],
	["requireBigintValue(value, 'OpenOracle runtime code')", 'OpenOracle runtime code'],
	["requireBigintValue(value, 'OpenOracles token balance')", 'OpenOracles token balance'],
	["if (getAddress(requireAddressValue(value, 'auction deployer')) !== expected) throw reason", 'auction deployer'],
	["if (decodeAddress(value, 'pool factory', true) !== expected) throw reason", 'pool factory'],
	["if (decodeUint(value, 'auction controller', 48) === expected) throw reason", 'auction controller'],
	["if (address(value, 'report module') !== expected) throw reason", 'report module'],
	["if (uint(value, 256, 'price epoch') === expected) throw reason", 'price epoch'],
	["if (positive(value, 'bid escrow', 48) === expected) throw reason", 'bid escrow'],
	["if (decodeAddress(value, byPool ? ('pool factory') : 'pool address') !== expected) throw reason", 'pool factory'],
	["const labels = new Set(['pool factory'])", 'pool factory'],
	["requireAddressValue(value, 'Zoltar universe details')", 'Zoltar universe details'],
	['const message = `The ${type} ledger failed`', 'The ledger failed'],
])('finds reserved product wording in %s', (fixture, message) => {
	const file = 'ui/statoblast/ts/fixtures/copy.tsx'
	const source = ts.createSourceFile(file, fixture, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
	expect(findViolations(source)).toEqual([`${file}:1 ${message}`])
})

test('allows lower-case response labels and protocol acronyms', () => {
	const fixture = "requireAddressValue(value, 'collateral token'); requireBigintValue(value, 'REP balance'); requireTupleValue(value, 2, 'mint capacity')"
	const source = ts.createSourceFile('ui/statoblastShared/ts/protocol/fixture.ts', fixture, ts.ScriptTarget.Latest, true)
	expect(findViolations(source)).toEqual([])
})

test.each(['OpenOracle token balance', 'REP balance', 'ETH balance', 'WETH balance'])('allows the leading product name in %s', label => {
	const source = ts.createSourceFile('ui/statoblastShared/ts/protocol/fixture.ts', `requireBigintValue(value, ${JSON.stringify(label)})`, ts.ScriptTarget.Latest, true)
	expect(findViolations(source)).toEqual([])
})

test('resolves a const prefix within its own scope', () => {
	const fixture = "const prefix = 'Settle '; { const prefix = 'Claim '; publish(prefix + 'deposits') }"
	const source = ts.createSourceFile('ui/statoblast/ts/fixtures/copy.tsx', fixture, ts.ScriptTarget.Latest, true)
	expect(findViolations(source)).toEqual([])
})

test('allows Zoltar-only general wording while keeping shared internal terms banned', () => {
	const fixture = "export const requestSent = 'Request sent'\nexport const status = 'Settlement for your deposits'\nexport const label = 'Question ledger'\nexport const title = 'Zoltar protocol queue group'"
	const source = ts.createSourceFile('ui/zoltarShared/ts/copy/example.ts', fixture, ts.ScriptTarget.Latest, true)
	expect(findViolations(source)).toEqual(['ui/zoltarShared/ts/copy/example.ts:2 Settlement for your deposits', 'ui/zoltarShared/ts/copy/example.ts:3 Question ledger'])
})

test('applies the Statoblast wording ban to error labels in its shared package', () => {
	const file = 'shared/statoblast/ts/statoblast/fixture.ts'
	const fixture = "const universe = decodeAddress(value, 'Zoltar')\nconst group = decodeUint(value, 'Price protocol queue group')"
	const source = ts.createSourceFile(file, fixture, ts.ScriptTarget.Latest, true)
	expect(findViolations(source)).toEqual([`${file}:1 Zoltar`, `${file}:2 Price protocol queue group`])
})

test('applies the general-word ban to selected shared exports rendered in Statoblast', () => {
	const fixture = "export const qaWalletDisconnectedDetail = 'Account disconnected'\nexport const requestSent = 'Request sent'"
	const source = ts.createSourceFile('ui/coreShared/ts/copy/app.ts', fixture, ts.ScriptTarget.Latest, true)
	expect(findViolations(source)).toEqual(['ui/coreShared/ts/copy/app.ts:1 Account disconnected'])
})

test('keeps a shared wording exception specific to its export', () => {
	const fixture = "export const questionLedgerAddress = 'Question ledger address'\nexport const renamed = 'Question ledger address'"
	const source = ts.createSourceFile('ui/coreShared/ts/copy/common.ts', fixture, ts.ScriptTarget.Latest, true)
	expect(findViolations(source)).toEqual(['ui/coreShared/ts/copy/common.ts:2 Question ledger address'])
})

test('checks the label shown for the registered proxy contract', () => {
	const file = 'ui/zoltarShared/ts/protocol/deployment.ts'
	const fixture = "const step = { id: 'proxyDeployer', label: 'Proxy Deployer' }"
	const source = ts.createSourceFile(file, fixture, ts.ScriptTarget.Latest, true)
	expect(findViolations(source)).toEqual([`${file}:1 Proxy Deployer`])
})

test('leaves non-text ABI names, CSS, lookup keys and discriminants alone', () => {
	const fixture = [
		"import { a } from './settlement-engine.js'",
		"const abi = [{ name: 'ledger', type: 'function', inputs: [{ name: 'account', type: 'uint256', internalType: 'uint256' }] }]",
		"const topic = keccak256('ReportSubmitted(uint256,bytes)')",
		"fundCanonicalDeployerSigner(client, { label: 'deterministic proxy deployer' })",
		"const request = { functionName: 'provider' }",
		"const step = { dependencies: ['zoltar'] }",
		"const steps = new Set<DeploymentStatus['id']>(['zoltar'])",
		'const key = `zoltar-ui:statoblast:reads:${chainId}`',
		"const byStatus = { 'Settlement engine': { kind: 'ledger' } }",
		"const find = (value: string) => value === 'account' ? byStatus['Settlement engine'] : undefined",
		"const element = <p className='settlement-engine' data-testid='ledger' />",
		"console.error('Failed to inspect the provider account')",
	].join('\n')
	expect(findViolations(ts.createSourceFile('ui/statoblast/ts/fixtures/copy.tsx', fixture, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX))).toEqual([])
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
