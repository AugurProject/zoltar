import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dir, '../..')
// ui/*/ts/**/*.d.ts is gitignored (generated declarations), so the UI probe lives beside the trading scripts instead.
const probeRoots = ['tooling/repo', 'ui/trading/scripts', 'bots/shared/src', 'augurScan/src']

/**
 * Every viem/abitype import form the retired TypeScript-AST lint rejected. Biome's noRestrictedImports reports the
 * import-syntax forms; lint-no-restricted-import-types.mts reports the inline import types, template-literal specifiers,
 * and subpath require() calls that Biome does not visit.
 */
const biomeForms: readonly (readonly [label: string, source: string])[] = [
	['static import', "import { http } from 'viem'\nexport const value = http\n"],
	['type-only import', "import type { Address } from 'abitype'\nexport type Value = Address\n"],
	['re-export', "export { getAddress } from 'viem/utils'\n"],
	['deep subpath import', "import { mainnet } from 'viem/chains/definitions/mainnet'\nexport const value = mainnet\n"],
	['dynamic import', "export const value = await import('abitype/zod')\n"],
	['import equals require', "import viem = require('viem')\nexport const value = viem\n"],
	['require call', "const viem = require('viem')\nmodule.exports = viem\n"],
]
const importTypeForms: readonly (readonly [label: string, file: string, source: string])[] = [
	['inline import type', 'probe-0.ts', "export type Value = import('viem').Address\n"],
	['typeof import type in a declaration file', 'probe-1.d.ts', "export type Module = typeof import('abitype')\n"],
	['template-literal dynamic import in an ES module script', 'probe-2.mjs', 'export const value = await import(`viem/chains`)\n'],
	['template-literal require in a CommonJS script', 'probe-3.cjs', 'module.exports = require(`viem`)\n'],
	['subpath require', 'probe-4.cjs', "module.exports = require('viem/actions')\n"],
]
const allowedSource = "import { readFile } from 'node:fs/promises'\nexport const value = readFile\n"

async function run(command: string[]) {
	const child = Bun.spawn(command, { cwd: repositoryRoot, stdout: 'pipe', stderr: 'pipe' })
	const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
	return { exitCode, stdout }
}

function biomeRestrictedFiles(stdout: string) {
	const report: unknown = JSON.parse(stdout)
	if (typeof report !== 'object' || report === null || !('diagnostics' in report) || !Array.isArray(report.diagnostics)) throw new Error(`Unexpected Biome JSON report: ${stdout.slice(0, 200)}`)
	const files: string[] = []
	for (const diagnostic of report.diagnostics) {
		if (typeof diagnostic !== 'object' || diagnostic === null || Reflect.get(diagnostic, 'category') !== 'lint/style/noRestrictedImports') continue
		const file = Reflect.get(Reflect.get(Reflect.get(diagnostic, 'location') ?? {}, 'path') ?? {}, 'file')
		if (typeof file !== 'string') throw new Error('Biome diagnostic is missing its file path')
		files.push(file)
	}
	return files
}

async function withProbeDirectories(body: (directories: readonly string[]) => Promise<void>) {
	const directories = await Promise.all(probeRoots.map(root => mkdtemp(path.join(repositoryRoot, root, 'restricted-import-probe-'))))
	try {
		await body(directories.map(directory => path.relative(repositoryRoot, directory)))
	} finally {
		await Promise.all(directories.map(directory => rm(directory, { recursive: true, force: true })))
	}
}

test('the repository Biome version is the one that enforces the boundary', async () => {
	const manifest: unknown = JSON.parse(await Bun.file(path.join(repositoryRoot, 'package.json')).text())
	if (typeof manifest !== 'object' || manifest === null) throw new Error('package.json must contain an object')
	const pinned = Reflect.get(Reflect.get(manifest, 'devDependencies') ?? {}, '@biomejs/biome')
	if (typeof pinned !== 'string') throw new Error('package.json must pin @biomejs/biome')
	const { stdout } = await run(['bunx', '@biomejs/biome', '--version'])
	expect(stdout.trim()).toBe(`Version: ${pinned}`)
})

