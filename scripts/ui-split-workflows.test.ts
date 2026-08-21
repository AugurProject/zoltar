import { describe, expect, test } from 'bun:test'
import { access, cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repositoryRoot = join(import.meta.dir, '..')
const ciWorkflowPath = join(repositoryRoot, 'workflow-changes', 'ci.yml')
const deployTestnetWorkflowPath = join(repositoryRoot, 'workflow-changes', 'deploy-testnet.yml')
const setupActionPath = join(repositoryRoot, 'workflow-changes', 'setup-ci-action.yml')
const setupComponentActionPath = join(repositoryRoot, 'workflow-changes', 'setup-component-action.yml')
const ipfsDeployWorkflowPath = join(repositoryRoot, 'workflow-changes', 'ipfs-deploy.yml')
const versionDeployWorkflowPath = join(repositoryRoot, 'workflow-changes', 'version-deploy.yml')
const activeCiWorkflowPath = join(repositoryRoot, '.github', 'workflows', 'ci.yml')
const stagedCiWorkflowPath = join(repositoryRoot, 'workflows', 'ci.yml')
const activeSetupActionPath = join(repositoryRoot, '.github', 'actions', 'setup-ci', 'action.yml')
const activeSetupComponentActionPath = join(repositoryRoot, '.github', 'actions', 'setup-component', 'action.yml')
const dockerfilePath = join(repositoryRoot, 'ui', 'Dockerfile')
const developerDocumentation = [
	{ path: join(repositoryRoot, 'README.md'), command: 'bun run app:serve:zoltar', port: '12346' },
	{ path: join(repositoryRoot, 'testnetwork', 'README.md'), command: 'bun run app:serve:zoltar', port: '12346' },
	{ path: join(repositoryRoot, 'solidity', 'docs', 'trading', 'how-to', 'deploy.md'), command: 'bun run app:serve:trading', port: '4163' },
]

const getActivatableCiWorkflowPath = async () => {
	try {
		await access(stagedCiWorkflowPath)
		return stagedCiWorkflowPath
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return activeCiWorkflowPath
		throw error
	}
}

describe('split UI workflow paths', () => {
	test('the activatable CI file uses the reviewed split-package workflow handoff', async () => {
		const activatableCiWorkflowPath = await getActivatableCiWorkflowPath()
		for (const [activePath, handoffPath] of [
			[activatableCiWorkflowPath, ciWorkflowPath],
			[activeSetupActionPath, setupActionPath],
			[activeSetupComponentActionPath, setupComponentActionPath],
		] as const) {
			expect(await readFile(activePath, 'utf8')).toBe(await readFile(handoffPath, 'utf8'))
		}
	})

	test('split CI remains callable by the version release workflow', async () => {
		const workflow = await readFile(await getActivatableCiWorkflowPath(), 'utf8')
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
		expect(dockerfile.match(/bun install --frozen-lockfile/g)?.length).toBeGreaterThanOrEqual(3)
	})

	test('the workflow handoff replaces every stale monolithic UI setup command', async () => {
		const temporaryRoot = await mkdtemp(join(tmpdir(), 'zoltar-workflow-handoff-'))
		try {
			await cp(join(repositoryRoot, '.github'), join(temporaryRoot, '.github'), { recursive: true })
			for (const [source, destination] of [
				[ciWorkflowPath, join(temporaryRoot, '.github', 'workflows', 'ci.yml')],
				[deployTestnetWorkflowPath, join(temporaryRoot, '.github', 'workflows', 'deploy-testnet.yml')],
				[ipfsDeployWorkflowPath, join(temporaryRoot, '.github', 'workflows', 'ipfs-deploy.yml')],
				[versionDeployWorkflowPath, join(temporaryRoot, '.github', 'workflows', 'version-deploy.yml')],
				[setupActionPath, join(temporaryRoot, '.github', 'actions', 'setup-ci', 'action.yml')],
				[setupComponentActionPath, join(temporaryRoot, '.github', 'actions', 'setup-component', 'action.yml')],
			] as const) {
				await cp(source, destination)
			}
			const activeSources = await Promise.all([
				readFile(join(temporaryRoot, '.github', 'workflows', 'ci.yml'), 'utf8'),
				readFile(join(temporaryRoot, '.github', 'workflows', 'deploy-testnet.yml'), 'utf8'),
				readFile(join(temporaryRoot, '.github', 'actions', 'setup-ci', 'action.yml'), 'utf8'),
				readFile(join(temporaryRoot, '.github', 'actions', 'setup-component', 'action.yml'), 'utf8'),
			])
			for (const source of activeSources) {
				expect(source).not.toMatch(/\(cd ui &&|ui\/bun\.lock|ui\/package\.json|ui\/dist(?:\s|$)|ui\/ts\//)
			}
		} finally {
			await rm(temporaryRoot, { force: true, recursive: true })
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
