import { describe, expect, test } from 'bun:test'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const repositoryRoot = join(import.meta.dir, '..')
const ciWorkflowPath = join(repositoryRoot, '.github', 'workflows', 'ci.yml')
const deployTestnetWorkflowPath = join(repositoryRoot, '.github', 'workflows', 'deploy-testnet.yml')
const setupActionPath = join(repositoryRoot, '.github', 'actions', 'setup-ci', 'action.yml')
const setupComponentActionPath = join(repositoryRoot, '.github', 'actions', 'setup-component', 'action.yml')
const ipfsDeployWorkflowPath = join(repositoryRoot, '.github', 'workflows', 'ipfs-deploy.yml')
const versionDeployWorkflowPath = join(repositoryRoot, '.github', 'workflows', 'version-deploy.yml')
const dockerfilePath = join(repositoryRoot, 'ui', 'Dockerfile')
const developerDocumentation = [
	{ path: join(repositoryRoot, 'README.md'), command: 'bun run app:serve:zoltar', port: '12346' },
	{ path: join(repositoryRoot, 'testnetwork', 'README.md'), command: 'bun run app:serve:zoltar', port: '12346' },
	{ path: join(repositoryRoot, 'solidity', 'docs', 'trading', 'how-to', 'deploy.md'), command: 'bun run app:serve:trading', port: '4163' },
]
const tevmPackagePaths = ['package.json', 'ui/coreShared/package.json', 'ui/zoltar/package.json', 'ui/statoblast/package.json', 'ui/trading/package.json'] as const
const pinnedTevmTransitives = ['@tevm/actions', '@tevm/node', '@tevm/server'] as const
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

