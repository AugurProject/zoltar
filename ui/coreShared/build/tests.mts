import * as path from 'path'
import { promises as fs } from 'fs'
import * as process from 'node:process'
import { getUiAppPaths, getUiCoreSharedPaths, isUiAppId, parseUiAppId, type UiAppId } from './appPaths.mts'

export type TestBuildTarget = UiAppId | 'coreShared'

export const TEST_BUILD_TARGET_IDS = ['coreShared', 'zoltar', 'statoblast', 'trading'] as const

export function isTestBuildTarget(candidate: string): candidate is TestBuildTarget {
	return candidate === 'coreShared' || isUiAppId(candidate)
}

export function parseTestBuildTarget(candidate: string | undefined, context: string): TestBuildTarget {
	if (candidate === 'coreShared') return candidate
	return parseUiAppId(candidate, context)
}

export function getTestBuildRoots(target: TestBuildTarget) {
	if (target === 'coreShared') {
		const { coreSharedTestSourceRoot, coreSharedTestOutputRoot } = getUiCoreSharedPaths()
		return { testSourceRoot: coreSharedTestSourceRoot, testOutputRoot: coreSharedTestOutputRoot }
	}
	const { appSourceRoot, appGeneratedJsRoot } = getUiAppPaths(target)
	return { testSourceRoot: path.join(appSourceRoot, 'tests'), testOutputRoot: path.join(appGeneratedJsRoot, 'tests') }
}

async function getAllFiles(dirPath: string, fileList: string[] = []) {
	const entries = await fs.readdir(dirPath, { withFileTypes: true })
	for (const entry of entries) {
		const entryPath = path.join(dirPath, entry.name)
		if (entry.isDirectory()) {
			await getAllFiles(entryPath, fileList)
		} else {
			fileList.push(entryPath)
		}
	}
	return fileList
}

export async function buildTests(target: TestBuildTarget) {
	const { testSourceRoot, testOutputRoot } = getTestBuildRoots(target)
	const testFiles = (await getAllFiles(testSourceRoot)).filter(filePath => filePath.endsWith('.ts') || filePath.endsWith('.tsx'))
	await fs.rm(testOutputRoot, { recursive: true, force: true })
	await fs.mkdir(testOutputRoot, { recursive: true })
	for (const testFile of testFiles) {
		const source = await fs.readFile(testFile, 'utf8')
		const loader = path.extname(testFile) === '.tsx' ? 'tsx' : 'ts'
		let transformSource = source
		if (loader === 'tsx') {
			const hasH = /\bimport\s*\{[^}]*\bh\b[^}]*\}\s*from\s*['"]preact['"]/.test(source)
			const hasFragment = /\bimport\s*\{[^}]*\bFragment\b[^}]*\}\s*from\s*['"]preact['"]/.test(source)
			if (!hasH && !hasFragment) {
				transformSource = `import { h, Fragment } from 'preact'\n${source}`
			} else if (!hasH) {
				transformSource = `import { h } from 'preact'\n${source}`
			} else if (!hasFragment) {
				transformSource = `import { Fragment } from 'preact'\n${source}`
			}
		}
		const code = await new Bun.Transpiler({
			loader,
			tsconfig: {
				compilerOptions: {
					jsx: 'react',
					jsxFactory: 'h',
					jsxFragmentFactory: 'Fragment',
				},
			},
		}).transform(transformSource)
		const outputFile = path.join(testOutputRoot, `${path.relative(testSourceRoot, testFile).replace(/\.[^.]+$/, '')}.js`)
		await fs.mkdir(path.dirname(outputFile), { recursive: true })
		await fs.writeFile(outputFile, code)
	}
	return testFiles.length
}

if (import.meta.main) {
	const target = parseTestBuildTarget(process.argv[2] ?? process.env['UI_APP'], 'the UI test build')
	buildTests(target)
		.then(count => {
			console.log(`Built ${count.toString()} ${target} UI test file(s)`)
		})
		.catch(error => {
			console.error(error)
			process.exit(1)
		})
}
