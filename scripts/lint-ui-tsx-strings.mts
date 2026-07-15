import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { getChangedFiles } from './changed-files.mts'

const UI_TSX_ROOT = path.join('ui', 'ts')
const UI_COPY_ROOT = path.join(UI_TSX_ROOT, 'copy')
const UI_TSX_CHANGED_FILE_PATTERN = /^ui\/ts\/.+\.tsx$/
const MAX_COPY_EXPORT_NAME_LENGTH = 48
const SENTENCE_STYLE_EXPORT_NAME_PATTERN =
	/^(?:approvalAmountMustBeADecimalNumber$|connectAWalletBefore|connectWalletTo|enterA|failedTo|format[A-Z].*BasedOnValue|formatMissing(?![A-Za-z]*(?:Detail|Error)$)|loadAPoolBefore|loadA[A-Z]|no[A-Z].*Were[A-Z]|selectA(?:n|t)?[A-Z]|selectedTickIsInvalid$|the[A-Z]|this[A-Z]|usesThe[A-Z]|writeThe[A-Z])/u
const COPY_FRAGMENT_NAME_PATTERN = /(?:Lead|Separator|Tail)$/u
const COPY_PROSE_ROLE_NAME_PATTERN = /(?:Description|Detail|Error|HelpText|Hint|Instruction|Reason|Warning)$/u
const USER_FACING_PROPERTY_NAMES = new Set([
	'actionHint',
	'actionLabel',
	'ariaLabel',
	'aria-label',
	'aria-description',
	'aria-placeholder',
	'aria-roledescription',
	'aria-valuetext',
	'badgeLabel',
	'alt',
	'children',
	'description',
	'detail',
	'dangerouslySetInnerHTML',
	'emptyMessage',
	'eyebrow',
	'headerSubtitle',
	'headerTitle',
	'idleLabel',
	'label',
	'loadMoreLabel',
	'pendingLabel',
	'placeholder',
	'reason',
	'secondaryDetail',
	'summary',
	'suffix',
	'text',
	'title',
	'unavailableCopy',
	'__html',
	'zeroText',
])
const INTERNAL_STATUS_TOKENS = new Set(['queued', 'executed', 'failed', 'refreshing', 'missing', 'loading', 'unknown'])
const ASSIGNMENT_OPERATOR_KINDS = new Set([
	ts.SyntaxKind.EqualsToken,
	ts.SyntaxKind.PlusEqualsToken,
	ts.SyntaxKind.MinusEqualsToken,
	ts.SyntaxKind.AsteriskEqualsToken,
	ts.SyntaxKind.SlashEqualsToken,
	ts.SyntaxKind.PercentEqualsToken,
	ts.SyntaxKind.AsteriskAsteriskEqualsToken,
	ts.SyntaxKind.AmpersandEqualsToken,
	ts.SyntaxKind.BarEqualsToken,
	ts.SyntaxKind.CaretEqualsToken,
	ts.SyntaxKind.BarBarEqualsToken,
	ts.SyntaxKind.AmpersandAmpersandEqualsToken,
	ts.SyntaxKind.QuestionQuestionEqualsToken,
	ts.SyntaxKind.LessThanLessThanEqualsToken,
	ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
	ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
])

