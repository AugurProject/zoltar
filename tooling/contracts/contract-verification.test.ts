import { expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { repositoryRoot } from '../repo/root.mts'
import { buildVerificationPlan, getExplorerTargets, getSourcifyTarget, parseDeploymentManifest, verifyContractsWithExplorer, verifyContractsWithSourcify, type DeploymentManifest, type ExplorerFetch, type ExplorerTarget, type StandardJsonInputs, type VerificationJob } from './contract-verification.mts'
import { createArtifactLookup, parseRequestedChainIds } from './verify-contracts.mts'

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

test('verification does not require a deployment for the internal scalar library', async () => {
	const artifactLookup = await loadRealArtifactLookup()
	for (const networkId of ['mainnet', 'sepolia'] as const) {
		const manifest = await loadRealManifest(networkId)
		const plan = buildVerificationPlan({ ...manifest, deploymentSteps: manifest.deploymentSteps.filter(step => step.id !== 'scalarOutcomes') }, artifactLookup)
		expect(plan.jobs.some(job => job.id === 'scalarOutcomes')).toBe(false)
		expect(Object.keys(plan.libraryAddresses)).toEqual(['securityPoolUtils'])
		expect(plan.jobs.some(job => job.id === 'zoltarQuestionData')).toBe(true)
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

test('tampered manifest constructor arguments fail the CREATE2 validation', async () => {
	const artifactLookup = await loadRealArtifactLookup()
	const manifest = await loadRealManifest('sepolia')
	const tamperedManifest = {
		...manifest,
		deploymentSteps: manifest.deploymentSteps.map(step => (step.id === 'shareTokenFactory' ? { ...step, constructorArguments: `${'00'.repeat(12)}${manifest.network.wethAddress.slice(2).toLowerCase()}` } : step)),
	}
	expect(() => buildVerificationPlan(tamperedManifest, artifactLookup)).toThrow('instead of the manifest address')
})

test('a verifiable step without recorded constructor arguments demands manifest regeneration', async () => {
	const artifactLookup = await loadRealArtifactLookup()
	const manifest = await loadRealManifest('sepolia')
	const strippedManifest = {
		...manifest,
		deploymentSteps: manifest.deploymentSteps.map(step => (step.id === 'zoltar' ? { address: step.address, id: step.id, label: step.label } : step)),
	}
	expect(() => buildVerificationPlan(strippedManifest, artifactLookup)).toThrow('has no constructorArguments')
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

for (const limitedAction of ['getsourcecode', 'verifysourcecode', 'checkverifystatus']) {
	test(`explorer retries HTTP 429 during ${limitedAction} without losing the submission`, async () => {
		const attempts = new Map<string, number>()
		const delays: number[] = []
		const { calls, fetchFn: successfulFetch } = createExplorerFetchStub(action => {
			if (action === 'getsourcecode') return { result: [{ SourceCode: '' }], status: '1' }
			if (action === 'verifysourcecode') return { result: 'preserved-guid', status: '1' }
			return { result: 'Pass - Verified', status: '1' }
		})
		const fetchFn: ExplorerFetch = async (requestUrl, init) => {
			const action = new URLSearchParams(init?.body ?? requestUrl.split('?')[1]).get('action') ?? ''
			const attempt = (attempts.get(action) ?? 0) + 1
			attempts.set(action, attempt)
			if (action === limitedAction && attempt === 1)
				return {
					ok: false,
					status: 429,
					json: async () => {
						throw new Error('429 body need not be JSON')
					},
				}
			return successfulFetch(requestUrl, init)
		}
		const outcomes = await verifyContractsWithExplorer({
			fetchFn,
			inputs: testInputs,
			jobs: [testJob],
			log: () => {},
			sleep: async delay => {
				delays.push(delay)
			},
			target: testTarget,
		})
		expect(outcomes[0]?.status).toBe('verified')
		expect(attempts.get(limitedAction)).toBe(2)
		expect(delays.includes(1_652)).toBe(true)
		expect(calls.filter(call => call.type === 'POST')).toHaveLength(1)
		expect(calls.at(-1)?.parameters.get('guid')).toBe('preserved-guid')
	})
}

test('explorer paces every request including already-verified lookups and status checks', async () => {
	let elapsed = 0
	const requestTimes: number[] = []
	const { fetchFn: successfulFetch } = createExplorerFetchStub((action, call) => {
		if (action === 'getsourcecode') return { result: [{ SourceCode: call.parameters.get('address') === testJob.address ? 'verified source' : '' }], status: '1' }
		return { result: action === 'verifysourcecode' ? 'test-guid' : 'Pass - Verified', status: '1' }
	})
	const fetchFn: ExplorerFetch = async (requestUrl, init) => {
		requestTimes.push(elapsed)
		return successfulFetch(requestUrl, init)
	}
	const outcomes = await verifyContractsWithExplorer({
		fetchFn,
		inputs: testInputs,
		jobs: [testJob, { ...testJob, id: 'second', address: '0x0000000000000000000000000000000000000001' }],
		log: () => {},
		sleep: async delay => {
			elapsed += delay
		},
		target: testTarget,
	})
	expect(outcomes.map(outcome => outcome.status)).toEqual(['already-verified', 'verified'])
	expect(requestTimes).toHaveLength(4)
	for (let index = 1; index < requestTimes.length; index += 1) expect((requestTimes[index] ?? 0) - (requestTimes[index - 1] ?? 0)).toBeGreaterThanOrEqual(1_000)
})

test('explorer retries each request ten times over five minutes and later contracts still run', async () => {
	let attempts = 0
	const delays: number[] = []
	const fetchFn: ExplorerFetch = async () => {
		attempts += 1
		return { ok: false, status: 429, json: async () => ({}) }
	}
	const outcomes = await verifyContractsWithExplorer({
		fetchFn,
		inputs: testInputs,
		jobs: [testJob, { ...testJob, id: 'second' }],
		log: () => {},
		sleep: async delay => {
			delays.push(delay)
		},
		target: testTarget,
	})
	expect(attempts).toBe(22)
	expect(outcomes.map(outcome => outcome.status)).toEqual(['failed', 'failed'])
	expect(outcomes.every(outcome => outcome.detail?.includes('HTTP 429') === true)).toBe(true)
	expect(delays).toHaveLength(21)
	for (const waits of [delays.slice(0, 10), delays.slice(11)]) {
		expect(waits.reduce((sum, delay) => sum + delay, 0)).toBe(300_000)
		for (let index = 1; index < waits.length; index += 1) expect((waits[index] ?? 0) / (waits[index - 1] ?? 1)).toBeCloseTo(1.6, 2)
	}
})

test('explorer can recover on the tenth retry', async () => {
	let attempts = 0
	let waited = 0
	const outcomes = await verifyContractsWithExplorer({
		fetchFn: async () => {
			attempts += 1
			return attempts <= 10 ? { ok: false, status: 429, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ result: [{ SourceCode: 'verified source' }], status: '1' }) }
		},
		inputs: testInputs,
		jobs: [testJob],
		log: () => {},
		sleep: async delay => {
			waited += delay
		},
		target: testTarget,
	})
	expect(outcomes[0]?.status).toBe('already-verified')
	expect(attempts).toBe(11)
	expect(waited).toBe(300_000)
})

for (const cooldownSeconds of [100, 120, 300]) {
	test(`explorer waits beyond the fallback budget with ${cooldownSeconds}s server cooldowns`, async () => {
		let attempts = 0
		const delays: number[] = []
		const outcomes = await verifyContractsWithExplorer({
			fetchFn: async () => {
				attempts += 1
				return { ok: false, status: 429, headers: new Headers({ 'Retry-After': cooldownSeconds.toString() }), json: async () => ({}) }
			},
			inputs: testInputs,
			jobs: [testJob],
			log: () => {},
			sleep: async delay => {
				delays.push(delay)
			},
			target: testTarget,
		})
		const expectedRetries = 10
		expect(attempts).toBe(expectedRetries + 1)
		expect(delays).toEqual(Array.from({ length: expectedRetries }, () => cooldownSeconds * 1_000))
		expect(outcomes[0]?.status).toBe('failed')
		expect(outcomes[0]?.detail).toContain('300s retry wait budget')
	})
}

for (const [label, header, minimumDelay, maximumDelay] of [
	['short seconds', '1', 1_000, 1_000],
	['zero seconds', '0', 0, 0],
	['seconds', '10', 10_000, 10_000],
	['five-minute boundary', '300', 300_000, 300_000],
	['HTTP date', 'future-date', 28_000, 30_000],
	['invalid header', 'invalid', 1_652, 1_652],
	['past date', 'Wed, 01 Jan 2020 00:00:00 GMT', 1_652, 1_652],
] as const) {
	test(`explorer handles Retry-After ${label}`, async () => {
		let attempts = 0
		let cancelled = false
		const delays: number[] = []
		const fetchFn: ExplorerFetch = async () => {
			attempts += 1
			if (attempts === 1)
				return {
					ok: false,
					status: 429,
					headers: new Headers({ 'Retry-After': header === 'future-date' ? new Date(Date.now() + 30_000).toUTCString() : header }),
					body: {
						cancel: async () => {
							cancelled = true
						},
					},
					json: async () => ({}),
				}
			return { ok: true, status: 200, json: async () => ({ result: [{ SourceCode: 'verified source' }], status: '1' }) }
		}
		const outcomes = await verifyContractsWithExplorer({
			fetchFn,
			inputs: testInputs,
			jobs: [testJob],
			log: () => {},
			sleep: async delay => {
				delays.push(delay)
			},
			target: testTarget,
		})
		expect(outcomes[0]?.status).toBe('already-verified')
		expect(attempts).toBe(2)
		expect(cancelled).toBe(true)
		expect(delays).toHaveLength(1)
		expect(delays[0]).toBeGreaterThanOrEqual(minimumDelay)
		expect(delays[0]).toBeLessThanOrEqual(maximumDelay)
	})
}

test('explorer uses each Retry-After value instead of the growing fallback backoff', async () => {
	const headers = ['10', '1', undefined, '2']
	let attempts = 0
	const delays: number[] = []
	const outcomes = await verifyContractsWithExplorer({
		fetchFn: async () => {
			const header = headers[attempts]
			attempts += 1
			return attempts <= headers.length ? { ok: false, status: 429, headers: new Headers(header === undefined ? {} : { 'Retry-After': header }), json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ result: [{ SourceCode: 'verified source' }], status: '1' }) }
		},
		inputs: testInputs,
		jobs: [testJob],
		log: () => {},
		sleep: async delay => {
			delays.push(delay)
		},
		target: testTarget,
	})
	expect(outcomes[0]?.status).toBe('already-verified')
	expect(attempts).toBe(5)
	expect(delays).toEqual([10_000, 1_000, 4_229, 2_000])
})

for (const [label, reset, retryAfter, explorer, expectedDelay] of [
	['milliseconds', '10000', undefined, 'Blockscout', 10_000],
	['short delay', '500', undefined, 'Blockscout', 500],
	['zero', '0', undefined, 'Blockscout', 0],
	['boundary', '300000', undefined, 'Blockscout', 300_000],
	['invalid', 'invalid', undefined, 'Blockscout', 1_652],
	['disabled', '-1', undefined, 'Blockscout', 1_652],
	['empty', '', undefined, 'Blockscout', 1_652],
	['fractional', '1.5', undefined, 'Blockscout', 1_652],
	['Retry-After precedence', '10000', '2', 'Blockscout', 2_000],
	['invalid Retry-After fallback', '10000', 'invalid', 'Blockscout', 10_000],
	['other explorer', '10000', undefined, 'Etherscan', 1_652],
] as const) {
	test(`Blockscout reset header handles ${label}`, async () => {
		let attempts = 0
		const delays: number[] = []
		const headers = new Headers({ 'x-ratelimit-reset': reset })
		if (retryAfter !== undefined) headers.set('Retry-After', retryAfter)
		const outcomes = await verifyContractsWithExplorer({
			fetchFn: async () => {
				attempts += 1
				return attempts === 1 ? { ok: false, status: 429, headers, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ result: [{ SourceCode: 'verified source' }], status: '1' }) }
			},
			inputs: testInputs,
			jobs: [testJob],
			log: () => {},
			sleep: async delay => {
				delays.push(delay)
			},
			target: { ...testTarget, name: explorer },
		})
		expect(outcomes[0]?.status).toBe('already-verified')
		expect(attempts).toBe(2)
		expect(delays).toEqual([expectedDelay])
	})
}

