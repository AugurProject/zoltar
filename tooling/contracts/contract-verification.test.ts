import { expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { buildVerificationPlan, getExplorerTargets, parseDeploymentManifest, verifyContractsWithExplorer, type DeploymentManifest, type ExplorerFetch, type ExplorerTarget, type StandardJsonInputs, type VerificationJob } from './contract-verification.mts'
import { createArtifactLookup, parseRequestedChainIds } from './verify-contracts.mts'

const repositoryRoot = path.join(import.meta.dir, '..', '..')

async function loadRealManifest(networkId: 'mainnet' | 'sepolia'): Promise<DeploymentManifest> {
	const rawManifest: unknown = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'docs', `${networkId}-deployment-addresses.json`), 'utf8'))
	return parseDeploymentManifest(rawManifest, networkId)
}

async function loadRealArtifactLookup() {
	return createArtifactLookup(JSON.parse(await fs.readFile(path.join(repositoryRoot, 'solidity', 'artifacts', 'Contracts.json'), 'utf8')))
}

test('every manifest deployment step is either verifiable or explicitly skipped, and every init code reproduces its manifest address', async () => {
	const artifactLookup = await loadRealArtifactLookup()
	for (const networkId of ['mainnet', 'sepolia'] as const) {
		const manifest = await loadRealManifest(networkId)
		const plan = buildVerificationPlan(manifest, artifactLookup)
		expect(plan.skipped.map(step => step.id)).toEqual(['proxyDeployer'])
		expect(plan.jobs.map(job => job.id)).toEqual(manifest.deploymentSteps.map(step => step.id).filter(id => id !== 'proxyDeployer'))
	}
})

test('verification jobs carry the deployed constructor arguments and compiler profiles', async () => {
	const artifactLookup = await loadRealArtifactLookup()
	const manifest = await loadRealManifest('sepolia')
	const plan = buildVerificationPlan(manifest, artifactLookup)
	const jobById = new Map(plan.jobs.map(job => [job.id, job]))
	const zoltar = jobById.get('zoltar')
	expect(zoltar?.constructorArguments).toContain(manifest.network.genesisRepTokenAddress.slice(2).toLowerCase())
	const shareTokenFactory = jobById.get('shareTokenFactory')
	const zoltarStep = manifest.deploymentSteps.find(step => step.id === 'zoltar')
	expect(shareTokenFactory?.constructorArguments).toBe(`000000000000000000000000${zoltarStep?.address.slice(2).toLowerCase() ?? ''}`)
	const openOracle = jobById.get('openOracle')
	expect(openOracle?.compilerProfile).toBe('openOracle')
	expect(openOracle?.contractIdentifier).toBe('src/OpenOracleSlim.sol:OpenOracle')
	const weth = jobById.get('weth')
	expect(weth?.constructorArguments).toBe('')
})

test('a manifest address that does not match the computed init code fails the plan', async () => {
	const artifactLookup = await loadRealArtifactLookup()
	const manifest = await loadRealManifest('sepolia')
	const tamperedManifest = {
		...manifest,
		deploymentSteps: manifest.deploymentSteps.map(step => (step.id === 'zoltar' ? { ...step, address: manifest.network.wethAddress } : step)),
	}
	expect(() => buildVerificationPlan(tamperedManifest, artifactLookup)).toThrow('instead of the manifest address')
})

test('an unknown deployment step demands a verification definition', async () => {
	const artifactLookup = await loadRealArtifactLookup()
	const manifest = await loadRealManifest('sepolia')
	const renamedManifest = {
		...manifest,
		deploymentSteps: manifest.deploymentSteps.map(step => (step.id === 'multicall3' ? { ...step, id: 'newProtocolModule' } : step)),
	}
	expect(() => buildVerificationPlan(renamedManifest, artifactLookup)).toThrow('has no contract-verification definition')
})

