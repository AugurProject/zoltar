import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { appSharedPackages, sharedPackageClosure, sharedPackages } from './sharedPackages.ts'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const uiConsumers = ['coreShared', 'zoltarShared', 'statoblastShared', 'zoltar', 'statoblast', 'trading'] as const

export function sharedImportBoundaryViolation(source: string, specifier: string): string | undefined {
	const owner = sharedPackages.find(entry => source.startsWith(`${entry.path}/`))
	const uiOwner = uiConsumers.find(entry => source.startsWith(`ui/${entry}/ts/`))
	if (owner === undefined && uiOwner === undefined) return undefined
	if (specifier.startsWith('@zoltar/shared/')) return 'The aggregate shared package no longer exists'
	const relativeTarget = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier)) : undefined
	if (owner !== undefined && (specifier.startsWith('@zoltar/ui-') || relativeTarget?.startsWith('ui/') === true)) return 'Runtime packages must not depend on UI packages'
	const target = sharedPackages.find(entry => specifier.startsWith(`${entry.name}/`) || relativeTarget?.startsWith(`${entry.path}/`) === true)
	if (target === undefined) return undefined
	if (relativeTarget !== undefined && owner?.id !== target.id) return 'Cross-package imports must use a public package export'
	let app: keyof typeof appSharedPackages = 'zoltar'
	if (uiOwner === 'trading') app = 'trading'
	else if (uiOwner === 'statoblast' || uiOwner === 'statoblastShared') app = 'statoblast'
	const allowed = owner === undefined ? sharedPackageClosure(appSharedPackages[app]).map(entry => entry.id) : [owner.id, ...owner.dependencies]
	if (!allowed.some(id => id === target.id)) return `${owner?.name ?? uiOwner} must not depend on ${target.name}`
	return undefined
}

export function findSharedBoundaryViolations(source: string, text: string) {
	const parsed = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true)
	const violations: string[] = []
	const check = (value: ts.StringLiteralLike) => {
		const violation = sharedImportBoundaryViolation(source, value.text)
		if (violation !== undefined) violations.push(`${source}:${parsed.getLineAndCharacterOfPosition(value.getStart(parsed)).line + 1}: ${violation}: ${value.text}`)
	}
	const visit = (node: ts.Node): void => {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) check(node.moduleSpecifier)
		if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) check(node.argument.literal)
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const value = node.arguments[0]
			if (value !== undefined && ts.isStringLiteralLike(value)) check(value)
		}
		ts.forEachChild(node, visit)
	}
	visit(parsed)
	return violations
}

function checkDirectory(directory: string): string[] {
	return readdirSync(path.join(repositoryRoot, directory), { withFileTypes: true }).flatMap(entry => {
		const source = `${directory}/${entry.name}`
		if (entry.isDirectory()) return checkDirectory(source)
		if (!/\.[cm]?tsx?$/.test(entry.name)) return []
		return findSharedBoundaryViolations(source, readFileSync(path.join(repositoryRoot, source), 'utf8'))
	})
}

if (import.meta.main) {
	const violations = [...sharedPackages.map(entry => `${entry.path}/ts`), ...uiConsumers.map(entry => `ui/${entry}/ts`)].flatMap(checkDirectory)
	if (violations.length > 0) throw new Error(violations.join('\n'))
	console.log('Shared package dependency boundaries passed.')
}