for (const [header, value, expectedDelays] of [
	['x-ratelimit-reset', '1341588', [1_341_588]],
	['Retry-After', '1342', [1_342_000]],
	['x-ratelimit-reset', '2147483648', [2_147_483_647, 1]],
] as const) {
	test(`explorer waits the full ${header} cooldown of ${value} beyond the fallback budget`, async () => {
		let attempts = 0
		const delays: number[] = []
		const outcomes = await verifyContractsWithExplorer({
			fetchFn: async () => {
				attempts += 1
				return attempts === 1 ? { ok: false, status: 429, headers: new Headers({ [header]: value }), json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ result: [{ SourceCode: 'verified source' }], status: '1' }) }
			},
			inputs: testInputs,
			jobs: [testJob],
			log: () => {},
			sleep: async delay => {
				delays.push(delay)
			},
			target: { ...testTarget, name: 'Blockscout' },
		})
		expect(attempts).toBe(2)
		expect(delays).toEqual([...expectedDelays])
		expect(outcomes[0]?.status).toBe('already-verified')
	})
}

test('explorer preserves the final retry cooldown before contacting the provider for the next contract', async () => {
	let attempts = 0
	let elapsed = 0
	const requestTimes: number[] = []
	const fetchFn: ExplorerFetch = async () => {
		attempts += 1
		requestTimes.push(elapsed)
		if (attempts <= 11) return { ok: false, status: 429, headers: new Headers({ 'Retry-After': attempts === 11 ? '250' : '1' }), json: async () => ({}) }
		return { ok: true, status: 200, json: async () => ({ result: [{ SourceCode: 'verified source' }], status: '1' }) }
	}
	const outcomes = await verifyContractsWithExplorer({
		fetchFn,
		inputs: testInputs,
		jobs: [testJob, { ...testJob, id: 'second' }],
		log: () => {},
		sleep: async delay => {
			elapsed += delay
		},
		target: testTarget,
	})
	expect(outcomes.map(outcome => outcome.status)).toEqual(['failed', 'already-verified'])
	expect(attempts).toBe(12)
	expect((requestTimes[11] ?? 0) - (requestTimes[10] ?? 0)).toBeGreaterThanOrEqual(250_000)
})