function runGit(args: string[]) {
	return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

export function getChangedUiTsxFiles(runGitFn: (args: string[]) => string = runGit) {
	return getChangedFiles(runGitFn).filter(filePath => UI_TSX_CHANGED_FILE_PATTERN.test(filePath) && !filePath.startsWith(`${UI_TSX_ROOT}/tests/`))
}

function parseChangedLineNumbers(diffText: string) {
	const changedLines = new Set<number>()
	for (const line of diffText.split('\n')) {
		const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u.exec(line)
		if (match === null) continue
		const startLine = Number(match[1])
		const lineCount = match[2] === undefined ? 1 : Number(match[2])
		for (let offset = 0; offset < lineCount; offset += 1) {
			changedLines.add(startLine + offset)
		}
	}
	return changedLines
}

export function getChangedLineNumbers(filePath: string, runGitFn: (args: string[]) => string = runGit) {
	const untrackedPath = runGitFn(['ls-files', '--others', '--exclude-standard', '--', filePath])
	if (untrackedPath === filePath) return undefined
	const mergeBase = runGitFn(['merge-base', 'origin/main', 'HEAD'])
	const diffTexts = [runGitFn(['diff', '--no-color', '--unified=0', mergeBase, '--', filePath])]
	const changedLines = new Set<number>()
	for (const diffText of diffTexts) {
		for (const lineNumber of parseChangedLineNumbers(diffText)) {
			changedLines.add(lineNumber)
		}
	}
	return changedLines
}

function looksUserFacingText(text: string) {
	const trimmed = text.trim()
	if (trimmed === '') return false
	if (!/[A-Za-z]/.test(trimmed)) return false
	if (/^[a-z0-9_./:#-]+$/.test(trimmed)) return false
	return /[A-Z]/.test(trimmed) || /\s/.test(trimmed) || /[.!?,:&()]/.test(trimmed)
}

function looksDirectUserFacingLiteral(text: string) {
	const trimmed = text.trim()
	return trimmed !== ''
}

function looksLikeVisibleCopy(text: string) {
	const trimmed = text.trim()
	if (trimmed === '') return false
	if (!/[A-Za-z]/.test(trimmed)) return false
	if (/\s/.test(trimmed) || /[.!?,:&()]/.test(trimmed)) return true
	if (/^[A-Z]{2,6}$/.test(trimmed)) return true
	return /^[A-Z][a-z]/.test(trimmed)
}

function looksLikeLowercaseCopy(text: string) {
	const trimmed = text.trim()
	return /^[a-z]+$/.test(trimmed) && !INTERNAL_STATUS_TOKENS.has(trimmed)
}

function isLikelyFormattingHelper(node: ts.Node) {
	let current = node.parent
	while (current !== undefined) {
		if (ts.isFunctionDeclaration(current)) return current.name !== undefined && /^(?:format|render|build)[A-Z]/u.test(current.name.text)
		if (ts.isFunctionExpression(current) && current.name !== undefined) return /^(?:format|render|build)[A-Z]/u.test(current.name.text)
		if (ts.isArrowFunction(current)) {
			const parent = current.parent
			if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return /^(?:format|render|build)[A-Z]/u.test(parent.name.text)
			if (ts.isBindingElement(parent) && ts.isIdentifier(parent.name)) return /^(?:format|render|build)[A-Z]/u.test(parent.name.text)
		}
		current = current.parent
	}
	return false
}

function looksUserFacingJsxText(text: string) {
	const trimmed = text.trim()
	if (!looksDirectUserFacingLiteral(trimmed)) return false
	if (looksUserFacingText(trimmed)) return true
	if (/^[A-Z]{2,6}$/.test(trimmed)) return true
	return trimmed.length > 1 && /[a-z]/.test(trimmed)
}

function looksUserFacingIdentifier(name: string) {
	return (
		USER_FACING_PROPERTY_NAMES.has(name) ||
		/(?:Label|Labels|Title|Titles|Detail|Details|Message|Messages|Reason|Reasons|Copy|Copies|Content|Contents|Subtitle|Subtitles|Text|Texts|Description|Descriptions|Placeholder|Placeholders|Hint|Hints|Suffix|Suffixes)$/u.test(name) ||
		/^(?:label|labels|title|titles|detail|details|message|messages|reason|reasons|copy|copies|content|contents|subtitle|subtitles|text|texts|description|descriptions|placeholder|placeholders|hint|hints|suffix|suffixes)/u.test(name)
	)
}

function isUserFacingJsxAttribute(node: ts.Node) {
	return ts.isJsxAttribute(node) && looksUserFacingIdentifier(getJsxAttributeNameText(node))
}

function isUserFacingPropertyAssignment(node: ts.Node) {
	return ts.isPropertyAssignment(node) && ((ts.isIdentifier(node.name) && looksUserFacingIdentifier(node.name.text)) || (ts.isStringLiteral(node.name) && looksUserFacingIdentifier(node.name.text)))
}

function isComparisonBinaryExpression(node: ts.Node) {
	if (!ts.isBinaryExpression(node)) return false
	switch (node.operatorToken.kind) {
		case ts.SyntaxKind.EqualsEqualsToken:
		case ts.SyntaxKind.EqualsEqualsEqualsToken:
		case ts.SyntaxKind.ExclamationEqualsToken:
		case ts.SyntaxKind.ExclamationEqualsEqualsToken:
		case ts.SyntaxKind.LessThanToken:
		case ts.SyntaxKind.LessThanEqualsToken:
		case ts.SyntaxKind.GreaterThanToken:
		case ts.SyntaxKind.GreaterThanEqualsToken:
			return true
		default:
			return false
	}
}

function isAssignmentBinaryExpression(node: ts.Node) {
	if (!ts.isBinaryExpression(node)) return false
	return ASSIGNMENT_OPERATOR_KINDS.has(node.operatorToken.kind)
}

function isUserFacingFunctionName(name: string | undefined) {
	return name !== undefined && looksUserFacingIdentifier(name)
}

function isUserFacingFunctionLike(node: ts.Node) {
	if (ts.isFunctionDeclaration(node)) return isUserFacingFunctionName(node.name?.text)
	if (ts.isFunctionExpression(node)) {
		if (isUserFacingFunctionName(node.name?.text)) return true
		const parent = node.parent
		if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return looksUserFacingIdentifier(parent.name.text)
		if (ts.isBindingElement(parent) && ts.isIdentifier(parent.name)) return looksUserFacingIdentifier(parent.name.text)
	}
	if (ts.isArrowFunction(node)) {
		const parent = node.parent
		if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return looksUserFacingIdentifier(parent.name.text)
		if (ts.isBindingElement(parent) && ts.isIdentifier(parent.name)) return looksUserFacingIdentifier(parent.name.text)
	}
	return false
}

function isUserFacingAssignmentExpression(node: ts.Node) {
	if (!ts.isBinaryExpression(node) || !isAssignmentBinaryExpression(node)) return false
	const target = node.left
	if (ts.isIdentifier(target)) return looksUserFacingIdentifier(target.text)
	if (ts.isPropertyAccessExpression(target) || ts.isPropertyAccessChain(target)) return looksUserFacingIdentifier(target.name.text)
	if (ts.isElementAccessExpression(target)) {
		const argumentExpression = target.argumentExpression
		if (argumentExpression !== undefined && ts.isStringLiteral(argumentExpression)) return looksUserFacingIdentifier(argumentExpression.text)
	}
	return false
}

function isInsideUserFacingReturn(node: ts.Node) {
	let current = node.parent
	while (current !== undefined) {
		if (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isArrowFunction(current)) return isUserFacingFunctionLike(current)
		current = current.parent
	}
	return false
}

function isUserFacingContext(node: ts.Node | undefined) {
	let current = node
	while (current !== undefined) {
		if (ts.isJsxAttribute(current)) return isUserFacingJsxAttribute(current)
		if (ts.isJsxExpression(current) && current.parent !== undefined && !ts.isJsxAttribute(current.parent)) return true
		if (ts.isPropertyAssignment(current)) return isUserFacingPropertyAssignment(current)
		if (isUserFacingAssignmentExpression(current)) return true
		if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return looksUserFacingIdentifier(current.name.text)
		if (ts.isBindingElement(current) && ts.isIdentifier(current.name)) return looksUserFacingIdentifier(current.name.text)
		if (ts.isReturnStatement(current)) return isInsideUserFacingReturn(current)
		current = current.parent
	}
	return false
}

function getNodeTextSegments(node: ts.Node) {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
	if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map(span => span.literal.text)]
	return undefined
}

function getJsxAttributeNameText(node: ts.JsxAttribute) {
	return node.name.getText()
}

function getCallExpressionName(node: ts.CallExpression) {
	const expression = node.expression
	if (ts.isIdentifier(expression)) return expression.text
	if (ts.isPropertyAccessExpression(expression)) return expression.getText()
	return undefined
}

function isPreactFactoryCall(node: ts.CallExpression) {
	const callName = getCallExpressionName(node)
	return callName === 'h' || callName === 'createElement' || callName?.endsWith('.createElement') === true
}

function isRenderHelperModeTokenArgument(node: ts.Node, callExpression: ts.CallExpression) {
	if (!ts.isExpression(node) || !callExpression.arguments.includes(node)) return false
	const callName = getCallExpressionName(callExpression)
	if (callName !== 'renderTruthAuctionDebtNotice') return false
	const argumentIndex = callExpression.arguments.indexOf(node)
	if (argumentIndex !== 0) return false
	return ts.isStringLiteral(node) && (node.text === 'bid' || node.text === 'settlement')
}

function shouldReportLiteral(node: ts.Node) {
	const textSegments = getNodeTextSegments(node)
	if (textSegments === undefined) return false
	if (ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node) return false
	if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return false
	const hasDirectUserFacingText = textSegments.some(looksDirectUserFacingLiteral)
	if (ts.isJsxAttribute(node.parent)) {
		return isUserFacingJsxAttribute(node.parent) && hasDirectUserFacingText
	}
	if (ts.isPropertyAssignment(node.parent)) return isUserFacingPropertyAssignment(node.parent) && hasDirectUserFacingText
	if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return looksUserFacingIdentifier(node.parent.name.text) && hasDirectUserFacingText
	if (ts.isBindingElement(node.parent) && ts.isIdentifier(node.parent.name)) return looksUserFacingIdentifier(node.parent.name.text) && hasDirectUserFacingText
	let current = node.parent
	while (current !== undefined) {
		if (isComparisonBinaryExpression(current)) return false
		if (isUserFacingAssignmentExpression(current)) return hasDirectUserFacingText
		if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
			const directText = textSegments.join('')
			if (ts.isCallExpression(current) && isPreactFactoryCall(current) && looksLikeVisibleCopy(directText)) return true
			if (looksLikeVisibleCopy(directText)) return isUserFacingContext(current.parent)
			if (looksLikeLowercaseCopy(directText) && isLikelyFormattingHelper(node)) {
				if (ts.isCallExpression(current) && isRenderHelperModeTokenArgument(node, current)) return false
				return true
			}
			return false
		}
		if (ts.isObjectLiteralExpression(current)) return false
		if (ts.isReturnStatement(current)) {
			const directText = textSegments.join('')
			return looksLikeVisibleCopy(directText) || (looksLikeLowercaseCopy(directText) && isLikelyFormattingHelper(node)) || (isInsideUserFacingReturn(node) && hasDirectUserFacingText)
		}
		if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return looksUserFacingIdentifier(current.name.text) && hasDirectUserFacingText
		if (ts.isBindingElement(current) && ts.isIdentifier(current.name)) return looksUserFacingIdentifier(current.name.text) && hasDirectUserFacingText
		if (ts.isJsxAttribute(current)) return isUserFacingJsxAttribute(current) && hasDirectUserFacingText
		if (ts.isPropertyAssignment(current)) return isUserFacingPropertyAssignment(current) && hasDirectUserFacingText
		if (ts.isJsxExpression(current) && current.parent !== undefined && !ts.isJsxAttribute(current.parent)) return looksUserFacingJsxText(textSegments.join(''))
		current = current.parent
	}
	return false
}

export function lintSourceText(filePath: string, sourceText: string, changedLines?: ReadonlySet<number>) {
	const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
	const failures: string[] = []
	const nodeOverlapsChangedLines = (node: ts.Node) => {
		if (changedLines === undefined) return true
		const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
		const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1
		for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
			if (changedLines.has(lineNumber)) return true
		}
		return false
	}
	const visit = (node: ts.Node) => {
		if (ts.isJsxText(node)) {
			if (looksUserFacingJsxText(node.getText(sourceFile))) {
				const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
				if (!nodeOverlapsChangedLines(node)) {
					ts.forEachChild(node, visit)
					return
				}
				failures.push(`${filePath}:${line + 1}:${character + 1} JSX text must come from a named UI copy export`)
			}
		}
		if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && shouldReportLiteral(node)) {
			const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
			if (!nodeOverlapsChangedLines(node)) {
				ts.forEachChild(node, visit)
				return
			}
			failures.push(`${filePath}:${line + 1}:${character + 1} direct UI string literal must come from a module under ui/ts/copy`)
		}
		ts.forEachChild(node, visit)
	}
	visit(sourceFile)
	return failures
}