describe('split UI workflow paths', () => {
	test('split CI remains callable by the version release workflow', async () => {
		const workflow = await readFile(ciWorkflowPath, 'utf8')
		expect(workflow).toContain('on:\n  workflow_call:\n')
		const releaseWorkflow = await readFile(join(repositoryRoot, '.github', 'workflows', 'version-deploy.yml'), 'utf8')
		expect(releaseWorkflow).toContain('uses: ./.github/workflows/ci.yml')
	})

	test('production artifacts preserve app dist and JavaScript paths when uploaded and restored', async () => {
		const workflow = await readFile(ciWorkflowPath, 'utf8')
		expect(workflow).toContain('ui/coreShared/js\n            ui/zoltar/js\n            ui/statoblast/js\n            ui/trading/js\n            ui/zoltar/dist\n            ui/statoblast/dist\n            ui/trading/dist')
		expect(workflow).toContain('uses: actions/download-artifact@v5\n        with:\n          name: production-ui\n          path: ui')
		const downloadIndex = workflow.indexOf('name: production-ui\n          path: ui')
		let previousInstallIndex = downloadIndex
		for (const packageId of ['coreShared', 'zoltar', 'statoblast', 'trading']) {
			const installIndex = workflow.indexOf(`bun ./scripts/install-frozen.mts ui/${packageId}`, previousInstallIndex)
			expect(installIndex).toBeGreaterThan(previousInstallIndex)
			previousInstallIndex = installIndex
		}

		const uploadedPaths = ['ui/coreShared/js', 'ui/zoltar/js', 'ui/statoblast/js', 'ui/trading/js', 'ui/zoltar/dist', 'ui/statoblast/dist', 'ui/trading/dist']
		const archiveRoot = 'ui'
		const restoredPaths = uploadedPaths.map(path => join('ui', path.slice(archiveRoot.length + 1)))
		expect(restoredPaths).toEqual(uploadedPaths)
	})

	test('contract caches and transferred inputs include the generated Trading artifact', async () => {
		const setupAction = await readFile(setupActionPath, 'utf8')
		expect(setupAction).toContain('ui/trading/ts/generated/contractArtifact.ts')

		const workflow = await readFile(ciWorkflowPath, 'utf8')
		expect(workflow.match(/ui\/trading\/ts\/generated\/contractArtifact\.ts/g)).toHaveLength(2)
	})

	test('clean CI and testnet jobs emit the complete UI dependency DAG', async () => {
		const ciWorkflow = await readFile(ciWorkflowPath, 'utf8')
		const buildIndex = ciWorkflow.indexOf('bun run ui:build:apps')
		const preflightIndex = ciWorkflow.indexOf('bun run ci:preflight:current')
		expect(buildIndex).toBeGreaterThan(0)
		expect(preflightIndex).toBeGreaterThan(buildIndex)

		const deployWorkflow = await readFile(deployTestnetWorkflowPath, 'utf8')
		for (const packageId of ['coreShared', 'zoltar', 'statoblast', 'trading']) {
			expect(deployWorkflow).toContain(`(cd ui/${packageId} && bun install --frozen-lockfile)`)
		}
		expect(deployWorkflow).toContain('bun run ui:build:apps')
		expect(deployWorkflow).toContain('bun ./scripts/deploy-testnet.mts --help')
	})

	test('CI and Docker install every UI package from its committed lockfile', async () => {
		const setupAction = await readFile(setupActionPath, 'utf8')
		for (const appId of ['coreShared', 'zoltar', 'statoblast', 'trading']) {
			expect(setupAction).toContain(`(cd ui/${appId} && bun install --frozen-lockfile)`)
		}
		expect(setupAction).toContain("hashFiles('bun.lock', 'ui/*/bun.lock', 'solidity/bun.lock')")

		const dockerfile = await readFile(dockerfilePath, 'utf8')
		expect(dockerfile).toContain('ARG BUN_VERSION=1.3.14')
		for (const appId of ['coreShared', 'zoltar', 'statoblast', 'trading']) {
			expect(dockerfile).toContain(`COPY ./ui/${appId}/bun.lock /source/ui/${appId}/bun.lock`)
		}
		for (const appId of ['coreShared', 'zoltar', 'statoblast', 'trading']) expect(dockerfile).toContain(`bun ./scripts/install-frozen.mts ui/${appId}`)
	})

	test('every TEVM workspace pins the compatible release-candidate dependency cohort', async () => {
		for (const packagePath of tevmPackagePaths) {
			const parsed: unknown = JSON.parse(await readFile(join(repositoryRoot, packagePath), 'utf8'))
			expect(isRecord(parsed)).toBe(true)
			if (!isRecord(parsed)) throw new Error(`${packagePath} must contain a JSON object`)
			const overrides = parsed['overrides']
			expect(isRecord(overrides)).toBe(true)
			if (!isRecord(overrides)) throw new Error(`${packagePath} must define dependency overrides`)
			for (const dependencyName of pinnedTevmTransitives) expect(overrides[dependencyName]).toBe('1.0.0-rc.151')

			const lockPath = packagePath === 'package.json' ? join(repositoryRoot, 'bun.lock') : join(repositoryRoot, packagePath, '..', 'bun.lock')
			const lock = await readFile(lockPath, 'utf8')
			expect(lock).toContain('"@tevm/actions": ["@tevm/actions@1.0.0-rc.151"')
			expect(lock).not.toContain('"@tevm/actions": ["@tevm/actions@1.0.0-rc.153"')
		}
	})

	test('active workflows replace every stale monolithic UI setup command', async () => {
		const activeSources = await Promise.all([readFile(ciWorkflowPath, 'utf8'), readFile(deployTestnetWorkflowPath, 'utf8'), readFile(setupActionPath, 'utf8'), readFile(setupComponentActionPath, 'utf8')])
		for (const source of activeSources) {
			expect(source).not.toMatch(/\(cd ui &&|ui\/bun\.lock|ui\/package\.json|ui\/dist(?:\s|$)|ui\/ts\//)
		}
	})

	test('one tag workflow owns releases and advertises every published app', async () => {
		const ipfsWorkflow = await readFile(ipfsDeployWorkflowPath, 'utf8')
		const versionWorkflow = await readFile(versionDeployWorkflowPath, 'utf8')
		expect(ipfsWorkflow).not.toMatch(/push:\s*\n\s*tags:/)
		expect(versionWorkflow).toContain('push:\n    tags:')
		expect(versionWorkflow).toContain('Create or update GitHub release')
		for (const appId of ['zoltar', 'statoblast', 'trading']) expect(versionWorkflow).toContain(`/\${IPFS_CID}/${appId}/`)
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
