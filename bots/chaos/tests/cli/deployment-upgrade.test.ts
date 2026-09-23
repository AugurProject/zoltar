import { afterEach, expect, test } from 'bun:test'
import { getAddress, privateKeyToAccount, zeroAddress, zeroHash } from '@zoltar/bot-shared/ethereum'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import example from '../../config/operator.example.json'
import { prepareCurrentDeployment, retirementUpgradeStatus } from '../../src/cli/deployment-upgrade.ts'
import { canonicalDeployment } from '../../src/config/canonical-deployment.ts'
import { deploymentFactoryId, executionProfileId } from '../../src/config/execution-profile.ts'
import { loadSettings, parseSettings, serializedSettings } from '../../src/config/settings.ts'
import { applyRetirementAssessment } from '../../src/runtime/retirement-assessment.ts'
import { initialDurableState } from '../../src/state/initial-state.ts'
import { loadDurableState, saveDurableState } from '../../src/state/operator-state.ts'
import { acceptResidualProfileReplacement, DEFAULT_RETIREMENT_POLICIES } from '../../src/state/retirement.ts'

const directories: string[] = []
const signerKey = `0x${'33'.repeat(32)}` as const

afterEach(async () => {
	await Promise.all(directories.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

async function fixture(operated: boolean, factoryOnly = false) {
	const directory = await mkdtemp('/tmp/zoltar-chaos-current-deployment-')
	directories.push(directory)
	const path = join(directory, 'operator.json')
	const stateFile = join(directory, 'state.json')
	const settings = parseSettings({
		...example,
		connectivity: { publicRpcUrls: ['https://broadcast.example'], quorumRpcUrls: ['https://second.example'], readRpcUrl: 'https://read.example', rpcQuorum: 1 },
		...(factoryOnly ? { network: { ...example.network, chainId: 4_242_424_242, explorerUrl: 'https://explorer.factory-replay.example', kind: 'custom', name: 'Factory Replay' } } : {}),
		networkConfigured: true,
		paused: false,
		privateKey: signerKey,
		runtime: { ...example.runtime, execute: true, stateFile },
	})
	if (factoryOnly) settings.deployment.uniswapV3Factory = getAddress('0x0000000000000000000000000000000000000001')
	else settings.deployment.zoltar = getAddress('0x0000000000000000000000000000000000000001')
	await writeFile(path, `${JSON.stringify(serializedSettings(settings))}\n`, { mode: 0o600 })
	const signer = privateKeyToAccount(signerKey).address
	const state = initialDurableState(settings.network.chainId, true, executionProfileId(settings), operated ? signer : undefined)
	state.uniswapV3Factory = settings.deployment.uniswapV3Factory
	if (operated) state.activities.push({ at: new Date(0).toISOString(), message: 'Earlier operation', status: 'info', type: 'configuration' })
	await saveDurableState(stateFile, state)
	return { path, settings, signer, state, stateFile }
}

const noLocks = async () => ({ release: async () => undefined })

test('updates a pristine old pin to the current contracts without changing its state', async () => {
	const { path, stateFile } = await fixture(false)
	const before = await readFile(stateFile)
	const result = await prepareCurrentDeployment({
		acquireLocks: noLocks,
		ask: async () => {
			throw new Error('Unexpected retirement prompt')
		},
		path,
	})
	expect(result.kind).toBe('current')
	expect((await loadSettings(path)).settings.deployment).toEqual(canonicalDeployment(11_155_111))
	expect(await readFile(stateFile)).toEqual(before)
})

test('moves a pristine factory-only journal aside before selecting the current factory', async () => {
	const { path, settings, stateFile } = await fixture(false, true)
	const before = await readFile(stateFile)
	const result = await prepareCurrentDeployment({ acquireLocks: noLocks, path })
	expect(result.kind).toBe('current')
	const next = (await loadSettings(path)).settings
	expect(next.deployment.uniswapV3Factory).toBe(canonicalDeployment(settings.network.chainId).uniswapV3Factory)
	expect(next.runtime.stateFile).not.toBe(stateFile)
	expect(await readFile(stateFile)).toEqual(before)
})

test('moves an unoperated keyless journal to a fresh state file without requesting retirement', async () => {
	const { path, settings, stateFile } = await fixture(false)
	const keyless = { ...settings, paused: true, privateKey: undefined, runtime: { ...settings.runtime, execute: false } }
	await writeFile(path, `${JSON.stringify(serializedSettings(keyless))}\n`, { mode: 0o600 })
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.activities.push({ at: new Date(0).toISOString(), message: 'Dry-run scan', status: 'info', type: 'configuration' })
	await saveDurableState(stateFile, state)
	const before = await readFile(stateFile)
	const result = await prepareCurrentDeployment({
		acquireLocks: noLocks,
		ask: async () => {
			throw new Error('Unexpected retirement prompt')
		},
		path,
	})
	expect(result.kind).toBe('current')
	const loaded = await loadSettings(path)
	expect(loaded.settings.deployment).toEqual(canonicalDeployment(settings.network.chainId))
	expect(loaded.settings.runtime.stateFile).not.toBe(stateFile)
	expect(await readFile(stateFile)).toEqual(before)
})

test('moves an unoperated signerless journal after a signer is configured', async () => {
	const { path, settings, stateFile } = await fixture(false)
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.uniswapV3Factory = undefined
	state.activities.push({ at: new Date(0).toISOString(), message: 'Dry-run scan before signer setup', status: 'info', type: 'configuration' })
	await saveDurableState(stateFile, state)
	const before = await readFile(stateFile)
	const result = await prepareCurrentDeployment({
		acquireLocks: noLocks,
		ask: async () => {
			throw new Error('Unexpected retirement prompt')
		},
		path,
	})
	expect(result.kind).toBe('current')
	expect((await loadSettings(path)).settings.runtime.stateFile).not.toBe(stateFile)
	expect(await readFile(stateFile)).toEqual(before)
})

test('does not infer an operated unpinned journal factory from the current core profile', async () => {
	const { path, settings, signer, stateFile } = await fixture(false, true)
	const current = { ...settings, deployment: canonicalDeployment(settings.network.chainId) }
	const unpinned = serializedSettings(current)
	Reflect.deleteProperty(unpinned, 'deploymentPin')
	await writeFile(path, `${JSON.stringify(unpinned)}\n`, { mode: 0o600 })
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.profileId = executionProfileId(current)
	state.signerAddress = signer
	state.uniswapV3Factory = undefined
	state.activities.push({ at: new Date(0).toISOString(), message: 'Earlier V3 operation', status: 'info', type: 'operation' })
	await saveDurableState(stateFile, state)
	const configBefore = await readFile(path)
	const stateBefore = await readFile(stateFile)
	await expect(prepareCurrentDeployment({ acquireLocks: noLocks, path })).rejects.toThrow('different Uniswap V3 factory')
	expect(await readFile(path)).toEqual(configBefore)
	expect(await readFile(stateFile)).toEqual(stateBefore)
})

test('does not treat a keyless journal with pending work as unoperated', async () => {
	const { path, settings, stateFile } = await fixture(false)
	const keyless = { ...settings, paused: true, privateKey: undefined, runtime: { ...settings.runtime, execute: false } }
	await writeFile(path, `${JSON.stringify(serializedSettings(keyless))}\n`, { mode: 0o600 })
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.safetyPaused = true
	await saveDurableState(stateFile, state)
	const configBefore = await readFile(path)
	const stateBefore = await readFile(stateFile)
	await expect(
		prepareCurrentDeployment({
			acquireLocks: noLocks,
			ask: async () => {
				throw new Error('Unexpected retirement prompt')
			},
			path,
		}),
	).rejects.toThrow('Enable live execution')
	expect(await readFile(path)).toEqual(configBefore)
	expect(await readFile(stateFile)).toEqual(stateBefore)
})

test('does not discard a signerless journal that records an earlier operation', async () => {
	const { path, settings, stateFile } = await fixture(false)
	const keyless = { ...settings, paused: true, privateKey: undefined, runtime: { ...settings.runtime, execute: false } }
	await writeFile(path, `${JSON.stringify(serializedSettings(keyless))}\n`, { mode: 0o600 })
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.activities.push({ at: new Date(0).toISOString(), message: 'Confirmed prior action', status: 'confirmed', type: 'operation' })
	await saveDurableState(stateFile, state)
	const configBefore = await readFile(path)
	const stateBefore = await readFile(stateFile)
	await expect(prepareCurrentDeployment({ acquireLocks: noLocks, path })).rejects.toThrow('Enable live execution')
	expect(await readFile(path)).toEqual(configBefore)
	expect(await readFile(stateFile)).toEqual(stateBefore)
})

test('selects current contracts for a safely migratable zero-root bootstrap journal', async () => {
	const { path, settings, signer, stateFile } = await fixture(true)
	const zeroed = structuredClone(settings)
	for (const key of Object.keys(zeroed.deployment)) Reflect.set(zeroed.deployment, key, zeroAddress)
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.profileId = executionProfileId(zeroed)
	state.uniswapV3Factory = undefined
	state.safetyPaused = true
	state.activities = [
		{ at: new Date(0).toISOString(), message: `Operator cycle stopped safely: No contract code on RPC chain ${settings.network.chainId.toString()} at block 100: zoltar (${zeroAddress}). Verify the selected network, RPC synchronization, and deployment addresses before retrying.`, status: 'failed', type: 'error' },
	]
	await saveDurableState(stateFile, state)
	const before = await readFile(stateFile)
	const result = await prepareCurrentDeployment({
		acquireLocks: noLocks,
		ask: async () => {
			throw new Error('Unexpected retirement prompt')
		},
		path,
	})
	expect(result.kind).toBe('current')
	expect((await loadSettings(path)).settings.deployment).toEqual(canonicalDeployment(settings.network.chainId))
	expect((await loadSettings(path)).settings.runtime.stateFile).toBe(stateFile)
	expect(await readFile(stateFile)).toEqual(before)
	expect(state.signerAddress).toBe(signer)
	state.activities.push({ at: new Date(1).toISOString(), message: 'Operation planned', status: 'dry-run', type: 'operation' })
	await saveDurableState(stateFile, state)
	const rejectedBefore = await readFile(stateFile)
	await expect(
		prepareCurrentDeployment({
			acquireLocks: noLocks,
			ask: async () => {
				throw new Error('Unexpected retirement prompt')
			},
			path,
		}),
	).rejects.toThrow('restore the old pin')
	expect(await readFile(stateFile)).toEqual(rejectedBefore)
})

test('prompts once to retire operated old contracts and keeps the old pin until completion', async () => {
	const { path, settings, signer, stateFile } = await fixture(true)
	const recipient = signer
	const answers = [`DRAIN ${executionProfileId(settings)} TO ${recipient}`]
	const result = await prepareCurrentDeployment({
		acquireLocks: noLocks,
		ask: async () => {
			const answer = answers.shift()
			if (answer === undefined) throw new Error('Unexpected retirement prompt')
			return answer
		},
		path,
	})
	expect(result.kind).toBe('retiring')
	expect(answers).toEqual([])
	expect((await loadSettings(path)).settings.deployment).toEqual(settings.deployment)
	const state = await loadDurableState(stateFile, settings.network.chainId)
	expect(state.retirement).toMatchObject({ recipient, status: 'requested' })
	expect(state.signerAddress).toBe(signer)
	expect(await retirementUpgradeStatus(path)).toBe('retiring')
})

test('discloses default retirement policies and replaces policies from a cancelled drain', async () => {
	const { path, settings, signer, stateFile } = await fixture(true)
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.retirement.cancelledAt = new Date(0).toISOString()
	state.retirement.policies = { ...DEFAULT_RETIREMENT_POLICIES, exitUnmatchedShares: true, maximumExitLossBps: 1_000, sweepAssets: false }
	await saveDurableState(stateFile, state)
	const recipient = signer
	const answers = [`DRAIN ${state.profileId} TO ${recipient}`]
	const prompts: string[] = []
	await prepareCurrentDeployment({
		acquireLocks: noLocks,
		ask: async message => {
			prompts.push(message)
			const answer = answers.shift()
			if (answer === undefined) throw new Error('Unexpected retirement prompt')
			return answer
		},
		path,
	})
	expect(prompts[0]).toContain('recover claimable ETH and REP to signer')
	expect((await loadDurableState(stateFile, settings.network.chainId)).retirement.policies).toEqual(DEFAULT_RETIREMENT_POLICIES)
})

test('rejects a single read origin before prompting for retirement', async () => {
	const { path, settings, stateFile } = await fixture(true)
	if (settings.connectivity === undefined) throw new Error('Fixture requires RPC connectivity')
	const singleReader = { ...settings, connectivity: { ...settings.connectivity, quorumRpcUrls: [] } }
	await writeFile(path, `${JSON.stringify(serializedSettings(singleReader))}\n`, { mode: 0o600 })
	const configBefore = await readFile(path)
	const stateBefore = await readFile(stateFile)
	await expect(
		prepareCurrentDeployment({
			acquireLocks: noLocks,
			ask: async () => {
				throw new Error('Unexpected retirement prompt')
			},
			path,
		}),
	).rejects.toThrow('two independent RPC readers')
	expect(await readFile(path)).toEqual(configBefore)
	expect(await readFile(stateFile)).toEqual(stateBefore)
})

test('uses a fresh state path after verified retirement and preserves the old journal', async () => {
	const { path, settings, signer, stateFile } = await fixture(true)
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.retirement.status = 'drained'
	state.retirement.recipient = signer
	state.retirement.completionEvidence = {
		blockHash: zeroHash,
		blockNumber: '42',
		completedAt: '2026-09-23T00:00:00.000Z',
		profileId: state.profileId,
		proof: { actionableObligations: 0, claimableAssets: 0, collectableV3Positions: 0, knownApprovals: 0, ownedLiquidityPositions: 0, partialWorkflows: 0, pendingTransactions: 0 },
		residuals: [],
		signerAddress: signer,
	}
	await saveDurableState(stateFile, state)
	const before = await readFile(stateFile)
	expect(await retirementUpgradeStatus(path, async () => undefined)).toBe('ready')
	let verified = false
	const result = await prepareCurrentDeployment({
		acquireLocks: noLocks,
		ask: async () => {
			throw new Error('Unexpected retirement prompt')
		},
		path,
		verifyCompletion: async () => {
			verified = true
		},
	})
	expect(result.kind).toBe('current')
	expect(verified).toBeTrue()
	const loaded = await loadSettings(path)
	expect(loaded.settings.deployment).toEqual(canonicalDeployment(11_155_111))
	expect(loaded.settings.runtime.stateFile).not.toBe(stateFile)
	expect(await readFile(stateFile)).toEqual(before)
})

test('retires an operated pinned deployment when only its Uniswap factory changes', async () => {
	const { path, settings, signer, stateFile } = await fixture(true, true)
	const canonical = canonicalDeployment(settings.network.chainId)
	expect(executionProfileId(settings)).toBe(executionProfileId({ ...settings, deployment: canonical }))
	expect(settings.deployment.uniswapV3Factory).not.toBe(canonical.uniswapV3Factory)
	const request = await prepareCurrentDeployment({ acquireLocks: noLocks, ask: async () => `DRAIN ${executionProfileId(settings)} TO ${signer}`, path })
	expect(request.kind).toBe('retiring')
	expect((await loadSettings(path)).settings.deployment.uniswapV3Factory).toBe(settings.deployment.uniswapV3Factory)
	const state = await loadDurableState(stateFile, settings.network.chainId)
	expect(state.retirement).toMatchObject({ recipient: signer, status: 'requested' })
	state.retirement.status = 'drained'
	state.retirement.completionEvidence = {
		blockHash: zeroHash,
		blockNumber: '42',
		completedAt: '2026-09-23T00:00:00.000Z',
		profileId: state.profileId,
		proof: { actionableObligations: 0, claimableAssets: 0, collectableV3Positions: 0, knownApprovals: 0, ownedLiquidityPositions: 0, partialWorkflows: 0, pendingTransactions: 0 },
		residuals: [],
		signerAddress: signer,
	}
	await saveDurableState(stateFile, state)
	const oldJournal = await readFile(stateFile)
	expect(await retirementUpgradeStatus(path, async () => undefined)).toBe('ready')
	let finalityChecked = false
	const result = await prepareCurrentDeployment({
		acquireLocks: noLocks,
		path,
		verifyCompletion: async () => {
			finalityChecked = true
		},
	})
	expect(result.kind).toBe('current')
	expect(finalityChecked).toBeTrue()
	const next = (await loadSettings(path)).settings
	expect(next.deployment).toEqual(canonical)
	expect(next.runtime.stateFile).not.toBe(stateFile)
	expect(await readFile(stateFile)).toEqual(oldJournal)
})

test('requires a factory-bound residual acceptance for a factory-only replacement', async () => {
	const { path, settings, signer, stateFile } = await fixture(true, true)
	const factory = canonicalDeployment(settings.network.chainId).uniswapV3Factory
	if (factory === undefined) throw new Error('Canonical factory fixture is missing')
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.retirement.status = 'drained-with-residuals'
	state.retirement.recipient = signer
	state.retirement.completionEvidence = {
		blockHash: zeroHash,
		blockNumber: '42',
		completedAt: '2026-09-23T00:00:00.000Z',
		profileId: state.profileId,
		proof: { actionableObligations: 0, claimableAssets: 0, collectableV3Positions: 0, knownApprovals: 0, ownedLiquidityPositions: 0, partialWorkflows: 0, pendingTransactions: 0 },
		residuals: [{ amount: '1', asset: 'TEST', category: 'operator-accepted', reason: 'Reviewed retained asset' }],
		signerAddress: signer,
	}
	await saveDurableState(stateFile, state)
	const targetId = deploymentFactoryId(state.profileId, factory)
	expect(targetId).toStartWith('factory:v1:')
	expect(await retirementUpgradeStatus(path, async () => undefined)).toBe('retiring')
	const waiting = await prepareCurrentDeployment({ acquireLocks: noLocks, path })
	expect(waiting).toMatchObject({ kind: 'retiring' })
	expect(waiting.message).toContain(targetId)
	acceptResidualProfileReplacement(state.retirement, state.profileId, targetId, 'Reviewed residuals before replacing this factory.', `ACCEPT RESIDUALS FOR ${targetId}`)
	await saveDurableState(stateFile, state)
	expect(await retirementUpgradeStatus(path, async () => undefined)).toBe('ready')
	const result = await prepareCurrentDeployment({ acquireLocks: noLocks, path, verifyCompletion: async () => undefined })
	expect(result.kind).toBe('current')
	expect((await loadSettings(path)).settings.runtime.stateFile).not.toBe(stateFile)
})

test('keeps the old deployment when finality verification fails', async () => {
	const { path, settings, signer, stateFile } = await fixture(true)
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.retirement.status = 'drained'
	state.retirement.recipient = signer
	state.retirement.completionEvidence = {
		blockHash: zeroHash,
		blockNumber: '42',
		completedAt: '2026-09-23T00:00:00.000Z',
		profileId: state.profileId,
		proof: { actionableObligations: 0, claimableAssets: 0, collectableV3Positions: 0, knownApprovals: 0, ownedLiquidityPositions: 0, partialWorkflows: 0, pendingTransactions: 0 },
		residuals: [],
		signerAddress: signer,
	}
	await saveDurableState(stateFile, state)
	const configBefore = await readFile(path)
	const stateBefore = await readFile(stateFile)
	await expect(
		retirementUpgradeStatus(path, async () => {
			throw new Error('Finalized block mismatch')
		}),
	).rejects.toThrow('Finalized block mismatch')
	await expect(
		prepareCurrentDeployment({
			acquireLocks: noLocks,
			path,
			verifyCompletion: async () => {
				throw new Error('Finalized block mismatch')
			},
		}),
	).rejects.toThrow('Finalized block mismatch')
	expect(await readFile(path)).toEqual(configBefore)
	expect(await readFile(stateFile)).toEqual(stateBefore)
})

test('rejects a changed signer before requesting retirement or changing either file', async () => {
	const { path, settings, stateFile } = await fixture(true)
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.signerAddress = privateKeyToAccount(`0x${'44'.repeat(32)}`).address
	await saveDurableState(stateFile, state)
	const configBefore = await readFile(path)
	const stateBefore = await readFile(stateFile)
	await expect(
		prepareCurrentDeployment({
			acquireLocks: noLocks,
			ask: async () => {
				throw new Error('Unexpected retirement prompt')
			},
			path,
		}),
	).rejects.toThrow('restore the old signer')
	expect(await readFile(path)).toEqual(configBefore)
	expect(await readFile(stateFile)).toEqual(stateBefore)
})

test('requires the exact retirement confirmation before changing the old state', async () => {
	const { path, stateFile } = await fixture(true)
	const configBefore = await readFile(path)
	const stateBefore = await readFile(stateFile)
	const answers = ['0x0000000000000000000000000000000000000099', 'DRAIN']
	await expect(
		prepareCurrentDeployment({
			acquireLocks: noLocks,
			ask: async () => {
				const answer = answers.shift()
				if (answer === undefined) throw new Error('Unexpected retirement prompt')
				return answer
			},
			path,
		}),
	).rejects.toThrow('Confirmation must exactly match')
	expect(await readFile(path)).toEqual(configBefore)
	expect(await readFile(stateFile)).toEqual(stateBefore)
})

test('waits for explicit acceptance of residuals before switching deployments', async () => {
	const { path, settings, signer, stateFile } = await fixture(true)
	const state = await loadDurableState(stateFile, settings.network.chainId)
	const current = canonicalDeployment(settings.network.chainId)
	const targetProfileId = executionProfileId({ ...settings, deployment: current })
	const factory = current.uniswapV3Factory
	if (factory === undefined) throw new Error('Canonical factory fixture is missing')
	const targetDeploymentId = deploymentFactoryId(targetProfileId, factory)
	state.retirement.status = 'drained-with-residuals'
	state.retirement.recipient = signer
	state.retirement.completionEvidence = {
		blockHash: zeroHash,
		blockNumber: '42',
		completedAt: '2026-09-23T00:00:00.000Z',
		profileId: state.profileId,
		proof: { actionableObligations: 0, claimableAssets: 0, collectableV3Positions: 0, knownApprovals: 0, ownedLiquidityPositions: 0, partialWorkflows: 0, pendingTransactions: 0 },
		residuals: [{ amount: '1', asset: 'TEST', category: 'operator-accepted', reason: 'Reviewed retained asset' }],
		signerAddress: signer,
	}
	await saveDurableState(stateFile, state)
	expect(await retirementUpgradeStatus(path)).toBe('retiring')
	expect(
		(
			await prepareCurrentDeployment({
				acquireLocks: noLocks,
				ask: async () => {
					throw new Error('Unexpected retirement prompt')
				},
				path,
			})
		).kind,
	).toBe('retiring')
	expect((await loadSettings(path)).settings.deployment).toEqual(settings.deployment)
	acceptResidualProfileReplacement(state.retirement, state.profileId, targetDeploymentId, 'Reviewed retained asset and accepted replacement.', `ACCEPT RESIDUALS FOR ${targetDeploymentId}`)
	const completionEvidence = state.retirement.completionEvidence
	if (completionEvidence === undefined) throw new Error('Missing residual completion evidence')
	applyRetirementAssessment(state.retirement, { action: undefined, blockers: [], proof: completionEvidence.proof, residuals: completionEvidence.residuals, status: 'drained-with-residuals' }, zeroHash, 43n, { profileId: state.profileId, scannedWallet: signer, signerAddress: signer })
	expect(state.retirement.completionEvidence).toEqual(completionEvidence)
	await saveDurableState(stateFile, state)
	expect((await loadDurableState(stateFile, settings.network.chainId)).retirement.profileReplacementOverride).toMatchObject({ sourceProfileId: state.profileId, targetProfileId: targetDeploymentId })
	expect(await retirementUpgradeStatus(path, async () => undefined)).toBe('ready')
	expect(
		(
			await prepareCurrentDeployment({
				acquireLocks: noLocks,
				ask: async () => {
					throw new Error('Unexpected retirement prompt')
				},
				path,
				verifyCompletion: async () => undefined,
			})
		).kind,
	).toBe('current')
})
