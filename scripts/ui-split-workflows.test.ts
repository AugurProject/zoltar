import { describe, expect, test } from 'bun:test'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const repositoryRoot = join(import.meta.dir, '..')
const ciWorkflowPath = join(repositoryRoot, 'workflow-changes', 'ci.yml')
const deployTestnetWorkflowPath = join(repositoryRoot, 'workflow-changes', 'deploy-testnet.yml')
const setupActionPath = join(repositoryRoot, 'workflow-changes', 'setup-ci-action.yml')
const dockerfilePath = join(repositoryRoot, 'ui', 'Dockerfile')
const developerDocumentation = [
	{ path: join(repositoryRoot, 'README.md'), command: 'bun run app:serve:zoltar', port: '12346' },
	{ path: join(repositoryRoot, 'testnetwork', 'README.md'), command: 'bun run app:serve:zoltar', port: '12346' },
	{ path: join(repositoryRoot, 'trading', 'docs', 'how-to', 'deploy.md'), command: 'bun run app:serve:statoblast', port: '12347' },
]

describe('split UI workflow paths', () => {
	test('production artifacts preserve both app dist paths when uploaded and restored', async () => {
		const workflow = await readFile(ciWorkflowPath, 'utf8')
		expect(workflow).toContain('ui/zoltar/dist\n            ui/statoblast/dist')
		expect(workflow).toContain('uses: actions/download-artifact@v5\n        with:\n          name: production-ui\n          path: ui')

		const uploadedPaths = ['ui/zoltar/dist', 'ui/statoblast/dist']
		const archiveRoot = 'ui'
		const restoredPaths = uploadedPaths.map(path => join('ui', path.slice(archiveRoot.length + 1)))
		expect(restoredPaths).toEqual(uploadedPaths)
	})

	test('clean CI and testnet jobs emit the complete UI dependency DAG', async () => {
		const ciWorkflow = await readFile(ciWorkflowPath, 'utf8')
		const buildIndex = ciWorkflow.indexOf('bun run ui:build:apps')
		const preflightIndex = ciWorkflow.indexOf('bun run ci:preflight:current')
		expect(buildIndex).toBeGreaterThan(0)
		expect(preflightIndex).toBeGreaterThan(buildIndex)

		const deployWorkflow = await readFile(deployTestnetWorkflowPath, 'utf8')
		for (const packageId of ['coreShared', 'zoltar', 'statoblast']) {
			expect(deployWorkflow).toContain(`(cd ui/${packageId} && bun install --frozen-lockfile)`)
		}
		expect(deployWorkflow).toContain('bun run ui:build:apps')
		expect(deployWorkflow).toContain('bun ./scripts/deploy-testnet.mts --help')
	})

	test('CI and Docker install every UI package from its committed lockfile', async () => {
		const setupAction = await readFile(setupActionPath, 'utf8')
		for (const appId of ['coreShared', 'zoltar', 'statoblast']) {
			expect(setupAction).toContain(`(cd ui/${appId} && bun install --frozen-lockfile)`)
		}
		expect(setupAction).toContain("hashFiles('bun.lock', 'ui/*/bun.lock', 'solidity/bun.lock')")

		const dockerfile = await readFile(dockerfilePath, 'utf8')
		expect(dockerfile).toContain('ARG BUN_VERSION=1.3.14')
		for (const appId of ['coreShared', 'zoltar', 'statoblast']) {
			expect(dockerfile).toContain(`COPY ./ui/${appId}/bun.lock /source/ui/${appId}/bun.lock`)
		}
		expect(dockerfile.match(/bun install --frozen-lockfile/g)?.length).toBeGreaterThanOrEqual(3)
	})

	test('CI cache keys reference existing files or intentional globs', async () => {
		const setupAction = await readFile(setupActionPath, 'utf8')
		for (const match of setupAction.matchAll(/hashFiles\(([^)]*)\)/g)) {
			for (const quotedPath of match[1]?.matchAll(/'([^']+)'/g) ?? []) {
				const cacheInput = quotedPath[1]
				if (cacheInput === undefined || /[*?[\]]/.test(cacheInput)) continue
				await access(join(repositoryRoot, cacheInput))
			}
		}
	})

	test('developer documentation selects a split app command and current port', async () => {
		for (const { path: documentationPath, command, port } of developerDocumentation) {
			const documentation = await readFile(documentationPath, 'utf8')
			expect(documentation).toContain(command)
			expect(documentation).toContain(`localhost:${port}`)
			expect(documentation).not.toMatch(/bun run app:(?:serve|watch)(?:`|\s)/)
			expect(documentation).not.toContain('localhost:12345')
		}
	})
})
