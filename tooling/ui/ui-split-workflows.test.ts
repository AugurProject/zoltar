import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { taskProjects } from '../repo/projects.ts'
import { projectQuery } from '../repo/query-projects.mts'
import { PRODUCTION_WORKFLOW_SCENARIOS } from './productionWorkflowScenarios.ts'
import { repositoryRoot } from '../repo/root.mts'
import { dockerGlobalArguments, dockerInstructions, parseDockerfile } from '../testing/packaging-parsers.ts'

// Validate pending workflow definitions until they are moved into GitHub's active directory.
const workflowDefinitionPath = (name: string) => {
	const pendingPath = join(repositoryRoot, 'workflow', name)
	return existsSync(pendingPath) ? pendingPath : join(repositoryRoot, '.github', 'workflows', name)
}
const ciWorkflowPath = workflowDefinitionPath('ci.yml')
const browserWorkflowPath = workflowDefinitionPath('browser-workflow.yml')
const coverageWorkflowPath = workflowDefinitionPath('coverage.yml')
const testDomainsWorkflowPath = workflowDefinitionPath('test-domains.yml')
const testStabilityWorkflowPath = workflowDefinitionPath('test-stability.yml')
const deployTestnetWorkflowPath = join(repositoryRoot, '.github', 'workflows/deploy-testnet.yml')
const setupActionPath = join(repositoryRoot, '.github', 'actions/setup-ci/action.yml')
const setupComponentActionPath = join(repositoryRoot, '.github', 'actions/setup-component/action.yml')
const ipfsDeployWorkflowPath = workflowDefinitionPath('ipfs-deploy.yml')
const versionDeployWorkflowPath = workflowDefinitionPath('version-deploy.yml')
const dockerfilePath = join(repositoryRoot, 'ui', 'Dockerfile')
const rootPackagePath = join(repositoryRoot, 'package.json')
const tradingPackagePath = join(repositoryRoot, 'ui', 'trading', 'package.json')
const sharedLibraryPackagePaths = ['ui/zoltarShared/package.json', 'ui/statoblastShared/package.json'] as const
const developerDocumentation = [
	{ path: join(repositoryRoot, 'README.md'), command: 'bun run app:serve:zoltar', port: '4153' },
	{ path: join(repositoryRoot, 'testnetwork', 'README.md'), command: 'bun run app:serve:zoltar', port: '4153' },
	{ path: join(repositoryRoot, 'docs', 'how-to', 'trading-set-up-development.html'), command: 'bun run app:serve:trading', port: '4163' },
]
const uiPackageIds = ['coreShared', 'zoltarShared', 'statoblastShared', 'zoltar', 'statoblast', 'trading'] as const
const tevmPackagePaths = ['package.json', 'ui/coreShared/package.json', 'ui/zoltarShared/package.json', 'ui/statoblastShared/package.json', 'ui/zoltar/package.json', 'ui/statoblast/package.json', 'ui/trading/package.json'] as const
const pinnedTevmTransitives = ['@tevm/actions', '@tevm/node'] as const
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
const usesAction = (step: Record<string, unknown>, action: string) => typeof step['uses'] === 'string' && step['uses'].startsWith(`${action}@`)
const workflowTestPaths = (workflow: Record<string, unknown>) =>
	Object.values(workflowJobs(workflow)).flatMap(job =>
		workflowSteps(job).flatMap(step => {
			const command = step['run']
			if (typeof command !== 'string') return []
			const workingDirectory = step['working-directory']
			if (workingDirectory !== undefined && typeof workingDirectory !== 'string') throw new Error('workflow working-directory must be a string')
			return [...command.matchAll(/(?:^|\s)([A-Za-z0-9_./-]+\.test\.(?:ts|tsx))(?=\s|$)/gu)].map(match => join(workingDirectory ?? '', match[1] ?? '').replaceAll('\\', '/'))
		}),
	)
