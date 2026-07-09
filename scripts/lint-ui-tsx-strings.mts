import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { getChangedFiles } from './changed-files.mts'

const UI_TSX_ROOT = path.join('ui', 'ts')
const UI_TSX_CHANGED_FILE_PATTERN = /^ui\/ts\/.+\.tsx$/
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

function shouldReportLiteral(node: ts.Node) {
	const textSegments = getNodeTextSegments(node)
	if (textSegments === undefined) return false
	if (ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node) return false
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
			return (looksLikeVisibleCopy(directText) || (looksLikeLowercaseCopy(directText) && isLikelyFormattingHelper(node))) && isUserFacingContext(current.parent)
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

export function lintSourceText(filePath: string, sourceText: string) {
	const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
	const failures: string[] = []
	const visit = (node: ts.Node) => {
		if (ts.isJsxText(node)) {
			if (looksUserFacingJsxText(node.getText(sourceFile))) {
				const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
				failures.push(`${filePath}:${line + 1}:${character + 1} JSX text must come from UI_STRINGS`)
			}
		}
		if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && shouldReportLiteral(node)) {
			const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
			failures.push(`${filePath}:${line + 1}:${character + 1} direct UI string literal must come from ui/ts/lib/uiStrings.ts`)
		}
		ts.forEachChild(node, visit)
	}
	visit(sourceFile)
	return failures
}

function lintFile(filePath: string) {
	return lintSourceText(filePath, readFileSync(filePath, 'utf8'))
}

if (import.meta.main) {
	const changedUiTsxFiles = getChangedUiTsxFiles()

	if (changedUiTsxFiles.length === 0) {
		console.log('lint-ui-tsx-strings: no changed UI .tsx files to audit')
		process.exit(0)
	}

	const failures = changedUiTsxFiles.flatMap(lintFile)

	if (failures.length === 0) {
		console.log(`lint-ui-tsx-strings: checked ${changedUiTsxFiles.length} changed UI .tsx file(s)`)
		process.exit(0)
	}

	console.error('Direct UI strings are not allowed in changed .tsx files. Move them to ui/ts/lib/uiStrings.ts.')
	for (const failure of failures) console.error(failure)
	process.exit(1)
}
