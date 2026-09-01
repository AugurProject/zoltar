import { describe, expect, test } from 'bun:test'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const repositoryRoot = join(import.meta.dir, '..')
const activeCiWorkflowPath = join(repositoryRoot, '.github', 'workflows', 'ci.yml')
const stagedCiWorkflowPath = join(repositoryRoot, 'workflow-changes', 'ci.yml')
const browserWorkflowPath = join(repositoryRoot, '.github', 'workflows', 'browser-workflow.yml')
const activeCoverageWorkflowPath = join(repositoryRoot, '.github', 'workflows', 'coverage.yml')
const stagedCoverageWorkflowPath = join(repositoryRoot, 'workflow', 'coverage.yml')
const coverageWorkflowPath = (await Bun.file(stagedCoverageWorkflowPath).exists()) ? stagedCoverageWorkflowPath : activeCoverageWorkflowPath
const testDomainsWorkflowPath = join(repositoryRoot, '.github', 'workflows', 'test-domains.yml')
const testStabilityWorkflowPath = join(repositoryRoot, '.github', 'workflows', 'test-stability.yml')
const deployTestnetWorkflowPath = join(repositoryRoot, '.github', 'workflows', 'deploy-testnet.yml')
const setupActionPath = join(repositoryRoot, '.github', 'actions', 'setup-ci', 'action.yml')
const setupComponentActionPath = join(repositoryRoot, '.github', 'actions', 'setup-component', 'action.yml')
const ipfsDeployWorkflowPath = join(repositoryRoot, '.github', 'workflows', 'ipfs-deploy.yml')
const versionDeployWorkflowPath = join(repositoryRoot, '.github', 'workflows', 'version-deploy.yml')
const dockerfilePath = join(repositoryRoot, 'ui', 'Dockerfile')
const rootPackagePath = join(repositoryRoot, 'package.json')
const tradingPackagePath = join(repositoryRoot, 'ui', 'trading', 'package.json')
const developerDocumentation = [
	{ path: join(repositoryRoot, 'README.md'), command: 'bun run app:serve:zoltar', port: '4153' },
	{ path: join(repositoryRoot, 'testnetwork', 'README.md'), command: 'bun run app:serve:zoltar', port: '4153' },
	{ path: join(repositoryRoot, 'solidity', 'docs', 'trading', 'how-to', 'deploy.md'), command: 'bun run app:serve:trading', port: '4163' },
]
const tevmPackagePaths = ['package.json', 'ui/coreShared/package.json', 'ui/zoltar/package.json', 'ui/statoblast/package.json', 'ui/trading/package.json'] as const
const pinnedTevmTransitives = ['@tevm/actions', '@tevm/node', '@tevm/server'] as const
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const requireRecord = (value: unknown, label: string) => {
	if (!isRecord(value)) throw new Error(`${label} must be a YAML mapping`)
	return value
}
const readWorkflow = async (workflowPath: string) => requireRecord(Bun.YAML.parse(await readFile(workflowPath, 'utf8')), workflowPath)
const workflowJobs = (workflow: Record<string, unknown>) => requireRecord(workflow['jobs'], 'workflow jobs')
const workflowSteps = (job: unknown) => {
	const steps = requireRecord(job, 'workflow job')['steps']
	if (!Array.isArray(steps)) throw new Error('workflow job steps must be a sequence')
	return steps.map((step, index) => requireRecord(step, `workflow step ${index.toString()}`))
}
describe('split UI workflow paths', () => {
	test('CI validation cannot be diverted to a staged workflow copy', async () => {
		await expect(access(stagedCiWorkflowPath)).rejects.toThrow()
	})

	test('split CI remains callable by the version release workflow', async () => {
		const workflow = await readWorkflow(activeCiWorkflowPath)
		expect(requireRecord(workflow['on'], 'CI triggers')).toHaveProperty('workflow_call')
		const releaseWorkflow = await readWorkflow(join(repositoryRoot, '.github', 'workflows', 'version-deploy.yml'))
		const releaseJobs = workflowJobs(releaseWorkflow)
		expect(Object.values(releaseJobs).some(job => isRecord(job) && job['uses'] === './.github/workflows/ci.yml')).toBe(true)
	})

	test('production artifacts preserve app dist and JavaScript paths when uploaded and restored', async () => {
		const workflow = await readFile(testDomainsWorkflowPath, 'utf8')
		expect(workflow).toContain('ui/coreShared/js\n            ui/zoltar/js\n            ui/statoblast/js\n            ui/trading/js\n            ui/zoltar/dist\n            ui/statoblast/dist\n            ui/trading/dist')
		expect(workflow).toContain('uses: actions/download-artifact@v5\n        with:\n          name: domain-production-ui\n          path: ui')
		const downloadIndex = workflow.indexOf('name: domain-production-ui\n          path: ui')
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

	test('CI isolates the production browser workflow', async () => {
		const workflow = await readWorkflow(browserWorkflowPath)
		expect(workflow['name']).toBe('Production Browser Workflow')
		const steps = Object.values(workflowJobs(workflow)).flatMap(workflowSteps)
		expect(steps.some(step => step['run'] === 'bun run test:browser:smoke')).toBe(true)
		expect(steps.some(step => step['run'] === 'bun run test:browser:workflow')).toBe(true)
	})

	test('manual coverage publishes and retains the canonical policy report', async () => {
		const workflow = await readWorkflow(coverageWorkflowPath)
		const triggers = requireRecord(workflow['on'], 'coverage triggers')
		expect(Object.keys(triggers)).toEqual(['workflow_dispatch'])
		const steps = Object.values(workflowJobs(workflow)).flatMap(workflowSteps)
		expect(steps.some(step => step['run'] === 'bun run coverage:fast')).toBe(false)
		expect(steps.some(step => step['run'] === 'bun run coverage:full')).toBe(true)
		const publisher = steps.find(step => typeof step['run'] === 'string' && step['run'].includes('coverage/coverage-summary.md'))
		expect(publisher).toBeDefined()
		const upload = steps.find(step => step['uses'] === 'actions/upload-artifact@v4')
		expect(requireRecord(upload?.['with'], 'coverage upload options')['name']).toBe('coverage-report')
	})

	test('split CI partitions application and Solidity tests and adds pull-request quality gates', async () => {
		const testDomainsWorkflow = await readWorkflow(testDomainsWorkflowPath)
		const testDomainTriggers = requireRecord(testDomainsWorkflow['on'], 'test-domain triggers')
		const workflowCall = requireRecord(testDomainTriggers['workflow_call'], 'reusable test-domain trigger')
		const workflowCallInputs = requireRecord(workflowCall['inputs'], 'reusable test-domain inputs')
		const invocationInput = requireRecord(workflowCallInputs['invocation'], 'reusable invocation input')
		expect(invocationInput['default']).toBe('reusable')
		expect(testDomainTriggers).not.toHaveProperty('pull_request')
		expect(testDomainTriggers).not.toHaveProperty('push')
		expect(testDomainTriggers).toHaveProperty('workflow_dispatch')
		const testDomainConcurrency = requireRecord(testDomainsWorkflow['concurrency'], 'test-domain concurrency')
		expect(testDomainConcurrency['group']).toContain("${{ inputs.invocation || 'direct' }}")
		const concurrencyInvocation = (invocation: string | undefined) => invocation ?? 'direct'
		expect(concurrencyInvocation(undefined)).not.toBe(concurrencyInvocation(String(invocationInput['default'])))
		const ciWorkflow = await readWorkflow(activeCiWorkflowPath)
		const ciJobs = workflowJobs(ciWorkflow)
		const domainTestsJob = requireRecord(ciJobs['domain-tests'], 'CI domain-tests job')
		expect(domainTestsJob['uses']).toBe('./.github/workflows/test-domains.yml')
		expect(domainTestsJob['if']).toBe("needs.changes.outputs.core == 'true'")
		expect(ciJobs).not.toHaveProperty('tests')
		expect(ciJobs).not.toHaveProperty('test-timings')
		const domainSteps = Object.values(workflowJobs(testDomainsWorkflow)).flatMap(workflowSteps)
		const domainCommands = domainSteps.flatMap(step => (typeof step['run'] === 'string' ? [step['run']] : []))
		expect(domainCommands.some(command => command.includes('bun run ui:build:apps\nbun ./scripts/install-frozen.mts ui/statoblast\nbun run ci:preflight:current'))).toBe(true)
		expect(domainCommands).not.toContain('bun run tsc')
		expect(domainSteps.some(step => typeof step['run'] === 'string' && step['run'].includes('--domain=application'))).toBe(true)
		expect(domainSteps.some(step => typeof step['run'] === 'string' && step['run'].includes('--domain=solidity'))).toBe(true)
		expect(domainSteps.some(step => step['run'] === 'bun run test:mutation:smoke')).toBe(true)

		const stabilityWorkflow = await readWorkflow(testStabilityWorkflowPath)
		const stabilitySteps = Object.values(workflowJobs(stabilityWorkflow)).flatMap(workflowSteps)
		expect(stabilitySteps.some(step => typeof step['run'] === 'string' && step['run'].includes('indexer-lifecycle.test.ts'))).toBe(true)
		expect(stabilitySteps.some(step => typeof step['run'] === 'string' && step['run'].includes('without retries'))).toBe(true)
	})

	test('contract caches and transferred inputs include the generated Trading artifact', async () => {
		const setupAction = await readFile(setupActionPath, 'utf8')
		expect(setupAction).toContain('ui/trading/ts/generated/contractArtifact.ts')

		const workflow = await readFile(activeCiWorkflowPath, 'utf8')
		expect(workflow.match(/ui\/trading\/ts\/generated\/contractArtifact\.ts/g)).toHaveLength(2)
	})

	test('Trading-owned compile and test commands explicitly generate Trading artifacts', async () => {
		const packageJson = JSON.parse(await readFile(rootPackagePath, 'utf8')) as { scripts?: Record<string, string> }
		const tradingPackageJson = JSON.parse(await readFile(tradingPackagePath, 'utf8')) as { scripts?: Record<string, string> }
		expect(packageJson.scripts?.['trading:compile']).toContain('bun ./ui/coreShared/build/vendor.mts trading')
		expect(packageJson.scripts?.['trading:test']).toContain('bun ./ui/coreShared/build/vendor.mts trading')
		expect(packageJson.scripts?.['tsc:app']).toStartWith('bun ./ui/coreShared/build/vendor.mts trading')
		expect(packageJson.scripts?.['coverage:ui']).toContain('bun ./ui/coreShared/build/vendor.mts trading')
		expect(packageJson.scripts?.['coverage:typescript']).toContain('bun ./ui/coreShared/build/vendor.mts trading')
		expect(tradingPackageJson.scripts?.['test']).toStartWith('bun run generate')
		expect(tradingPackageJson.scripts?.['watch']).toStartWith('bun run generate')
	})

	test('clean CI emits the complete UI dependency DAG while testnet deployment stays headless', async () => {
		const ciWorkflow = await readFile(activeCiWorkflowPath, 'utf8')
		const buildIndex = ciWorkflow.indexOf('bun run ui:build:apps')
		const preflightIndex = ciWorkflow.indexOf('bun run ci:preflight:current')
		expect(buildIndex).toBeGreaterThan(0)
		expect(preflightIndex).toBeGreaterThan(buildIndex)

		const deployWorkflow = await readFile(deployTestnetWorkflowPath, 'utf8')
		for (const packageId of ['coreShared', 'zoltar', 'statoblast', 'trading']) {
			expect(deployWorkflow).not.toContain(`(cd ui/${packageId} && bun install --frozen-lockfile)`)
		}
		expect(deployWorkflow).toContain('(cd solidity && bun install --frozen-lockfile)')
		expect(deployWorkflow).not.toContain('bun run ui:build:apps')
		expect(deployWorkflow).toContain('bun ./scripts/ensure-contract-artifacts.mts --headless')
		expect(deployWorkflow).toContain('bun ./scripts/run-deploy-testnet.mts --help')
		expect(deployWorkflow).not.toContain('bun ./scripts/deploy-testnet.mts --help')
	})

	test('CI refreshes deployment runtime dependencies before the parallel preflight', async () => {
		const ciWorkflow = await readFile(activeCiWorkflowPath, 'utf8')
		const buildIndex = ciWorkflow.indexOf('bun run ui:build:apps')
		const refreshIndex = ciWorkflow.indexOf('bun ./scripts/install-frozen.mts ui/statoblast', buildIndex)
		const preflightIndex = ciWorkflow.indexOf('bun run ci:preflight:current', buildIndex)
		expect(buildIndex).toBeGreaterThan(0)
		expect(refreshIndex).toBeGreaterThan(buildIndex)
		expect(preflightIndex).toBeGreaterThan(refreshIndex)
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

	test('dead-code CI installs every bot workspace before analyzing it', async () => {
		const workflow = await readFile(activeCiWorkflowPath, 'utf8')
		const deadCodeJobStart = workflow.indexOf('  knip:\n')
		const auditJobStart = workflow.indexOf('  audit:\n', deadCodeJobStart)
		expect(deadCodeJobStart).toBeGreaterThan(0)
		expect(auditJobStart).toBeGreaterThan(deadCodeJobStart)
		const deadCodeJob = workflow.slice(deadCodeJobStart, auditJobStart)
		const setupIndex = deadCodeJob.indexOf('uses: ./.github/actions/setup-ci')
		const knipIndex = deadCodeJob.indexOf('bun run knip')
		expect(setupIndex).toBeGreaterThan(0)
		expect(knipIndex).toBeGreaterThan(0)
		expect(setupIndex).toBeLessThan(knipIndex)

		const setupAction = await readFile(setupActionPath, 'utf8')
		const botInstallStep = setupAction.indexOf('name: Install bot workspace dependencies for dead code analysis')
		expect(botInstallStep).toBeGreaterThan(0)
		expect(setupAction.slice(botInstallStep)).toContain("if: github.job == 'knip'")
		for (const packageId of ['shared', 'open-oracle-arbitrager', 'liquidator']) {
			const installIndex = setupAction.indexOf(`bun ./scripts/install-frozen.mts bots/${packageId}`, botInstallStep)
			expect(installIndex).toBeGreaterThan(0)
		}
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

	test('activatable workflows replace every stale monolithic UI setup command', async () => {
		const activeSources = await Promise.all([readFile(activeCiWorkflowPath, 'utf8'), readFile(deployTestnetWorkflowPath, 'utf8'), readFile(setupActionPath, 'utf8'), readFile(setupComponentActionPath, 'utf8')])
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