test('the shared Biome configuration rejects every runtime viem and abitype import form in root and nested packages', async () => {
	await withProbeDirectories(async directories => {
		const files: string[] = []
		for (const directory of directories) {
			for (const [index, [, source]] of biomeForms.entries()) {
				const file = path.join(directory, `probe-${index}.${source.includes('module.exports') ? 'cjs' : 'ts'}`)
				await writeFile(path.join(repositoryRoot, file), source)
				files.push(file)
			}
			await writeFile(path.join(repositoryRoot, directory, 'allowed.ts'), allowedSource)
			files.push(path.join(directory, 'allowed.ts'))
		}
		const { exitCode, stdout } = await run(['bunx', '@biomejs/biome', 'lint', '--reporter=json', ...files])
		expect(exitCode).toBe(1)
		const restricted = biomeRestrictedFiles(stdout)
		for (const directory of directories) {
			for (const [index, [label]] of biomeForms.entries()) expect(restricted.filter(file => path.dirname(file) === directory && path.basename(file).startsWith(`probe-${index}.`)).length, `${directory} ${label}`).toBe(1)
			expect(restricted.filter(file => file === path.join(directory, 'allowed.ts'))).toEqual([])
		}
	})
}, 60_000)

test('the import-type lint rejects the viem and abitype forms Biome does not visit', async () => {
	await withProbeDirectories(async directories => {
		for (const directory of directories) {
			for (const [, file, source] of importTypeForms) await writeFile(path.join(repositoryRoot, directory, file), source)
			await writeFile(path.join(repositoryRoot, directory, 'allowed.ts'), allowedSource)
		}
		// Mix repository-relative and absolute paths so both spellings lint.
		const files = directories.flatMap((directory, directoryIndex) => importTypeForms.map(([, file]) => (directoryIndex === 0 ? path.join(repositoryRoot, directory, file) : path.join(directory, file))).concat(path.join(directory, 'allowed.ts')))
		const { exitCode, stdout } = await run(['bun', 'tooling/repo/lint-no-restricted-import-types.mts', ...files])
		expect(exitCode).toBe(1)
		for (const directory of directories) {
			for (const [label, file] of importTypeForms) expect(stdout, `${directory} ${label}`).toContain(`${path.join(directory, file)}:1:`)
			expect(stdout).not.toContain(path.join(directory, 'allowed.ts'))
		}
		const [firstDirectory] = directories
		if (firstDirectory === undefined) throw new Error('Probe directories are missing')
		const directoryRun = await run(['bun', 'tooling/repo/lint-no-restricted-import-types.mts', firstDirectory])
		expect(directoryRun.exitCode).toBe(1)
		for (const [, file] of importTypeForms) expect(directoryRun.stdout).toContain(`${path.join(firstDirectory, file)}:1:`)
		const missingRun = await run(['bun', 'tooling/repo/lint-no-restricted-import-types.mts', path.join(firstDirectory, 'missing.ts')])
		expect(missingRun.exitCode).not.toBe(0)
		// A package directory contains node_modules and generated files; the git listing skips both instead of walking them.
		const [, tradingDirectory, , augurScanDirectory] = directories
		if (tradingDirectory === undefined || augurScanDirectory === undefined) throw new Error('Probe directories are missing')
		const packageRun = await run(['bun', 'tooling/repo/lint-no-restricted-import-types.mts', 'ui/trading'])
		expect(packageRun.exitCode).toBe(1)
		expect(packageRun.stdout).not.toContain('node_modules')
		expect(packageRun.stdout).not.toContain('ui/trading/ts/generated/')
		for (const [, file] of importTypeForms) expect(packageRun.stdout).toContain(`${path.join(tradingDirectory, file)}:1:`)
		const augurScanRun = await run(['bun', 'tooling/repo/lint-no-restricted-import-types.mts', augurScanDirectory])
		expect(augurScanRun.stdout).toContain("'src/ethereum.ts' inside AugurScan")
	})
}, 60_000)
