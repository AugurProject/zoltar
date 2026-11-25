import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { repositoryRoot } from './root.mts'
import { appSharedPackages, sharedPackageClosure, type SharedPackageId, sharedPackages } from './sharedPackages.ts'
import { walkFiles } from './walk.mts'

const uiSharedPackages = {
	...appSharedPackages,
	coreShared: ['shared-core'],
	zoltarShared: ['shared-zoltar'],
	statoblastShared: ['shared-zoltar', 'shared-open-oracle', 'shared-statoblast'],
} as const satisfies Record<string, readonly SharedPackageId[]>

// The common shell, simulator and scalar picker consume these protocol exports.
const coreUiProductImports = new Set(['@zoltar/zoltar-shared/deployment/genesisUniverses', '@zoltar/zoltar-shared/constants', '@zoltar/zoltar-shared/deployment/sepoliaRepAllocations', '@zoltar/zoltar-shared/questions/scalarOutcome'])
const uiConsumers = Object.entries(uiSharedPackages).map(([name, packages]) => ({ name, packages }))

export function sharedImportBoundaryViolation(source: string, specifier: string): string | undefined {
	const owner = sharedPackages.find(entry => source.startsWith(`${entry.path}/`))
	const uiOwner = uiConsumers.find(entry => source.startsWith(`ui/${entry.name}/ts/`))
	if (owner === undefined && uiOwner === undefined) return undefined
	if (specifier.startsWith('@zoltar/shared/')) return 'The aggregate shared package no longer exists'
	const relativeTarget = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier)) : undefined
	if (owner !== undefined && (specifier.startsWith('@zoltar/ui-') || relativeTarget?.startsWith('ui/') === true)) return 'Runtime packages must not depend on UI packages'
	const target = sharedPackages.find(entry => specifier === entry.name || specifier.startsWith(`${entry.name}/`) || relativeTarget?.startsWith(`${entry.path}/`) === true)
	if (target === undefined) return undefined
	if (relativeTarget !== undefined && owner?.id !== target.id) return 'Cross-package imports must use a public package export'
	if (uiOwner?.name === 'coreShared' && coreUiProductImports.has(specifier)) return undefined
	const allowed = owner === undefined ? sharedPackageClosure(uiOwner?.packages ?? []).map(entry => entry.id) : [owner.id, ...owner.dependencies]
	if (!allowed.some(id => id === target.id)) return `${owner?.name ?? uiOwner?.name} must not depend on ${target.name}`
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

async function checkDirectory(directory: string): Promise<string[]> {
	const files = await walkFiles(path.join(repositoryRoot, directory), { includeNonFiles: true, include: file => /\.[cm]?tsx?$/.test(file) })
	return files.flatMap(file => findSharedBoundaryViolations(path.relative(repositoryRoot, file).replaceAll('\\', '/'), readFileSync(file, 'utf8')))
}

if (import.meta.main) {
	const violations = (await Promise.all([...sharedPackages.map(entry => `${entry.path}/ts`), ...uiConsumers.map(entry => `ui/${entry.name}/ts`)].map(checkDirectory))).flat()
	if (violations.length > 0) throw new Error(violations.join('\n'))
	console.log('Shared package dependency boundaries passed.')
}
