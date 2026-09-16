import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import config from '../../knip.ts'
import { repositoryRoot } from './root.mts'

function record(value: unknown) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a configuration object')
	return value
}

const scenarios = [
	{ name: 'clean project', source: 'export const used = 1\n', extraFile: false, staleIgnore: false, unusedDependency: false, expected: 0, diagnostic: '' },
	{ name: 'unused file', source: 'export const used = 1\n', extraFile: true, staleIgnore: false, unusedDependency: false, expected: 1, diagnostic: 'Unused files' },
	{ name: 'unused export', source: 'export const used = 1\nexport const unused = 2\n', extraFile: false, staleIgnore: false, unusedDependency: false, expected: 1, diagnostic: 'Unused exports' },
	{ name: 'unused type', source: 'export const used = 1\nexport type Unused = string\n', extraFile: false, staleIgnore: false, unusedDependency: false, expected: 1, diagnostic: 'Unused exported types' },
	{ name: 'unused dependency', source: 'export const used = 1\n', extraFile: false, staleIgnore: false, unusedDependency: true, expected: 1, diagnostic: 'Unused dependencies' },
	{ name: 'configuration hint', source: 'export const used = 1\n', extraFile: false, staleIgnore: true, unusedDependency: false, expected: 1, diagnostic: 'Configuration hints' },
	{ name: 'tag hint', source: '/** @internal */\nexport const used = 1\n', extraFile: false, staleIgnore: false, unusedDependency: false, expected: 1, diagnostic: 'Tag hints' },
]

for (const scenario of scenarios) {
	test(`Knip command ${scenario.expected === 0 ? 'accepts' : 'rejects'} ${scenario.name}`, async () => {
		const root = await mkdtemp(join(tmpdir(), 'knip-policy-'))
		try {
			const manifest: unknown = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
			const manifestRecord = record(manifest)
			if (!('scripts' in manifestRecord)) throw new Error('Missing repository scripts')
			const scripts = record(manifestRecord.scripts)
			if (!('knip' in scripts && 'knip:normal' in scripts && 'knip:production' in scripts)) throw new Error('Missing Knip scripts')
			const policy = await config({})
			await mkdir(join(root, 'src'))
			await symlink(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
			await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, scripts: { knip: scripts.knip, 'knip:normal': scripts['knip:normal'], 'knip:production': scripts['knip:production'] }, dependencies: scenario.unusedDependency ? { 'unused-policy-probe': '1.0.0' } : {} }))
			await writeFile(join(root, 'tsconfig.json'), '{}')
			await writeFile(
				join(root, 'knip.json'),
				JSON.stringify({
					entry: ['src/index.ts!'],
					project: ['src/**/*.ts!'],
					ignoreDependencies: scenario.staleIgnore ? ['unused-policy-probe'] : [],
					treatConfigHintsAsErrors: policy.treatConfigHintsAsErrors,
					treatTagHintsAsErrors: policy.treatTagHintsAsErrors,
				}),
			)
			await writeFile(join(root, 'src/index.ts'), "import { used } from './value.ts'\nconsole.log(used)\n")
			await writeFile(join(root, 'src/value.ts'), scenario.source)
			if (scenario.extraFile) await writeFile(join(root, 'src/orphan.ts'), 'export const orphan = 1\n')
			const child = Bun.spawn([process.execPath, 'run', 'knip'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
			const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
			expect(status, stdout + stderr).toBe(scenario.expected)
			expect(stdout + stderr).toContain('knip:normal')
			expect(stdout + stderr).toContain('knip:production')
			if (scenario.diagnostic !== '') expect(stdout + stderr).toContain(scenario.diagnostic)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})
}