test('sourcify targets exist for mainnet and sepolia only', () => {
	expect(getSourcifyTarget(1)?.apiUrl).toBe('https://sourcify.dev/server')
	expect(getSourcifyTarget(11_155_111)?.chainId).toBe(11_155_111)
	expect(getSourcifyTarget(17_000)).toBeUndefined()
})

type SourcifyRoute = (url: string, body: string | undefined) => { payload: unknown; status: number }

function createSourcifyFetchStub(route: SourcifyRoute): { calls: { body: string | undefined; url: string }[]; fetchFn: ExplorerFetch } {
	const calls: { body: string | undefined; url: string }[] = []
	const fetchFn: ExplorerFetch = async (requestUrl, init) => {
		calls.push({ body: init?.body, url: requestUrl })
		const { payload, status } = route(requestUrl, init?.body)
		return { json: async () => payload, ok: status >= 200 && status < 300, status }
	}
	return { calls, fetchFn }
}

const sourcifySepolia = { apiUrl: 'https://sourcify.example.invalid/server', chainId: 11_155_111, name: 'Sourcify' }

test('sourcify verification submits the standard JSON object and polls the job until it matches', async () => {
	let pollCount = 0
	const { calls, fetchFn } = createSourcifyFetchStub(url => {
		if (url.includes('/v2/contract/')) return { payload: { customCode: 'not_verified', errorId: '1', message: 'Contract is not verified' }, status: 404 }
		if (url.endsWith(`/v2/verify/11155111/${testJob.address}`)) return { payload: { verificationId: 'sourcify-job-1' }, status: 202 }
		pollCount += 1
		return pollCount === 1 ? { payload: { isJobCompleted: false, verificationId: 'sourcify-job-1' }, status: 200 } : { payload: { contract: { match: 'exact_match' }, isJobCompleted: true }, status: 200 }
	})
	const outcomes = await verifyContractsWithSourcify({ fetchFn, inputs: testInputs, jobs: [testJob], log: () => {}, sleep: immediateSleep, target: sourcifySepolia })
	expect(outcomes).toEqual([{ detail: 'exact_match', id: 'zoltar', status: 'verified' }])
	const submission = calls.find(call => call.body !== undefined)
	expect(submission?.url).toBe(`https://sourcify.example.invalid/server/v2/verify/11155111/${testJob.address}`)
	expect(JSON.parse(submission?.body ?? '{}')).toEqual({ compilerVersion: '0.8.35+commit.47b9dedd', contractIdentifier: 'contracts/Zoltar.sol:Zoltar', stdJsonInput: { language: 'Solidity' } })
})