export function lintCopySourceText(filePath: string, sourceText: string) {
	const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
	const failures: string[] = []
	const validateCopyExport = (name: ts.Identifier, parameters: readonly ts.ParameterDeclaration[], initializer?: ts.Expression) => {
		const { line, character } = sourceFile.getLineAndCharacterOfPosition(name.getStart(sourceFile))
		const location = `${filePath}:${line + 1}:${character + 1}`
		if (name.text.startsWith('UI_')) failures.push(`${location} copy export names must describe their semantic role without the legacy UI_STRING/UI_TEMPLATE prefix`)
		if (name.text.length > MAX_COPY_EXPORT_NAME_LENGTH) failures.push(`${location} copy export name is longer than ${MAX_COPY_EXPORT_NAME_LENGTH} characters; name the UI role instead of repeating the full prose`)
		if (SENTENCE_STYLE_EXPORT_NAME_PATTERN.test(name.text)) failures.push(`${location} copy export name repeats a sentence opening; name its UI role instead`)
		for (const parameter of parameters) {
			if (ts.isIdentifier(parameter.name) && /^value\d+$/u.test(parameter.name.text)) failures.push(`${location} copy template parameters must use domain names instead of positional value names`)
		}
		if (initializer === undefined || (!ts.isStringLiteral(initializer) && !ts.isNoSubstitutionTemplateLiteral(initializer))) return
		const copyText = initializer.text
		if (copyText.trim() !== copyText && !COPY_FRAGMENT_NAME_PATTERN.test(name.text)) failures.push(`${location} copy with leading or trailing whitespace must use a Lead, Separator, or Tail role suffix`)
		if (COPY_PROSE_ROLE_NAME_PATTERN.test(name.text) && !/[.!?…:]$/u.test(copyText.trim())) failures.push(`${location} prose copy roles must end with punctuation`)
	}
	for (const statement of sourceFile.statements) {
		const isExported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
		if (!isExported) continue
		if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
			validateCopyExport(statement.name, statement.parameters)
			continue
		}
		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				if (!ts.isIdentifier(declaration.name)) continue
				const parameters = declaration.initializer !== undefined && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) ? declaration.initializer.parameters : []
				validateCopyExport(declaration.name, parameters, declaration.initializer)
			}
		}
	}
	const visit = (node: ts.Node) => {
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
			const textSegments = getNodeTextSegments(node) ?? []
			const [truncatedValueSpan, byteCountSpan] = ts.isTemplateExpression(node) ? node.templateSpans : []
			const isValueTruncationTemplate = ts.isTemplateExpression(node) && truncatedValueSpan !== undefined && byteCountSpan !== undefined && node.templateSpans.length === 2 && node.head.text === '' && truncatedValueSpan.literal.text === '... (' && byteCountSpan.literal.text === ' bytes)'
			const isExactHexPlaceholder = (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === '0x...'
			const hasDisallowedThreePeriods =
				!isExactHexPlaceholder &&
				textSegments.some(segment => {
					const withoutAllowedTruncation = isValueTruncationTemplate ? segment.replace('... (', '') : segment
					return withoutAllowedTruncation.includes('...')
				})
			if (hasDisallowedThreePeriods) {
				const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
				failures.push(`${filePath}:${line + 1}:${character + 1} pending copy must use the single ellipsis character`)
			}
		}
		ts.forEachChild(node, visit)
	}
	visit(sourceFile)
	return failures
}

function lintFile(filePath: string) {
	return lintSourceText(filePath, readFileSync(filePath, 'utf8'), getChangedLineNumbers(filePath))
}

if (import.meta.main) {
	const changedUiTsxFiles = getChangedUiTsxFiles()
	const copyModuleFiles = readdirSync(UI_COPY_ROOT, { withFileTypes: true })
		.filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
		.map(entry => path.join(UI_COPY_ROOT, entry.name))
	const failures = [...changedUiTsxFiles.flatMap(lintFile), ...copyModuleFiles.flatMap(filePath => lintCopySourceText(filePath, readFileSync(filePath, 'utf8')))]

	if (failures.length === 0) {
		console.log(`lint-ui-tsx-strings: checked ${changedUiTsxFiles.length} changed UI .tsx file(s) and ${copyModuleFiles.length} copy module(s)`)
		process.exit(0)
	}

	console.error('UI copy validation failed. Keep user-facing text in clear ownership-based modules under ui/ts/copy.')
	for (const failure of failures) console.error(failure)
	process.exit(1)
}