describe('split UI workflow definitions (pending updates when present)', () => {
	test('CI keeps formatting and the unused incremental cache off the production build path', async () => {
		const jobs = workflowJobs(await readWorkflow(ciWorkflowPath))
		const prepare = workflowSteps(jobs['prepare'])
		expect(prepare.some(step => step['run'] === 'bun run format')).toBe(false)
		expect(prepare.some(step => isRecord(step['with']) && step['with']['path'] === '.tsbuildinfo')).toBe(false)
		expect(workflowSteps(jobs['checks']).some(step => step['run'] === 'bun run format:check')).toBe(true)
		expect(workflowSteps(jobs['checks']).some(step => step['run'] === 'bun run ci:typecheck:current')).toBe(true)
		expect(prepare.some(step => String(step['run']).includes('ci:preflight:current'))).toBe(false)
		expect(requireRecord(jobs['checks'], 'repository checks')['needs']).toEqual(['changes', 'build-inputs'])
		expect(requireRecord(jobs['browser-workflow'], 'browser workflow')['needs']).toEqual(['changes', 'prepare'])
	})

	test('the browser matrix covers every scenario once and each job selects its own test', async () => {
		const workflow = await readWorkflow(browserWorkflowPath)
		const jobs = workflowJobs(workflow)
		const job = requireRecord(jobs['browser-workflow'], 'browser matrix job')
		const strategy = requireRecord(job['strategy'], 'browser matrix strategy')
		expect(strategy['fail-fast']).toBe(false)
		expect(requireRecord(strategy['matrix'], 'browser matrix')['scenario']).toEqual(PRODUCTION_WORKFLOW_SCENARIOS)
		const run = workflowSteps(job).find(step => step['run'] === 'bun run test:browser:workflow')
		expect(requireRecord(run?.['env'], 'browser scenario selection')).toMatchObject({ ZOLTAR_BROWSER_WORKFLOW_SCENARIO: '${{ matrix.scenario }}', ZOLTAR_USE_EXISTING_PRODUCTION_BUILD: '1' })
		expect(job['continue-on-error']).toBeUndefined()
		expect(job['needs']).toBe('prepare')
		expect(job['if']).toBe("always() && !cancelled() && (needs.prepare.result == 'success' || (inputs.prepared && needs.prepare.result == 'skipped'))")
		const prepare = requireRecord(jobs['prepare'], 'standalone browser preparation')
		expect(prepare['if']).toBe('inputs.prepared != true')
		const upload = workflowSteps(prepare).find(step => usesAction(step, 'actions/upload-artifact'))
		expect(requireRecord(upload?.['with'], 'standalone production artifact')).toMatchObject({ name: 'domain-production-ui', path: '${{ steps.projects.outputs.ui_artifact_outputs }}' })
		const scripts = requireRecord(requireRecord(JSON.parse(await readFile(rootPackagePath, 'utf8')), 'root package')['scripts'], 'root scripts')
		expect(scripts['test:browser:workflow']).toContain("--test-name-pattern '^production workflow:'")
	})

	test('workflows and composite actions pin every external action to a full commit SHA', async () => {
		const definitionPaths = [...(await readdir(join(repositoryRoot, '.github', 'workflows'))).filter(name => /\.ya?ml$/u.test(name)).map(workflowDefinitionPath), ...(await readdir(join(repositoryRoot, '.github', 'actions'))).map(name => join(repositoryRoot, '.github', 'actions', name, 'action.yml'))]
		const unpinned = []
		for (const definitionPath of definitionPaths) {
			const source = await readFile(definitionPath, 'utf8')
			for (const match of source.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gmu)) {
				const reference = match[1] ?? ''
				if (reference.startsWith('./')) continue
				if (!/^[^@\s]+@[0-9a-f]{40}$/u.test(reference)) unpinned.push(`${definitionPath}: ${reference}`)
			}
		}
		expect(unpinned).toEqual([])
	})

	test('workflows have no time-based triggers', async () => {
		const directory = join(repositoryRoot, '.github', 'workflows')
		const scheduled = []
		for (const name of await readdir(directory)) {
			if (!/\.ya?ml$/u.test(name)) continue
			const triggers = requireRecord((await readWorkflow(workflowDefinitionPath(name)))['on'], `${name} triggers`)
			if ('schedule' in triggers) scheduled.push(name)
		}
		expect(scheduled).toEqual([])
	})

	test('IPFS publication pins CI and manual dispatch revisions even if the branch advances during validation', async () => {
		const jobs = workflowJobs(await readWorkflow(ipfsDeployWorkflowPath))
		const steps = workflowSteps(jobs['publish'])
		const checkout = steps.find(step => typeof step['uses'] === 'string' && step['uses'].startsWith('actions/checkout@'))
		// A manual dispatch records github.sha; github.ref can advance while its validation runs.
		expect(requireRecord(checkout?.['with'], 'IPFS checkout inputs')['ref']).toBe('${{ github.event.workflow_run.head_sha || github.sha }}')
		const setup = steps.find(step => step['uses'] === './.github/actions/setup-bun')
		expect(setup).toBeDefined()
		expect(setup?.['with']).toBeUndefined()
	})

	test('CI requires browser transactions before allowing publication', async () => {
		const jobs = workflowJobs(await readWorkflow(ciWorkflowPath))
		const required = requireRecord(jobs['required'], 'required CI gate')
		const browser = requireRecord(jobs['browser-workflow'], 'browser workflow')
		expect(browser['uses']).toBe('./.github/workflows/browser-workflow.yml')
		expect(browser['if']).toBe("needs.changes.outputs.core == 'true'")
		expect(required['needs']).toContain('browser-workflow')
		const release = workflowJobs(await readWorkflow(versionDeployWorkflowPath))
		expect(requireRecord(release['deploy'], 'release deployment')['needs']).toBe('tests')
		expect(requireRecord(release['tests'], 'release tests')['uses']).toBe('./.github/workflows/ci.yml')
		const publish = workflowJobs(await readWorkflow(ipfsDeployWorkflowPath))
		expect(requireRecord(publish['validate-manual'], 'manual validation')['uses']).toBe('./.github/workflows/ci.yml')
		expect(requireRecord(publish['publish'], 'publication')['needs']).toBe('validate-manual')
	})

	test('latest promotion serializes publishers and rejects stale commits', async () => {
		const jobs = workflowJobs(await readWorkflow(ipfsDeployWorkflowPath))
		const promotion = requireRecord(jobs['promote'], 'latest promotion')
		expect(requireRecord(promotion['concurrency'], 'promotion concurrency')).toEqual({ group: 'ipfs-latest', 'cancel-in-progress': false, queue: 'max' })
		expect(promotion['needs']).toBe('publish')
		const step = workflowSteps(promotion).find(step => step['name'] === 'Promote current main revision')
		const command = step?.['run']
		if (typeof command !== 'string') throw new Error('Missing promotion command')
		for (const current of ['candidate', 'newer']) {
			const result = spawnSync(
				'bash',
				[
					'-e',
					'-c',
					`gh() { echo "$CURRENT_MAIN"; }
docker() { echo "PROMOTED $*"; }
${command}`,
				],
				{
					env: { CURRENT_MAIN: current, CANDIDATE_SHA: 'candidate', IMAGE_NAME: 'ghcr.io/example/app', GITHUB_REPOSITORY: 'example/app' },
					encoding: 'utf8',
				},
			)
			expect(result.status).toBe(0)
			expect(result.stdout.includes('PROMOTED')).toBe(current === 'candidate')
			if (current === 'candidate') expect(result.stdout).toContain('ghcr.io/example/app:sha-candidate')
		}
	})

	test('GitHub release promotion always chooses the highest published version under a shared lock', async () => {
		const jobs = workflowJobs(await readWorkflow(versionDeployWorkflowPath))
		const deploy = workflowSteps(jobs['deploy']).find(step => step['name'] === 'Create or update GitHub release')
		expect(deploy?.['run']).toContain('--latest=false')
		const promotion = requireRecord(jobs['promote-release'], 'release promotion')
		expect(promotion['needs']).toBe('deploy')
		expect(requireRecord(promotion['concurrency'], 'release promotion concurrency')).toEqual({ group: 'version-release-latest', 'cancel-in-progress': false, queue: 'max' })
		const command = workflowSteps(promotion).find(step => step['name'] === 'Promote highest published version')?.['run']
		if (typeof command !== 'string') throw new Error('Missing release promotion command')
		for (const triggeringTag of ['v9', 'v10', 'v11']) {
			const result = spawnSync(
				'bash',
				[
					'-e',
					'-o',
					'pipefail',
					'-c',
					`gh() {
 if [[ "$1" == "api" ]]; then printf '%s\n' v9 v11 v10 nightly; else echo "PROMOTED $*"; fi
}
${command}`,
				],
				{ env: { GITHUB_REPOSITORY: 'example/app', GITHUB_REF_NAME: triggeringTag }, encoding: 'utf8' },
			)
			expect(result.status).toBe(0)
			expect(result.stdout).toContain('release edit v11 --repo example/app --latest')
		}
		const unavailable = spawnSync(
			'bash',
			[
				'-e',
				'-o',
				'pipefail',
				'-c',
				`gh() { if [[ "$1" == "api" ]]; then return 1; else echo 'PROMOTED'; fi; }
${command}`,
			],
			{ env: { GITHUB_REPOSITORY: 'example/app' }, encoding: 'utf8' },
		)
		expect(unavailable.status).not.toBe(0)
		expect(unavailable.stdout).not.toContain('PROMOTED')
	})

	test('CI validates test ownership before scope-dependent jobs', async () => {
		const jobs = workflowJobs(await readWorkflow(ciWorkflowPath))
		const changesSteps = workflowSteps(jobs['changes'])
		expect(changesSteps.some(step => step['run'] === 'bun run test:preflight')).toBe(true)
	})
	test('AugurScan uses the canonical CI jobs without a duplicate workflow', async () => {
		await expect(access(join(repositoryRoot, '.github', 'workflows', 'augur-scan.yml'))).rejects.toThrow()
	})

	test('split CI remains callable by the version release workflow', async () => {
		const workflow = await readWorkflow(ciWorkflowPath)
		expect(requireRecord(workflow['on'], 'CI triggers')).toHaveProperty('workflow_call')
		const releaseWorkflow = await readWorkflow(versionDeployWorkflowPath)
		const releaseJobs = workflowJobs(releaseWorkflow)
		expect(Object.values(releaseJobs).some(job => isRecord(job) && job['uses'] === './.github/workflows/ci.yml')).toBe(true)
	})

	test('production artifacts preserve app dist and JavaScript paths when uploaded and restored', async () => {
		const workflow = await readWorkflow(testDomainsWorkflowPath)
		const jobs = workflowJobs(workflow)
		const prepareSteps = workflowSteps(jobs['prepare'])
		const upload = prepareSteps.find(step => usesAction(step, 'actions/upload-artifact'))
		const uploadOptions = requireRecord(upload?.['with'], 'production UI artifact upload options')
		expect(uploadOptions['path']).toBe('${{ steps.projects.outputs.ui_artifact_outputs }}')
		expect((await projectQuery()).uiArtifactOutputs).toEqual(['ui/coreShared/js', 'ui/zoltarShared/js', 'ui/statoblastShared/js', 'ui/zoltar/js', 'ui/zoltar/dist', 'ui/statoblast/js', 'ui/statoblast/dist', 'ui/trading/js', 'ui/trading/dist'])
		expect(prepareSteps.findIndex(step => step['id'] === 'projects')).toBeLessThan(prepareSteps.indexOf(upload ?? {}))
		expect(uploadOptions['name']).toBe('domain-production-ui')
		expect(uploadOptions['if-no-files-found']).toBe('error')

		const applicationSteps = workflowSteps(jobs['application-tests'])
		const downloadIndex = applicationSteps.findIndex(step => usesAction(step, 'actions/download-artifact'))
		const downloadOptions = requireRecord(applicationSteps[downloadIndex]?.['with'], 'production UI artifact download options')
		expect(downloadOptions).toMatchObject({ name: uploadOptions['name'], path: 'ui' })

		const refreshStep = applicationSteps.slice(downloadIndex + 1).find(step => step['name'] === 'Refresh split UI package installs')
		expect(refreshStep).toBeUndefined()
		expect((await projectQuery()).setupProjectPaths.filter(projectPath => projectPath.startsWith('ui/'))).toEqual(uiPackageIds.map(packageId => `ui/${packageId}`))
	})

	test('browser workflow gates expensive steps using the canonical CI classifier', async () => {
		const workflow = await readWorkflow(browserWorkflowPath)
		const triggers = requireRecord(workflow['on'], 'browser workflow triggers')
		expect(triggers).toHaveProperty('workflow_call')
		expect(triggers).not.toHaveProperty('pull_request')
		expect(triggers).toHaveProperty('workflow_dispatch')
		const job = requireRecord(workflowJobs(workflow)['browser-workflow'], 'browser workflow job')
		const steps = workflowSteps(job)
		const checkout = steps.find(step => typeof step['uses'] === 'string' && step['uses'].startsWith('actions/checkout@'))
		expect(requireRecord(checkout?.['with'], 'browser checkout options')['fetch-depth']).toBe(0)
		const scope = steps.find(step => step['id'] === 'scope')
		expect(scope).toBeDefined()
		expect(requireRecord(scope?.['env'], 'browser scope environment')['BASE_SHA']).toBe('${{ github.event.pull_request.base.sha }}')
		expect(scope?.['run']).toBe(workflowSteps(workflowJobs(await readWorkflow(ciWorkflowPath))['changes']).find(step => step['id'] === 'scope')?.['run'])
		const setup = steps.find(step => step['uses'] === './.github/actions/setup-ci')
		const run = steps.find(step => step['run'] === 'bun run test:browser:workflow')
		for (const step of [setup, run]) {
			expect(step?.['if']).toBe("steps.scope.outputs.core == 'true'")
			expect(steps.indexOf(step ?? {})).toBeGreaterThan(steps.indexOf(scope ?? {}))
		}
	})

	test('CI isolates the production browser workflow', async () => {
		const workflow = await readWorkflow(browserWorkflowPath)
		expect(workflow['name']).toBe('Production Browser Workflow')
		const steps = Object.values(workflowJobs(workflow)).flatMap(workflowSteps)
		expect(steps.some(step => step['run'] === 'bun run test:browser:smoke')).toBe(true)
		expect(steps.some(step => step['run'] === 'bun run test:browser:workflow')).toBe(true)
		const ciWorkflow = await readWorkflow(ciWorkflowPath)
		const ciJobs = workflowJobs(ciWorkflow)
		const requiredBrowserJob = requireRecord(ciJobs['browser-smoke'], 'required browser smoke job')
		expect(requiredBrowserJob['if']).toBe("needs.changes.outputs.core == 'true'")
		expect(workflowSteps(requiredBrowserJob).some(step => step['run'] === 'bun run test:browser:smoke')).toBe(true)
		expect(requireRecord(ciJobs['required'], 'required CI result')['needs']).toContain('browser-smoke')
	})

	test('coverage runs only through direct manual dispatch and retains the canonical policy report', async () => {
		const workflow = await readWorkflow(coverageWorkflowPath)
		const triggers = requireRecord(workflow['on'], 'coverage triggers')
		expect(Object.keys(triggers)).toEqual(['workflow_dispatch'])
		const ciJobs = workflowJobs(await readWorkflow(ciWorkflowPath))
		expect(ciJobs).not.toHaveProperty('coverage')
		const required = requireRecord(ciJobs['required'], 'required CI gate')
		expect(required['needs']).not.toContain('coverage')
		const gate = workflowSteps(required)[0]
		expect(requireRecord(gate?.['env'], 'required CI gate environment')).not.toHaveProperty('COVERAGE_RESULT')
		expect(gate?.['run']).not.toContain('COVERAGE_RESULT')
		const steps = Object.values(workflowJobs(workflow)).flatMap(workflowSteps)
		expect(steps.some(step => step['run'] === 'bun run coverage')).toBe(false)
		expect(steps.some(step => step['run'] === 'bun run coverage:full')).toBe(true)
		const publisher = steps.find(step => typeof step['run'] === 'string' && step['run'].includes('coverage/coverage-summary.md'))
		expect(publisher).toBeDefined()
		const upload = steps.find(step => usesAction(step, 'actions/upload-artifact'))
		expect(requireRecord(upload?.['with'], 'coverage upload options')['name']).toBe('coverage-report')
	})

	test('split CI partitions application and Solidity tests and adds pull-request quality gates', async () => {
		const testDomainsWorkflow = await readWorkflow(testDomainsWorkflowPath)
		const testDomainTriggers = requireRecord(testDomainsWorkflow['on'], 'test-domain triggers')
		const workflowCall = requireRecord(testDomainTriggers['workflow_call'], 'reusable test-domain trigger')
		const workflowCallInputs = requireRecord(workflowCall['inputs'], 'reusable test-domain inputs')
		const invocationInput = requireRecord(workflowCallInputs['invocation'], 'reusable invocation input')
		expect(invocationInput['default']).toBe('reusable')
		expect(requireRecord(workflowCallInputs['application'], 'application input')).toMatchObject({ type: 'boolean', default: true })
		expect(testDomainTriggers).not.toHaveProperty('pull_request')
		expect(testDomainTriggers).not.toHaveProperty('push')
		const manualInputs = requireRecord(requireRecord(testDomainTriggers['workflow_dispatch'], 'manual domain trigger')['inputs'], 'manual domain inputs')
		expect(requireRecord(manualInputs['application'], 'manual application input')).toMatchObject({ type: 'boolean', default: true })
		const testDomainConcurrency = requireRecord(testDomainsWorkflow['concurrency'], 'test-domain concurrency')
		expect(testDomainConcurrency['group']).toContain("${{ inputs.invocation || 'direct' }}")
		const concurrencyInvocation = (invocation: string | undefined) => invocation ?? 'direct'
		expect(concurrencyInvocation(undefined)).not.toBe(concurrencyInvocation(String(invocationInput['default'])))
		const ciWorkflow = await readWorkflow(ciWorkflowPath)
		const ciJobs = workflowJobs(ciWorkflow)
		const domainTestsJob = requireRecord(ciJobs['domain-tests'], 'CI domain-tests job')
		expect(domainTestsJob['uses']).toBe('./.github/workflows/test-domains.yml')
		expect(domainTestsJob['if']).toBe("needs.changes.outputs.core == 'true' || needs.changes.outputs.infrastructure == 'true'")
		expect(requireRecord(domainTestsJob['with'], 'domain inputs')['application']).toBe(false)
		expect(workflowSteps(ciJobs['infrastructure-checks']).some(step => String(step['run']).includes('bun test'))).toBe(false)
		expect(ciJobs).not.toHaveProperty('tests')
		expect(ciJobs).not.toHaveProperty('test-timings')
		const domainSteps = Object.values(workflowJobs(testDomainsWorkflow)).flatMap(workflowSteps)
		const domainCommands = domainSteps.flatMap(step => (typeof step['run'] === 'string' ? [step['run']] : []))
		expect(domainCommands.some(command => command.includes('bun run ui:build:apps\nbun run ci:preflight:current'))).toBe(true)
		expect(domainCommands).not.toContain('bun run tsc')
		expect(domainSteps.some(step => typeof step['run'] === 'string' && step['run'].includes('--domain=application'))).toBe(true)
		expect(domainSteps.some(step => typeof step['run'] === 'string' && step['run'].includes('--domain=solidity'))).toBe(true)
		expect(domainSteps.some(step => step['run'] === 'bun run test:mutation:smoke')).toBe(true)

		const stabilityWorkflow = await readWorkflow(testStabilityWorkflowPath)
		expect(requireRecord(stabilityWorkflow['on'], 'test-stability triggers')).toHaveProperty('workflow_dispatch')
		const stabilitySteps = Object.values(workflowJobs(stabilityWorkflow)).flatMap(workflowSteps)
		const stabilityTestPaths = workflowTestPaths(stabilityWorkflow).sort()
		expect(stabilityTestPaths).toEqual(['augurScan/tests/api/live.test.ts', 'augurScan/tests/replay/indexer-lifecycle.test.ts', 'tooling/docs/documentation-tools-runtime.test.ts', 'tooling/ui/chromiumPath.test.ts', 'ui/statoblast/ts/tests/features/open-oracle/useRepPrices.test.tsx'].sort())
		await Promise.all(stabilityTestPaths.map(testPath => access(join(repositoryRoot, testPath))))
		expect(stabilitySteps.some(step => typeof step['run'] === 'string' && step['run'].includes('without retries'))).toBe(true)
	})

	test('infrastructure-only runs retain Solidity coverage without application preparation', async () => {
		const ciJobs = workflowJobs(await readWorkflow(ciWorkflowPath))
		const domainJobs = workflowJobs(await readWorkflow(testDomainsWorkflowPath))
		expect(requireRecord(ciJobs['infrastructure-checks'], 'infrastructure checks')['if']).toBe("needs.changes.outputs.infrastructure == 'true' && needs.changes.outputs.core != 'true'")
		expect(requireRecord(domainJobs['prepare'], 'prepare')['if']).toBe('inputs.application && !inputs.prepared')
		expect(requireRecord(domainJobs['mutation-smoke'], 'mutation smoke')['if']).toBe('inputs.application')
		expect(requireRecord(domainJobs['application-tests'], 'application tests')['needs']).toEqual(['prepare', 'timing-history-input'])
		const solidity = requireRecord(domainJobs['solidity-tests'], 'Solidity tests')
		expect(solidity['needs']).toBe('timing-history-input')
		expect(solidity['if']).toBe("inputs.solidity && needs.timing-history-input.result == 'success'")
		expect(requireRecord(requireRecord(solidity['strategy'], 'strategy')['matrix'], 'matrix')['shard']).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
		expect(workflowSteps(solidity).find(step => step['name'] === 'Run balanced Solidity shard')?.['run']).toContain('--shard="${{ matrix.shard }}/8"')
		const history = requireRecord(domainJobs['timing-history'], 'timing history')
		expect(history['if']).toContain("needs.solidity-tests.result == 'success' || needs.application-tests.result == 'success'")
		expect(requireRecord(requireRecord(history['strategy'], 'strategy')['matrix'], 'matrix')['domain']).toBe("${{ fromJSON(needs.application-tests.result != 'success' && '[\"solidity\"]' || (needs.solidity-tests.result == 'success' && '[\"application\", \"solidity\"]' || '[\"application\"]')) }}")
	})

	test('every balanced shard consumes one immutable timing-history snapshot', async () => {
		const jobs = workflowJobs(await readWorkflow(testDomainsWorkflowPath))
		const input = requireRecord(jobs['timing-history-input'], 'timing history input')
		const inputSteps = workflowSteps(input)
		expect(inputSteps.some(step => usesAction(step, 'actions/cache/restore'))).toBe(true)
		expect(inputSteps.some(step => usesAction(step, 'actions/upload-artifact'))).toBe(true)

		for (const jobName of ['application-tests', 'solidity-tests', 'timing-history']) {
			const job = requireRecord(jobs[jobName], jobName)
			expect(requireRecord(job, jobName)['needs']).toContain('timing-history-input')
			const steps = workflowSteps(job)
			expect(steps.some(step => usesAction(step, 'actions/cache/restore'))).toBe(false)
			const download = steps.find(step => usesAction(step, 'actions/download-artifact') && String(requireRecord(step['with'], `${jobName} timing input`)['name']).includes('test-timing-history-input'))
			expect(requireRecord(download?.['with'], `${jobName} timing input`)).toMatchObject({ path: '.ci' })
		}
	})

	test('required gates reject failures, cancellations, and unexpected skips for every selected route', async () => {
		const ciJobs = workflowJobs(await readWorkflow(ciWorkflowPath))
		const required = requireRecord(ciJobs['required'], 'required CI gate')
		expect(required['needs']).toEqual(expect.arrayContaining(['domain-tests', 'infrastructure-checks', 'prepare', 'checks', 'knip', 'audit']))
		const gate = workflowSteps(required)[0]
		const command = gate?.['run']
		if (typeof command !== 'string') throw new Error('Missing required CI gate command')
		const gateEnv = requireRecord(gate?.['env'], 'required CI gate environment')
		expect(gateEnv['DOMAIN_TESTS_SELECTED']).toBe("${{ needs.changes.outputs.core == 'true' || needs.changes.outputs.infrastructure == 'true' }}")
		expect(gateEnv['INFRA_CHECKS_SELECTED']).toBe("${{ needs.changes.outputs.infrastructure == 'true' && needs.changes.outputs.core != 'true' }}")
		for (const core of [false, true])
			for (const infrastructure of [false, true]) {
				const env = Object.fromEntries(Object.keys(gateEnv).map(key => [key, key.endsWith('_RESULT') ? 'skipped' : 'false']))
				Object.assign(env, {
					CHANGES_RESULT: 'success',
					CORE_SELECTED: String(core),
					DOCS_SELECTED: String(core),
					INFRA_SELECTED: String(infrastructure),
					BUILD_INPUTS_SELECTED: String(core || infrastructure),
					DOMAIN_TESTS_SELECTED: String(core || infrastructure),
					INFRA_CHECKS_SELECTED: String(infrastructure && !core),
				})
				const selected = ['CHANGES_RESULT']
				if (core) selected.push('PREPARE_RESULT', 'APPLICATION_TESTS_RESULT', 'DOCS_RESULT', 'BROWSER_SMOKE_RESULT', 'BROWSER_WORKFLOW_RESULT', 'CHECKS_RESULT', 'KNIP_RESULT', 'AUDIT_RESULT')
				if (core || infrastructure) selected.push('DOMAIN_TESTS_RESULT', 'BUILD_INPUTS_RESULT')
				if (infrastructure && !core) selected.push('INFRA_RESULT')
				for (const key of selected) env[key] = 'success'
				expect(spawnSync('bash', ['-e', '-c', command], { env }).status).toBe(0)
				if (!core) for (const result of ['success', 'failure', 'cancelled']) expect(spawnSync('bash', ['-e', '-c', command], { env: { ...env, KNIP_RESULT: result } }).status).not.toBe(0)
				for (const key of selected) for (const result of ['failure', 'cancelled', 'skipped']) expect(spawnSync('bash', ['-e', '-c', command], { env: { ...env, [key]: result } }).status).not.toBe(0)
			}
		const domainJobs = workflowJobs(await readWorkflow(testDomainsWorkflowPath))
		const domainGate = requireRecord(domainJobs['required'], 'domain gate')
		expect(domainGate['if']).toBe('always()')
		expect(domainGate['needs']).toEqual(['prepare', 'application-tests', 'solidity-tests', 'timing-history', 'mutation-smoke'])
		const domainStep = workflowSteps(domainGate)[0]
		expect(requireRecord(domainStep?.['env'], 'domain gate environment')['APPLICATION_SELECTED']).toBe('${{ inputs.application }}')
		const domainCommand = domainStep?.['run']
		if (typeof domainCommand !== 'string') throw new Error('Missing domain gate command')
		for (const application of [false, true])
			for (const solidity of [false, true])
				for (const prepared of [false, true]) {
					const env = {
						APPLICATION_SELECTED: String(application),
						SOLIDITY_SELECTED: String(solidity),
						PREPARED: String(prepared),
						PREPARE_RESULT: application && !prepared ? 'success' : 'skipped',
						APPLICATION_RESULT: application ? 'success' : 'skipped',
						MUTATION_RESULT: application ? 'success' : 'skipped',
						SOLIDITY_RESULT: solidity ? 'success' : 'skipped',
						TIMING_RESULT: 'success',
					}
					const success = spawnSync('bash', ['-e', '-c', domainCommand], { env }).status
					if (!application && !solidity) {
						expect(success).not.toBe(0)
						continue
					}
					expect(success).toBe(0)
					for (const key of ['SOLIDITY_RESULT', 'TIMING_RESULT', 'PREPARE_RESULT', 'APPLICATION_RESULT', 'MUTATION_RESULT']) {
						for (const result of ['failure', 'cancelled']) expect(spawnSync('bash', ['-e', '-c', domainCommand], { env: { ...env, [key]: result } }).status).not.toBe(0)
					}
					for (const [key, expected] of Object.entries(env).filter(([key]) => key.endsWith('_RESULT'))) expect(spawnSync('bash', ['-e', '-c', domainCommand], { env: { ...env, [key]: expected === 'success' ? 'skipped' : 'success' } }).status).not.toBe(0)
				}
	})

	test('stacked PRs run CI, with one build and one automatic owner for docs and browser smoke', async () => {
		const ci = await readWorkflow(ciWorkflowPath)
		expect(requireRecord(ci['on'], 'CI triggers')).toHaveProperty('pull_request')
		expect(requireRecord(ci['on'], 'CI triggers')['pull_request']).toBeNull()
		const jobs = workflowJobs(ci)
		const application = requireRecord(jobs['application-tests'], 'application call')
		expect(application['needs']).toEqual(['changes', 'prepare'])
		expect(requireRecord(application['with'], 'application options')).toMatchObject({ prepared: true, solidity: false, invocation: 'ci-application' })
		const solidity = requireRecord(jobs['domain-tests'], 'Solidity call')
		expect(solidity['needs']).toEqual(['changes', 'build-inputs'])
		expect(requireRecord(solidity['with'], 'Solidity options')).toMatchObject({ application: false, invocation: 'ci-solidity' })
		expect(workflowSteps(jobs['prepare']).some(step => step['name'] === 'Upload production UI inputs')).toBe(true)
		const buildJobs = Object.entries(jobs)
			.filter(([, job]) => Array.isArray(requireRecord(job, 'CI job')['steps']))
			.filter(([, job]) => workflowSteps(job).some(step => typeof step['run'] === 'string' && /bun run (ui:build|ci:preflight)/.test(step['run'])))
			.map(([name]) => name)
		expect(buildJobs).toEqual(['prepare'])
		const smoke = requireRecord(jobs['browser-smoke'], 'CI smoke consumer')
		expect(smoke['needs']).toEqual(['changes', 'prepare'])
		const smokeSteps = workflowSteps(smoke)
		const download = smokeSteps.find(step => usesAction(step, 'actions/download-artifact'))
		expect(requireRecord(download?.['with'], 'smoke build artifact')).toMatchObject({ name: 'domain-production-ui', path: 'ui' })
		const smokeTest = smokeSteps.find(step => step['run'] === 'bun run test:browser:smoke')
		expect(requireRecord(smokeTest?.['env'], 'smoke environment')).toMatchObject({ ZOLTAR_USE_EXISTING_PRODUCTION_BUILD: '1', ZOLTAR_RUN_PRODUCTION_REBUILD_INVARIANTS: '1' })
		expect(smokeSteps.indexOf(download ?? {})).toBeLessThan(smokeSteps.indexOf(smokeTest ?? {}))
		expect(workflowSteps(jobs['checks']).some(step => step['run'] === 'bun run check:static && bun run check:repository:current')).toBe(true)
		expect(requireRecord(jobs['docs-checks'], 'documentation checks')['if']).toBe("needs.changes.outputs.docs == 'true' || needs.changes.outputs.core == 'true'")
		const browser = await readWorkflow(browserWorkflowPath)
		expect(requireRecord(browser['on'], 'browser triggers')).toHaveProperty('workflow_call')
		expect(requireRecord(browser['on'], 'browser triggers')).not.toHaveProperty('pull_request')
		expect(requireRecord(workflowJobs(browser)['browser-smoke'], 'manual smoke')['if']).toBe("github.event_name == 'workflow_dispatch'")
		const domains = workflowJobs(await readWorkflow(testDomainsWorkflowPath))
		expect(requireRecord(domains['application-tests'], 'application shards')['if']).toBe("always() && !cancelled() && inputs.application && needs.timing-history-input.result == 'success' && (needs.prepare.result == 'success' || (inputs.prepared && needs.prepare.result == 'skipped'))")
	})

	test('setup profiles isolate lightweight jobs and reject unsupported configuration', async () => {
		const action = await readWorkflow(setupActionPath)
		const steps = workflowSteps(requireRecord(action['runs'], 'setup action'))
		const validation = steps.find(step => step['name'] === 'Validate setup profile')?.['run']
		if (typeof validation !== 'string') throw new Error('Missing profile validation')
		for (const profile of ['full', 'contracts', 'root']) expect(spawnSync('bash', ['-e', '-c', validation], { env: { PROFILE: profile, VERIFY_GENERATED: 'false' } }).status).toBe(0)
		for (const profile of ['contracts', 'root', 'unknown']) expect(spawnSync('bash', ['-e', '-c', validation], { env: { PROFILE: profile, VERIFY_GENERATED: 'true' } }).status).not.toBe(0)
		for (const profile of ['full', 'contracts', 'root']) {
			expect(spawnSync('bash', ['-e', '-c', validation], { env: { PROFILE: profile, VERIFY_GENERATED: 'false', BUILD_INPUTS: 'ci-build-inputs' } }).status).toBe(profile === 'root' ? 1 : 0)
			expect(spawnSync('bash', ['-e', '-c', validation], { env: { PROFILE: profile, VERIFY_GENERATED: 'true', BUILD_INPUTS: 'ci-build-inputs' } }).status).not.toBe(0)
		}
		expect(steps.find(step => step['name'] === 'Setup Foundry / Anvil')?.['if']).toBe("inputs.foundry == 'true' && inputs.profile != 'root'")
		expect(steps.find(step => step['name'] === 'Cache generated project outputs')?.['if']).toBe("inputs.profile != 'root' && inputs.build-inputs == ''")
		const cache = requireRecord(steps.find(step => step['name'] === 'Cache generated project outputs')?.['with'], 'cache inputs')
		expect(cache['key']).toContain('${{ inputs.profile }}')
		const install = steps.find(step => step['name'] === 'Install dependencies')?.['run']
		if (typeof install !== 'string') throw new Error('Missing dependency installation')
		const rootInstall = spawnSync('bash', ['-e', '-c', `bun() { printf '%s\\n' "$*"; }\n${install}`], { env: { PROFILE: 'root' }, encoding: 'utf8' })
		expect(rootInstall.status).toBe(0)
		expect(rootInstall.stdout.trim().split('\n')).toEqual(['run projects:setup'])
		const jobs = workflowJobs(await readWorkflow(testDomainsWorkflowPath))
		for (const [job, profile] of [
			['solidity-tests', 'contracts'],
			['mutation-smoke', 'root'],
		]) {
			if (job === undefined) throw new Error('Missing setup job')
			const setup = workflowSteps(jobs[job]).find(step => step['uses'] === './.github/actions/setup-ci')
			expect(requireRecord(setup?.['with'], 'setup options')['profile']).toBe(profile)
		}
	})

	test('CI publishes generated inputs once and releases contract consumers before the UI build', async () => {
		const jobs = workflowJobs(await readWorkflow(ciWorkflowPath))
		const producer = requireRecord(jobs['build-inputs'], 'build input producer')
		expect(producer['needs']).toBe('changes')
		const steps = workflowSteps(producer)
		const upload = requireRecord(steps.find(step => step['name'] === 'Upload full build inputs')?.['with'], 'build inputs upload')
		expect(upload).toMatchObject({ name: 'ci-build-inputs', 'include-hidden-files': true, 'if-no-files-found': 'error' })
		expect(upload['path']).toContain('steps.projects.outputs.generated_cache_paths')
		const contractUpload = requireRecord(steps.find(step => step['name'] === 'Upload contract and shared inputs')?.['with'], 'contract inputs upload')
		expect(contractUpload).toMatchObject({ name: 'ci-contract-inputs', path: '${{ steps.projects.outputs.component_artifact_outputs }}', 'include-hidden-files': true, 'if-no-files-found': 'error' })
		const gate = workflowSteps(jobs['required'])[0]
		expect(requireRecord(gate?.['env'], 'gate environment')['BUILD_INPUTS_SELECTED']).toBe(`\${{ ${String(producer['if'])} }}`)
		for (const name of ['prepare', 'docs-checks', 'checks', 'knip', 'domain-tests', 'infrastructure-checks', 'packages', 'augur-scan-integration']) {
			const consumer = requireRecord(jobs[name], name)
			expect(consumer['needs']).toEqual(['changes', 'build-inputs'])
			const artifactName = ['domain-tests', 'infrastructure-checks', 'packages', 'augur-scan-integration'].includes(name) ? contractUpload['name'] : upload['name']
			if (name === 'domain-tests') expect(requireRecord(consumer['with'], 'domain inputs')['build-inputs']).toBe(artifactName)
			else {
				const consumerSteps = workflowSteps(consumer)
				expect(consumerSteps.some(step => isRecord(step['with']) && (step['with']['build-inputs'] === artifactName || step['with']['name'] === artifactName))).toBe(true)
			}
		}
		for (const name of ['application-tests', 'browser-workflow']) expect(requireRecord(requireRecord(jobs[name], name)['with'], 'reusable inputs')['build-inputs']).toBe(upload['name'])
		const setup = workflowSteps(requireRecord((await readWorkflow(setupActionPath))['runs'], 'setup action'))
		expect(setup.find(step => step['name'] === 'Generate and verify generated artifacts')?.['if']).toContain("inputs.build-inputs == ''")
		const cache = requireRecord(setup.find(step => step['name'] === 'Cache generated project outputs')?.['with'], 'cache inputs')
		expect(cache['key']).toContain("inputs.profile == 'contracts' && steps.projects.outputs.contract_cache_key")
		expect(cache['path']).toContain('steps.projects.outputs.full_only_cache_paths')
		const contractCache = setup.find(step => step['name'] === 'Cache contract build inputs')
		expect(contractCache?.['if']).toBe("inputs.profile == 'full' && inputs.build-inputs == ''")
		expect(requireRecord(contractCache?.['with'], 'contract cache')['restore-keys']).toBe('${{ runner.os }}-generated-contracts-${{ env.BUN_VERSION }}-${{ env.FOUNDRY_VERSION }}-')
		expect(cache).not.toHaveProperty('restore-keys')
		expect(requireRecord(contractCache?.['with'], 'contract cache')['key']).toBe('${{ runner.os }}-generated-contracts-${{ env.BUN_VERSION }}-${{ env.FOUNDRY_VERSION }}-${{ steps.projects.outputs.contract_cache_key }}')
		expect(setup.find(step => step['name'] === 'Generate and verify generated artifacts')?.['if']).toContain("inputs.profile == 'full' && steps.contract-cache.outputs.cache-hit != 'true'")
		const verification = String(setup.find(step => step['name'] === 'Verify transferred build inputs')?.['run'])
		expect(verification).toContain('ensure-contract-artifacts.mts --headless')
		expect(verification).toContain('check-generated-artifacts.mts')
		expect(verification).not.toContain('check:generated-clean')
	})

	test('reusable workflows accept shared inputs while manual runs keep self-contained setup', async () => {
		for (const [definition, consumers] of [
			[testDomainsWorkflowPath, ['prepare', 'application-tests', 'solidity-tests']],
			[browserWorkflowPath, ['browser-workflow']],
		] as const) {
			const workflow = await readWorkflow(definition)
			const trigger = requireRecord(requireRecord(workflow['on'], 'triggers')['workflow_call'], 'reusable trigger')
			const inputs = requireRecord(trigger['inputs'], 'reusable inputs')
			expect(requireRecord(inputs['build-inputs'], 'build artifact input')).toMatchObject({ type: 'string', default: '' })
			for (const consumer of consumers) {
				const steps = workflowSteps(workflowJobs(workflow)[consumer])
				const setup = steps.find(step => step['uses'] === './.github/actions/setup-ci')
				expect(requireRecord(setup?.['with'], 'setup inputs')['build-inputs']).toBe('${{ inputs.build-inputs }}')
				expect(steps.some(step => String(step['run']).includes('setup --path-prefix ui/'))).toBe(false)
			}
		}
		const scripts = requireRecord(requireRecord(JSON.parse(await readFile(rootPackagePath, 'utf8')), 'root package')['scripts'], 'root scripts')
		expect(scripts['check:repository']).toBe('bun run check:source-size && bun run test:preflight && bun run check:repository:current')
		expect(scripts['check:repository:current']).not.toContain('test:preflight')
		expect(scripts['check:repository:current']).not.toContain('check:source-size')
	})

	test('contract caches and transferred inputs include the generated Trading artifact', async () => {
		const query = await projectQuery()
		expect(query.componentArtifactOutputs).toContain('ui/trading/ts/generated/contractArtifact.ts')
		expect(query.generatedCachePaths).toContain('ui/trading/ts/generated/contractArtifact.ts')
		const workflow = await readFile(ciWorkflowPath, 'utf8')
		expect(workflow.match(/steps\.projects\.outputs\.component_artifact_outputs/gu)).toHaveLength(1)
	})

	test('Trading-owned compile and test commands explicitly generate Trading artifacts', async () => {
		const packageJson = JSON.parse(await readFile(rootPackagePath, 'utf8')) as { scripts?: Record<string, string> }
		const tradingPackageJson = JSON.parse(await readFile(tradingPackagePath, 'utf8')) as { scripts?: Record<string, string> }
		expect(packageJson.scripts?.['trading:compile']).toContain('bun ./tooling/ui/vendor.mts trading')
		expect(packageJson.scripts?.['trading:test']).toContain('bun ./tooling/ui/vendor.mts trading')
		expect(packageJson.scripts?.['tsc:app']).toStartWith('bun ./tooling/ui/vendor.mts trading')
		expect(packageJson.scripts?.['coverage:ui']).toContain('bun ./tooling/ui/vendor.mts trading')
		expect(packageJson.scripts?.['coverage:typescript']).toContain('bun ./tooling/ui/vendor.mts trading')
		expect(tradingPackageJson.scripts?.['test']).toStartWith('bun run generate')
		expect(tradingPackageJson.scripts?.['watch']).toStartWith('bun run generate')
	})

	test('shared-library public exports attribute Bun tests to TypeScript sources', async () => {
		for (const packagePath of sharedLibraryPackagePaths) {
			const packageDirectory = join(repositoryRoot, packagePath, '..')
			const manifest: unknown = JSON.parse(await readFile(join(repositoryRoot, packagePath), 'utf8'))
			const exports = requireRecord(requireRecord(manifest, packagePath)['exports'], `${packagePath} exports`)
			for (const [exportName, exportValue] of Object.entries(exports)) {
				const conditions = requireRecord(exportValue, `${packagePath} export ${exportName}`)
				expect(Object.keys(conditions).indexOf('bun')).toBeLessThan(Object.keys(conditions).indexOf('default'))
				const bunTarget = conditions['bun']
				const defaultTarget = conditions['default']
				expect(typeof bunTarget).toBe('string')
				expect(typeof defaultTarget).toBe('string')
				if (typeof bunTarget !== 'string' || typeof defaultTarget !== 'string') continue
				expect(bunTarget).toStartWith('./ts/')
				expect(defaultTarget).toStartWith('./js/')
				await access(join(packageDirectory, bunTarget))
			}
		}
	})

	test('clean CI emits the complete UI dependency DAG while testnet deployment stays headless', async () => {
		const ciWorkflow = await readFile(ciWorkflowPath, 'utf8')
		const buildIndex = ciWorkflow.indexOf('bun run ui:build:apps')
		const preflightIndex = ciWorkflow.indexOf('bun run ui:build:prod:current')
		expect(buildIndex).toBeGreaterThan(0)
		expect(preflightIndex).toBeGreaterThan(buildIndex)

		const deployWorkflow = await readFile(deployTestnetWorkflowPath, 'utf8')
		for (const packageId of uiPackageIds) {
			expect(deployWorkflow).not.toContain(`(cd ui/${packageId} && bun install --frozen-lockfile)`)
		}
		expect(deployWorkflow).toContain('run: bun run projects:setup')
		expect(deployWorkflow).not.toContain('bun install')
		expect(deployWorkflow).not.toContain('bun run ui:build:apps')
		expect(deployWorkflow).toContain('bun ./tooling/contracts/ensure-contract-artifacts.mts --headless')
		expect(deployWorkflow).toContain('bun ./tooling/contracts/run-deploy-testnet.mts --help')
		expect(deployWorkflow).not.toContain('bun ./tooling/contracts/deploy-testnet.mts --help')
	})

	test('CI builds deployment runtime dependencies before bundling without reinstalling the workspace', async () => {
		const workflow = await readWorkflow(ciWorkflowPath)
		const prepareSteps = workflowSteps(workflowJobs(workflow)['prepare'])
		const command = String(prepareSteps.find(step => step['name'] === 'Build production UI')?.['run'])
		const lines = command.split('\n').map(line => line.trim())
		const buildIndex = lines.indexOf('bun run ui:build:apps')
		const refreshIndex = lines.indexOf('bun ./tooling/repo/run-project-tasks.mts setup --project-path ui/statoblast')
		const preflightIndex = lines.indexOf('bun run ui:build:prod:current')
		expect(buildIndex).toBeGreaterThanOrEqual(0)
		expect(refreshIndex).toBe(-1)
		expect(preflightIndex).toBeGreaterThan(buildIndex)
	})

	test('CI and Docker install every UI package from the workspace lockfile', async () => {
		const setupWorkflow = await readWorkflow(setupActionPath)
		const setupSteps = workflowSteps(requireRecord(setupWorkflow['runs'], 'setup action'))
		expect(setupSteps.some(step => typeof step['run'] === 'string' && step['run'].includes('bun run projects:setup'))).toBe(true)
		expect((await projectQuery()).setupProjectPaths.filter(projectPath => projectPath.startsWith('ui/'))).toEqual(uiPackageIds.map(packageId => `ui/${packageId}`))

		const dockerfile = await readFile(dockerfilePath, 'utf8')
		const dockerStages = parseDockerfile(dockerfile)
		expect(dockerGlobalArguments(dockerfile)).toContain('BUN_VERSION=1.4.2')
		const copies = dockerStages.flatMap(stage => dockerInstructions(stage, 'COPY'))
		const runs = dockerStages.flatMap(stage => dockerInstructions(stage, 'RUN'))
		expect(copies.some(copy => copy.includes('bun.lock'))).toBe(true)
		for (const appId of uiPackageIds) {
			expect(copies.some(copy => copy.includes(`ui/${appId}/package.json`))).toBe(true)
		}
		expect(runs.filter(run => run.includes('bun install') || run.includes('install-frozen.mts'))).toEqual(['bun install --frozen-lockfile'])
	})

	test('dead-code CI installs every bot workspace before analyzing it', async () => {
		const workflow = await readWorkflow(ciWorkflowPath)
		const job = requireRecord(workflowJobs(workflow)['knip'], 'Knip job')
		expect(job['if']).toBe("needs.changes.outputs.core == 'true'")
		expect(job['continue-on-error']).toBeUndefined()
		const steps = workflowSteps(workflowJobs(workflow)['knip'])
		expect(steps.find(step => step['run'] === 'bun run knip')?.['continue-on-error']).toBeUndefined()
		expect(steps.findIndex(step => step['uses'] === './.github/actions/setup-ci')).toBeLessThan(steps.findIndex(step => step['run'] === 'bun run knip'))
		expect(
			taskProjects('setup')
				.filter(project => project.path.startsWith('shared/') || project.path.startsWith('bots/'))
				.map(project => project.path),
		).toEqual(['shared/core', 'shared/zoltar', 'shared/openOracle', 'shared/statoblast', 'shared/trading', 'bots/shared', 'bots/chaos', 'bots/open-oracle-arbitrager', 'bots/liquidator'])
	})

	test('every TEVM workspace pins the compatible release-candidate dependency cohort', async () => {
		for (const packagePath of tevmPackagePaths) {
			const parsed: unknown = JSON.parse(await readFile(join(repositoryRoot, packagePath), 'utf8'))
			expect(isRecord(parsed)).toBe(true)
			if (!isRecord(parsed)) throw new Error(`${packagePath} must contain a JSON object`)
			const dependencies = parsed['dependencies']
			if (!isRecord(dependencies)) throw new Error(`${packagePath} must define dependencies`)
			expect(dependencies['tevm']).toBeUndefined()
			for (const name of ['@tevm/memory-client', '@tevm/common']) expect(dependencies[name]).toBe('1.0.0-rc.151')
			if (packagePath === 'package.json') {
				const overrides = parsed['overrides']
				if (!isRecord(overrides)) throw new Error('Root package must define dependency overrides')
				for (const dependencyName of pinnedTevmTransitives) expect(overrides[dependencyName]).toBe('1.0.0-rc.151')
			} else {
				expect(parsed['overrides']).toBeUndefined()
			}

			const lockPath = join(repositoryRoot, 'bun.lock')
			const lock = await readFile(lockPath, 'utf8')
			expect(lock).not.toContain('"tevm": [')
			expect(lock).not.toContain('"@tevm/server": [')
			expect(lock).toContain('"@tevm/actions": ["@tevm/actions@1.0.0-rc.151"')
			expect(lock).not.toContain('"@tevm/actions": ["@tevm/actions@1.0.0-rc.153"')
		}
	})

	test('activatable workflows replace every stale monolithic UI setup command', async () => {
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