test('the compile module tolerates verification CLI arguments when imported instead of executed', async () => {
	const testRoot = await mkdtemp(path.join(tmpdir(), 'zoltar-compile-import-test-'))
	const importerPath = path.join(testRoot, 'import-compile.mts')
	await fs.writeFile(importerPath, `await import(${JSON.stringify(path.join(repositoryRoot, 'solidity', 'ts', 'compile.ts'))})\nconsole.log('compile-module-imported')\n`)
	try {
		const child = Bun.spawn([process.execPath, importerPath, '--chain-id=11155111'], { stderr: 'pipe', stdout: 'pipe' })
		const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
		expect(stderr).not.toContain('Unknown contract project')
		expect(stdout).toContain('compile-module-imported')
		expect(exitCode).toBe(0)
	} finally {
		await rm(testRoot, { force: true, recursive: true })
	}
})

test('requested chain ids default to mainnet and sepolia', () => {
	expect(parseRequestedChainIds([])).toEqual([1, 11155111])
	expect(parseRequestedChainIds(['--chain-id=11155111'])).toEqual([11155111])
	expect(() => parseRequestedChainIds(['--chain-id=0x1'])).toThrow('canonical positive decimal integer')
})

test('explorer targets cover Etherscan and Blockscout for known chains only', () => {
	const mainnetTargets = getExplorerTargets(1, { ETHERSCAN_API_KEY: 'key' })
	expect(mainnetTargets.map(target => target.name)).toEqual(['Etherscan', 'Blockscout'])
	expect(mainnetTargets[0]?.baseParameters['chainid']).toBe('1')
	expect(mainnetTargets[0]?.apiKey).toBe('key')
	expect(mainnetTargets[1]?.apiUrl).toBe('https://eth.blockscout.com/api')
	const sepoliaTargets = getExplorerTargets(11_155_111, {})
	expect(sepoliaTargets[0]?.apiKey).toBeUndefined()
	// GitHub Actions supplies an empty string when the secret is not configured.
	expect(getExplorerTargets(11_155_111, { ETHERSCAN_API_KEY: '' })[0]?.apiKey).toBeUndefined()
	expect(sepoliaTargets[1]?.apiUrl).toBe('https://eth-sepolia.blockscout.com/api')
	expect(getExplorerTargets(17_000, {})).toEqual([])
})

const testTarget: ExplorerTarget = {
	apiKey: 'test-key',
	apiUrl: 'https://api.example.invalid/api',
	baseParameters: { chainid: '11155111' },
	name: 'TestScan',
	requiresApiKey: true,
}

const testJob: VerificationJob = {
	address: '0xfAa07F49C2d97DCD49b7a2c1Ce34E0735896b626',
	compilerProfile: 'main',
	constructorArguments: 'abcd',
	contractIdentifier: 'contracts/Zoltar.sol:Zoltar',
	id: 'zoltar',
	label: 'Zoltar',
}

const testInputs: StandardJsonInputs = {
	main: { compilerVersion: 'v0.8.35+commit.47b9dedd', inputJson: '{"language":"Solidity"}' },
	openOracle: { compilerVersion: 'v0.8.28+commit.7893614a', inputJson: '{"language":"Solidity"}' },
}

type RecordedCall = { parameters: URLSearchParams; type: 'GET' | 'POST' }

function createExplorerFetchStub(respond: (action: string, call: RecordedCall) => { result: unknown; status: string }): { calls: RecordedCall[]; fetchFn: ExplorerFetch } {
	const calls: RecordedCall[] = []
	const fetchFn: ExplorerFetch = async (requestUrl, init) => {
		const parameters = init?.body === undefined ? new URLSearchParams(requestUrl.split('?')[1] ?? '') : new URLSearchParams(init.body)
		const call: RecordedCall = { parameters, type: init?.method === 'POST' ? 'POST' : 'GET' }
		calls.push(call)
		const action = parameters.get('action') ?? ''
		const body = respond(action, call)
		return { json: async () => body, ok: true, status: 200 }
	}
	return { calls, fetchFn }
}

const immediateSleep = async () => {}

