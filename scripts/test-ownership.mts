import { promises as fs } from 'node:fs'
import path from 'node:path'
import { discoverTestFiles, EXPLICIT_TEST_TIER_FILES, isTestSourceFile } from './test-discovery.mts'

const EXTERNAL_INTEGRATION_TESTS = new Set(['augurScan/tests/postgres.integration.test.ts'])
const PACKAGE_TEST_ROOTS = ['augurScan', 'bots/chaos', 'bots/liquidator', 'bots/open-oracle-arbitrager', 'bots/shared'] as const
const CI_OWNED_PACKAGE_DIRECTORIES = new Set(['.', 'augurScan', 'bots/chaos', 'bots/liquidator', 'bots/open-oracle-arbitrager', 'bots/shared', 'solidity', 'ui/trading'])

const normalize = (filePath: string) => filePath.replaceAll('\\', '/')

export const isPackageTestOwned = (packageRoot: string, testFile: string) => testFile.startsWith(`${packageRoot}/tests/`)
export const botTestScriptOwnsTestsDirectory = (testScript: string) => /(?:^|\s)bun test \.\/tests(?:\s|$)/.test(testScript)

async function discoverRepositoryTests(repositoryRoot: string) {
	const tests: string[] = []
	for await (const relativePath of new Bun.Glob('**/*').scan({ cwd: repositoryRoot, onlyFiles: true })) {
		const normalized = normalize(relativePath)
		if (normalized.split('/').some(part => ['node_modules', 'js', 'dist', 'vendor'].includes(part))) continue
		if (isTestSourceFile(normalized)) tests.push(normalized)
	}
	return tests.sort((left, right) => left.localeCompare(right))
}

async function discoverPackagesWithTestOrCheckScripts(repositoryRoot: string) {
	const directories: string[] = []
	for await (const relativePath of new Bun.Glob('**/package.json').scan({ cwd: repositoryRoot, onlyFiles: true })) {
		const normalized = normalize(relativePath)
		if (normalized.startsWith('node_modules/') || normalized.includes('/node_modules/')) continue
		const parsed: unknown = JSON.parse(await fs.readFile(path.join(repositoryRoot, normalized), 'utf8'))
		if (typeof parsed !== 'object' || parsed === null || !('scripts' in parsed) || typeof parsed.scripts !== 'object' || parsed.scripts === null) continue
		if (!Object.keys(parsed.scripts).some(script => /^(test|check)(:|$)/.test(script))) continue
		const directory = path.posix.dirname(normalized)
		directories.push(directory === '.' ? '.' : directory)
	}
	return directories.sort((left, right) => left.localeCompare(right))
}

export async function auditTestOwnership(repositoryRoot = path.resolve(import.meta.dir, '..')) {
	const [repositoryTests, rootTests, packageDirectories] = await Promise.all([discoverRepositoryTests(repositoryRoot), discoverTestFiles(repositoryRoot), discoverPackagesWithTestOrCheckScripts(repositoryRoot)])
	const rootOwners = new Set(rootTests)
	const errors: string[] = []

	for (const packageDirectory of packageDirectories) {
		if (!CI_OWNED_PACKAGE_DIRECTORIES.has(packageDirectory)) errors.push(`Package with test/check scripts has no CI and test:all ownership: ${packageDirectory}`)
	}
	for (const packageDirectory of PACKAGE_TEST_ROOTS.filter(directory => directory.startsWith('bots/'))) {
		const packageValue: unknown = JSON.parse(await fs.readFile(path.join(repositoryRoot, packageDirectory, 'package.json'), 'utf8'))
		const testScript = typeof packageValue === 'object' && packageValue !== null && 'scripts' in packageValue && typeof packageValue.scripts === 'object' && packageValue.scripts !== null && 'test' in packageValue.scripts ? packageValue.scripts.test : undefined
		if (typeof testScript !== 'string' || !botTestScriptOwnsTestsDirectory(testScript)) errors.push(`${packageDirectory} test command does not own its complete tests directory`)
	}

	for (const testFile of repositoryTests) {
		const owners: string[] = []
		if (rootOwners.has(testFile)) owners.push('root')
		if (EXPLICIT_TEST_TIER_FILES.has(testFile)) owners.push('browser-smoke')
		if (EXTERNAL_INTEGRATION_TESTS.has(testFile)) owners.push('external-integration')
		for (const packageRoot of PACKAGE_TEST_ROOTS) {
			if (isPackageTestOwned(packageRoot, testFile) && !EXTERNAL_INTEGRATION_TESTS.has(testFile)) owners.push(`package:${packageRoot}`)
		}
		if (owners.length !== 1) errors.push(`${testFile} has ${owners.length.toString()} intended owners: ${owners.join(', ') || '(none)'}`)
	}
	const augurPackage: unknown = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'augurScan/package.json'), 'utf8'))
	if (typeof augurPackage !== 'object' || augurPackage === null || !('scripts' in augurPackage) || typeof augurPackage.scripts !== 'object' || augurPackage.scripts === null || !('test:unit' in augurPackage.scripts) || typeof augurPackage.scripts['test:unit'] !== 'string') {
		errors.push('augurScan test:unit manifest is unavailable')
	} else {
		const commanded = [...augurPackage.scripts['test:unit'].matchAll(/\btests\/[^\s]+\.(?:test|spec|fuzz)\.(?:ts|tsx|mts|cts)\b/g)].map(match => `augurScan/${match[0]}`).sort()
		const expected = repositoryTests.filter(testFile => testFile.startsWith('augurScan/') && !EXTERNAL_INTEGRATION_TESTS.has(testFile)).sort()
		if (JSON.stringify(commanded) !== JSON.stringify(expected)) errors.push('augurScan test:unit command does not exactly own its non-integration test manifest')
	}

	return {
		errors,
		externalIntegrationTests: [...EXTERNAL_INTEGRATION_TESTS].sort(),
		packageDirectories,
		testFiles: repositoryTests,
	}
}

if (import.meta.main) {
	const audit = await auditTestOwnership()
	if (audit.errors.length > 0) throw new Error(`Test ownership preflight failed:\n${audit.errors.map(error => `- ${error}`).join('\n')}`)
	console.log(`Test ownership preflight passed: ${audit.testFiles.length.toString()} tests and ${audit.packageDirectories.length.toString()} packages have exactly one intended tier.`)
}