test('sourcify verification skips contracts it already lists as matched', async () => {
	const { calls, fetchFn } = createSourcifyFetchStub(() => ({ payload: { address: testJob.address, match: 'match' }, status: 200 }))
	const outcomes = await verifyContractsWithSourcify({ fetchFn, inputs: testInputs, jobs: [testJob], log: () => {}, sleep: immediateSleep, target: sourcifySepolia })
	expect(outcomes).toEqual([{ id: 'zoltar', status: 'already-verified' }])
	expect(calls).toHaveLength(1)
})

test('sourcify verification treats a conflict response as already verified', async () => {
	const { fetchFn } = createSourcifyFetchStub(url => {
		if (url.includes('/v2/contract/')) return { payload: { customCode: 'not_verified', errorId: '1', message: 'Contract is not verified' }, status: 404 }
		return { payload: { customCode: 'already_verified', errorId: '2', message: 'Contract is already verified' }, status: 409 }
	})
	const outcomes = await verifyContractsWithSourcify({ fetchFn, inputs: testInputs, jobs: [testJob], log: () => {}, sleep: immediateSleep, target: sourcifySepolia })
	expect(outcomes[0]?.status).toBe('already-verified')
})

test('sourcify verification classifies undeployed contracts and bytecode mismatches', async () => {
	const notDeployed = createSourcifyFetchStub(url => {
		if (url.includes('/v2/contract/')) return { payload: {}, status: 404 }
		return { payload: { customCode: 'contract_not_deployed', errorId: '3', message: `Contract ${testJob.address} is not deployed` }, status: 400 }
	})
	const notDeployedOutcomes = await verifyContractsWithSourcify({ fetchFn: notDeployed.fetchFn, inputs: testInputs, jobs: [testJob], log: () => {}, sleep: immediateSleep, target: sourcifySepolia })
	expect(notDeployedOutcomes[0]?.status).toBe('not-deployed')
	const noMatch = createSourcifyFetchStub(url => {
		if (url.includes('/v2/contract/')) return { payload: {}, status: 404 }
		if (url.includes('/v2/verify/11155111/')) return { payload: { verificationId: 'sourcify-job-2' }, status: 202 }
		return { payload: { error: { customCode: 'no_match', errorId: '4', message: "The onchain and recompiled bytecodes don't match." }, isJobCompleted: true }, status: 200 }
	})
	const noMatchOutcomes = await verifyContractsWithSourcify({ fetchFn: noMatch.fetchFn, inputs: testInputs, jobs: [testJob], log: () => {}, sleep: immediateSleep, target: sourcifySepolia })
	expect(noMatchOutcomes[0]?.status).toBe('failed')
	expect(noMatchOutcomes[0]?.detail).toContain('no_match')
})