test('verification submits standard JSON and polls until the explorer reports a pass', async () => {
	let pollCount = 0
	const { calls, fetchFn } = createExplorerFetchStub(action => {
		if (action === 'getsourcecode') return { result: [{ SourceCode: '' }], status: '1' }
		if (action === 'verifysourcecode') return { result: 'test-guid', status: '1' }
		pollCount += 1
		return pollCount === 1 ? { result: 'Pending in queue', status: '0' } : { result: 'Pass - Verified', status: '1' }
	})
	const outcomes = await verifyContractsWithExplorer({ fetchFn, inputs: testInputs, jobs: [testJob], log: () => {}, sleep: immediateSleep, target: testTarget })
	expect(outcomes).toEqual([{ detail: 'Pass - Verified', id: 'zoltar', status: 'verified' }])
	const submission = calls.find(call => call.parameters.get('action') === 'verifysourcecode')
	expect(submission?.type).toBe('POST')
	expect(submission?.parameters.get('chainid')).toBe('11155111')
	expect(submission?.parameters.get('apikey')).toBe('test-key')
	expect(submission?.parameters.get('codeformat')).toBe('solidity-standard-json-input')
	expect(submission?.parameters.get('contractaddress')).toBe(testJob.address)
	expect(submission?.parameters.get('contractname')).toBe('contracts/Zoltar.sol:Zoltar')
	expect(submission?.parameters.get('compilerversion')).toBe('v0.8.35+commit.47b9dedd')
	expect(submission?.parameters.get('constructorArguements')).toBe('abcd')
	expect(submission?.parameters.get('sourceCode')).toBe(testInputs.main.inputJson)
	const statusPoll = calls.find(call => call.parameters.get('action') === 'checkverifystatus')
	expect(statusPoll?.parameters.get('guid')).toBe('test-guid')
})

test('already verified contracts are detected before submission', async () => {
	const { calls, fetchFn } = createExplorerFetchStub(() => ({ result: [{ SourceCode: '{"language":"Solidity"}' }], status: '1' }))
	const outcomes = await verifyContractsWithExplorer({ fetchFn, inputs: testInputs, jobs: [testJob], log: () => {}, sleep: immediateSleep, target: testTarget })
	expect(outcomes).toEqual([{ id: 'zoltar', status: 'already-verified' }])
	expect(calls.every(call => call.parameters.get('action') === 'getsourcecode')).toBe(true)
})

test('an undeployed contract is reported without failing verification', async () => {
	const { fetchFn } = createExplorerFetchStub(action => {
		if (action === 'getsourcecode') return { result: [{ SourceCode: '' }], status: '1' }
		return { result: `Unable to locate ContractCode at ${testJob.address}`, status: '0' }
	})
	const outcomes = await verifyContractsWithExplorer({ fetchFn, inputs: testInputs, jobs: [testJob], log: () => {}, sleep: immediateSleep, target: testTarget })
	expect(outcomes[0]?.status).toBe('not-deployed')
})

test('a submission the explorer already accepted counts as verified', async () => {
	const { fetchFn } = createExplorerFetchStub(action => {
		if (action === 'getsourcecode') return { result: [{ SourceCode: '' }], status: '1' }
		return { result: 'Contract source code already verified', status: '0' }
	})
	const outcomes = await verifyContractsWithExplorer({ fetchFn, inputs: testInputs, jobs: [testJob], log: () => {}, sleep: immediateSleep, target: testTarget })
	expect(outcomes[0]?.status).toBe('already-verified')
})

test('an explorer verification failure is reported per contract', async () => {
	const { fetchFn } = createExplorerFetchStub(action => {
		if (action === 'getsourcecode') return { result: [{ SourceCode: '' }], status: '1' }
		if (action === 'verifysourcecode') return { result: 'test-guid', status: '1' }
		return { result: 'Fail - Unable to verify', status: '0' }
	})
	const outcomes = await verifyContractsWithExplorer({ fetchFn, inputs: testInputs, jobs: [testJob], log: () => {}, sleep: immediateSleep, target: testTarget })
	expect(outcomes).toEqual([{ detail: 'Fail - Unable to verify', id: 'zoltar', status: 'failed' }])
})

test('explorer transport errors mark the contract as failed instead of aborting the run', async () => {
	const failingFetch: ExplorerFetch = async () => ({ json: async () => ({}), ok: false, status: 502 })
	const outcomes = await verifyContractsWithExplorer({ fetchFn: failingFetch, inputs: testInputs, jobs: [testJob], log: () => {}, sleep: immediateSleep, target: testTarget })
	expect(outcomes[0]?.status).toBe('failed')
	expect(outcomes[0]?.detail).toContain('HTTP 502')
})
