import { afterEach, expect, test } from 'bun:test'
import { getAddress, privateKeyToAccount, zeroAddress, zeroHash } from '@zoltar/bot-shared/ethereum'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import example from '../../config/operator.example.json'
import { listDeploymentArchives, prepareArchivedRetirement, prepareCurrentDeployment, retirementUpgradeStatus } from '../../src/cli/deployment-upgrade.ts'
import { canonicalDeployment } from '../../src/config/canonical-deployment.ts'
import { deploymentFactoryId, executionProfileId } from '../../src/config/execution-profile.ts'
import { loadSettings, parseSettings, serializedSettings } from '../../src/config/settings.ts'
import { RetirementCompletionPendingError } from '../../src/runtime/deployment-profile.ts'
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
			path,
		}),
	).rejects.toThrow('restore the old pin')
	expect(await readFile(stateFile)).toEqual(rejectedBefore)
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
			path,
		}),
	).rejects.toThrow('restore the old signer')
	expect(await readFile(path)).toEqual(configBefore)
	expect(await readFile(stateFile)).toEqual(stateBefore)
})

test('starts latest contracts immediately while an old deployment is still draining', async () => {
	const { path, settings, stateFile } = await fixture(true)
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.retirement.status = 'draining'
	await saveDurableState(stateFile, state)
	const before = await readFile(stateFile)
	const result = await prepareCurrentDeployment({ acquireLocks: noLocks, path })
	expect(result.kind).toBe('current')
	expect((await loadSettings(path)).settings.deployment).toEqual(canonicalDeployment(settings.network.chainId))
	expect((await loadSettings(path)).settings.runtime.stateFile).not.toBe(stateFile)
	expect(await readFile(stateFile)).toEqual(before)
})

test.each([false, true])('archives an old profile and immediately selects latest contracts (operated: %s)', async operated => {
	const { path, settings, stateFile } = await fixture(operated)
	const before = await readFile(stateFile)
	await writeFile(`${stateFile}.protocol-index-v1`, 'index companion')
	await writeFile(`${stateFile}.immutable-topology-v1`, 'topology companion')
	await prepareCurrentDeployment({ acquireLocks: noLocks, path })
	const current = (await loadSettings(path)).settings
	expect(current.deployment).toEqual(canonicalDeployment(settings.network.chainId))
	expect(current.runtime.stateFile).not.toBe(stateFile)
	expect(current.privateKey).toBe(settings.privateKey)
	expect(current.paused).toBe(settings.paused)
	expect(current.runtime.execute).toBe(settings.runtime.execute)
	expect(await readFile(stateFile)).toEqual(before)
	expect(await readFile(`${stateFile}.protocol-index-v1`, 'utf8')).toBe('index companion')
	expect(await readFile(`${stateFile}.immutable-topology-v1`, 'utf8')).toBe('topology companion')
	const archives = await listDeploymentArchives(path)
	expect(archives).toHaveLength(1)
	const archive = archives[0]
	if (archive === undefined) throw new Error('Missing archived deployment')
	const archivedPath = `${path}.retired-${archive.id}.json`
	expect((await loadSettings(archivedPath)).settings).toEqual(settings)
	expect((await stat(archivedPath)).mode & 0o777).toBe(0o600)
	expect(archive.status).toBe('inactive')
	const configBefore = await readFile(path)
	await prepareCurrentDeployment({ acquireLocks: noLocks, path })
	expect(await readFile(path)).toEqual(configBefore)
	expect(await listDeploymentArchives(path)).toEqual(archives)
})

test('archives a factory-only change and retains its original factory pin', async () => {
	const { path, settings, stateFile } = await fixture(true, true)
	const before = await readFile(stateFile)
	await prepareCurrentDeployment({ acquireLocks: noLocks, path })
	const next = (await loadSettings(path)).settings
	expect(executionProfileId(next)).toBe(executionProfileId(settings))
	expect(next.deployment.uniswapV3Factory).toBe(canonicalDeployment(settings.network.chainId).uniswapV3Factory)
	expect(next.runtime.stateFile).not.toBe(stateFile)
	expect(await readFile(stateFile)).toEqual(before)
	const archive = (await listDeploymentArchives(path))[0]
	if (archive === undefined) throw new Error('Missing archive')
	expect((await loadSettings(`${path}.retired-${archive.id}.json`)).settings.deployment).toEqual(settings.deployment)
})

test.each(['paused', 'dry-run'] as const)('starts latest contracts without retiring a %s old profile', async mode => {
	const { path, settings, stateFile } = await fixture(true)
	const disabled = { ...settings, paused: mode === 'paused', runtime: { ...settings.runtime, execute: mode !== 'dry-run' } }
	await writeFile(path, JSON.stringify(serializedSettings(disabled)), { mode: 0o600 })
	const before = await readFile(stateFile)
	await prepareCurrentDeployment({ acquireLocks: noLocks, path })
	expect((await loadSettings(path)).settings.paused).toBe(disabled.paused)
	expect((await loadSettings(path)).settings.runtime.execute).toBe(disabled.runtime.execute)
	expect(await readFile(stateFile)).toEqual(before)
	const archive = (await listDeploymentArchives(path))[0]
	if (archive === undefined) throw new Error('Missing archive')
	await expect(prepareArchivedRetirement(archive.id, { acquireLocks: noLocks, path })).rejects.toThrow('Enable live execution')
	expect(await readFile(stateFile)).toEqual(before)
})

async function archivedFixture() {
	const original = await fixture(true)
	await prepareCurrentDeployment({ acquireLocks: noLocks, path: original.path })
	const archive = (await listDeploymentArchives(original.path))[0]
	if (archive === undefined) throw new Error('Missing archive')
	return { ...original, id: archive.id, archivePath: `${original.path}.retired-${archive.id}.json` }
}

test('requests retirement only for the selected archive and leaves current settings untouched', async () => {
	const { path, settings, signer, stateFile, id, archivePath } = await archivedFixture()
	const currentBefore = await readFile(path)
	const archivedBefore = await readFile(archivePath)
	expect(await prepareArchivedRetirement(id, { acquireLocks: noLocks, path })).toContain('requested')
	expect((await loadDurableState(stateFile, settings.network.chainId)).retirement).toMatchObject({ recipient: signer, status: 'requested', policies: DEFAULT_RETIREMENT_POLICIES })
	expect(await readFile(path)).toEqual(currentBefore)
	expect(await readFile(archivePath)).toEqual(archivedBefore)
	expect(await retirementUpgradeStatus(archivePath)).toBe('retiring')
})

test('resumes an archived drain without changing its policies and replaces cancelled policies on a new request', async () => {
	const { path, settings, stateFile, id } = await archivedFixture()
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.retirement.status = 'waiting'
	state.retirement.policies = { ...DEFAULT_RETIREMENT_POLICIES, unwrapWeth: false, sweepAssets: false }
	await saveDurableState(stateFile, state)
	const before = await readFile(stateFile)
	await prepareArchivedRetirement(id, { acquireLocks: noLocks, path })
	expect(await readFile(stateFile)).toEqual(before)
	state.retirement.status = 'inactive'
	state.retirement.cancelledAt = new Date(0).toISOString()
	await saveDurableState(stateFile, state)
	await prepareArchivedRetirement(id, { acquireLocks: noLocks, path })
	expect((await loadDurableState(stateFile, settings.network.chainId)).retirement.policies).toEqual(DEFAULT_RETIREMENT_POLICIES)
})

test('rejects archive traversal, a missing archive, mismatched signers, and mismatched deployment pins', async () => {
	const { path, settings, stateFile, id } = await archivedFixture()
	await expect(prepareArchivedRetirement('../operator', { acquireLocks: noLocks, path })).rejects.toThrow('Archive ID')
	await expect(prepareArchivedRetirement('0'.repeat(64), { acquireLocks: noLocks, path })).rejects.toThrow('Missing chaos-bot configuration')
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.signerAddress = privateKeyToAccount(`0x${'44'.repeat(32)}`).address
	await saveDurableState(stateFile, state)
	await expect(prepareArchivedRetirement(id, { acquireLocks: noLocks, path })).rejects.toThrow('Restore the archived signer')
	state.profileId = 'profile:v1:wrong'
	await saveDurableState(stateFile, state)
	await expect(prepareArchivedRetirement(id, { acquireLocks: noLocks, path })).rejects.toThrow('Archived configuration does not match')
})

test('preserves multiple archives and requires an explicit ID to choose between them', async () => {
	const first = await archivedFixture()
	const current = (await loadSettings(first.path)).settings
	current.deployment.zoltar = getAddress('0x0000000000000000000000000000000000000002')
	await writeFile(first.path, JSON.stringify(serializedSettings(current)), { mode: 0o600 })
	await prepareCurrentDeployment({ acquireLocks: noLocks, path: first.path })
	const archives = await listDeploymentArchives(first.path)
	expect(archives).toHaveLength(2)
	await expect(prepareArchivedRetirement('', { acquireLocks: noLocks, path: first.path })).rejects.toThrow('Archive ID')
	await prepareArchivedRetirement(first.id, { acquireLocks: noLocks, path: first.path })
	expect((await loadDurableState(first.stateFile, first.settings.network.chainId)).retirement.status).toBe('requested')
	expect((await loadDurableState(current.runtime.stateFile, current.network.chainId)).retirement.status).toBe('inactive')
})

async function completedArchive(residuals = false) {
	const fixture = await archivedFixture()
	const state = await loadDurableState(fixture.stateFile, fixture.settings.network.chainId)
	state.retirement.status = residuals ? 'drained-with-residuals' : 'drained'
	state.retirement.recipient = fixture.signer
	state.retirement.completionEvidence = {
		blockHash: zeroHash,
		blockNumber: '42',
		completedAt: '2026-09-23T00:00:00.000Z',
		profileId: state.profileId,
		proof: { actionableObligations: 0, claimableAssets: 0, collectableV3Positions: 0, knownApprovals: 0, ownedLiquidityPositions: 0, partialWorkflows: 0, pendingTransactions: 0 },
		residuals: residuals ? [{ amount: '1', asset: 'TEST', category: 'operator-accepted', reason: 'Reviewed retained asset' }] : [],
		signerAddress: fixture.signer,
	}
	await saveDurableState(fixture.stateFile, state)
	return { ...fixture, state }
}

test('requires finalized canonical evidence before reporting an archive ready', async () => {
	const { archivePath } = await completedArchive()
	expect(
		await retirementUpgradeStatus(archivePath, async () => {
			throw new RetirementCompletionPendingError()
		}),
	).toBe('retiring')
	await expect(
		retirementUpgradeStatus(archivePath, async () => {
			throw new Error('Finalized block mismatch')
		}),
	).rejects.toThrow('Finalized block mismatch')
	let verified = false
	expect(
		await retirementUpgradeStatus(archivePath, async () => {
			verified = true
		}),
	).toBe('ready')
	expect(verified).toBe(true)
})

test('requires factory-bound residual acceptance and preserves completion evidence', async () => {
	const { archivePath, path, state, stateFile } = await completedArchive(true)
	const current = (await loadSettings(path)).settings
	const factory = current.deployment.uniswapV3Factory
	if (factory === undefined) throw new Error('Missing factory')
	const targetId = deploymentFactoryId(executionProfileId(current), factory)
	expect(await retirementUpgradeStatus(archivePath, async () => undefined)).toBe('retiring')
	acceptResidualProfileReplacement(state.retirement, state.profileId, targetId, 'Reviewed retained asset and accepted replacement.', `ACCEPT RESIDUALS FOR ${targetId}`)
	await saveDurableState(stateFile, state)
	const before = await readFile(stateFile)
	expect(await retirementUpgradeStatus(archivePath, async () => undefined)).toBe('ready')
	expect(await readFile(stateFile)).toEqual(before)
})

test('still verifies finality when an archived deployment matches the current manifest', async () => {
	const { archivePath, state, stateFile, settings } = await completedArchive()
	const archived = { ...settings, deployment: canonicalDeployment(settings.network.chainId) }
	state.profileId = executionProfileId(archived)
	if (state.retirement.completionEvidence === undefined) throw new Error('Missing evidence')
	state.retirement.completionEvidence.profileId = state.profileId
	await writeFile(archivePath, JSON.stringify(serializedSettings(archived)), { mode: 0o600 })
	await saveDurableState(stateFile, state)
	expect(
		await retirementUpgradeStatus(archivePath, async () => {
			throw new RetirementCompletionPendingError()
		}),
	).toBe('retiring')
})

test('rejects unbound completion evidence and stale residual acceptance', async () => {
	const completed = await completedArchive()
	if (completed.state.retirement.completionEvidence === undefined) throw new Error('Missing evidence')
	completed.state.retirement.completionEvidence.profileId = 'profile:v1:wrong'
	await saveDurableState(completed.stateFile, completed.state)
	await expect(retirementUpgradeStatus(completed.archivePath, async () => undefined)).rejects.toThrow('must match the archived deployment and signer')
	const residual = await completedArchive(true)
	const current = (await loadSettings(residual.path)).settings
	const factory = current.deployment.uniswapV3Factory
	if (factory === undefined) throw new Error('Missing factory')
	const targetId = deploymentFactoryId(executionProfileId(current), factory)
	acceptResidualProfileReplacement(residual.state.retirement, residual.state.profileId, targetId, 'Reviewed retained asset and accepted replacement.', `ACCEPT RESIDUALS FOR ${targetId}`)
	if (residual.state.retirement.completionEvidence === undefined) throw new Error('Missing evidence')
	residual.state.retirement.completionEvidence.blockNumber = '43'
	await expect(saveDurableState(residual.stateFile, residual.state)).rejects.toThrow('Residual profile replacement override does not match current completion evidence')
})

test('releases locks after a rejected archive and does not overwrite an existing different archive', async () => {
	const { path, settings, id, archivePath, stateFile } = await archivedFixture()
	const archived = (await loadSettings(archivePath)).settings
	archived.paused = true
	await writeFile(archivePath, JSON.stringify(serializedSettings(archived)), { mode: 0o600 })
	let released = false
	const acquireLocks = async () => ({
		release: async () => {
			released = true
		},
	})
	await expect(prepareArchivedRetirement(id, { acquireLocks, path })).rejects.toThrow('Enable live execution')
	expect(released).toBe(true)
	await writeFile(path, JSON.stringify(serializedSettings(settings)), { mode: 0o600 })
	const configBefore = await readFile(path)
	const archiveBefore = await readFile(archivePath)
	const stateBefore = await readFile(stateFile)
	await expect(prepareCurrentDeployment({ acquireLocks: noLocks, path })).rejects.toThrow('already exists with different settings')
	expect(await readFile(path)).toEqual(configBefore)
	expect(await readFile(archivePath)).toEqual(archiveBefore)
	expect(await readFile(stateFile)).toEqual(stateBefore)
})

test('moves an unoperated signerless journal after a signer is configured without discarding its history', async () => {
	const { path, settings, stateFile } = await fixture(false)
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.uniswapV3Factory = undefined
	state.activities.push({ at: new Date(0).toISOString(), message: 'Dry-run scan before signer setup', status: 'info', type: 'configuration' })
	await saveDurableState(stateFile, state)
	const before = await readFile(stateFile)
	await prepareCurrentDeployment({ acquireLocks: noLocks, path })
	expect((await loadSettings(path)).settings.runtime.stateFile).not.toBe(stateFile)
	expect((await loadSettings(path)).settings.deployment).toEqual(canonicalDeployment(settings.network.chainId))
	expect(await readFile(stateFile)).toEqual(before)
	const archive = (await listDeploymentArchives(path))[0]
	if (archive === undefined) throw new Error('Missing archive')
	expect((await loadSettings(`${path}.retired-${archive.id}.json`)).settings).toEqual(settings)
})

test('moves unbound signerless audit history aside even when its pin already matches the latest manifest', async () => {
	const { path, settings, stateFile } = await fixture(false)
	settings.deployment = canonicalDeployment(settings.network.chainId)
	await writeFile(path, JSON.stringify(serializedSettings(settings)), { mode: 0o600 })
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.profileId = executionProfileId(settings)
	state.uniswapV3Factory = undefined
	state.activities.push({ at: new Date(0).toISOString(), message: 'Dry-run scan', status: 'dry-run', type: 'operation' })
	await saveDurableState(stateFile, state)
	const before = await readFile(stateFile)
	await prepareCurrentDeployment({ acquireLocks: noLocks, path })
	expect((await loadSettings(path)).settings.runtime.stateFile).not.toBe(stateFile)
	expect(await readFile(stateFile)).toEqual(before)
	const archive = (await listDeploymentArchives(path))[0]
	if (archive === undefined) throw new Error('Missing archive')
	await prepareArchivedRetirement(archive.id, { acquireLocks: noLocks, path })
	const retired = await loadDurableState(stateFile, settings.network.chainId)
	expect(retired.uniswapV3Factory).toBe(settings.deployment.uniswapV3Factory)
	expect(retired.retirement.status).toBe('requested')
	expect(retired.activities).toEqual(state.activities)
})

test.each(['safety-paused', 'confirmed-operation', 'transaction'] as const)('does not infer an unbound factory for a signerless journal with %s history', async history => {
	const { path, settings, stateFile } = await fixture(false)
	const state = await loadDurableState(stateFile, settings.network.chainId)
	state.uniswapV3Factory = undefined
	if (history === 'safety-paused') state.safetyPaused = true
	else state.activities.push({ at: new Date(0).toISOString(), message: 'Earlier activity', status: 'confirmed', type: history === 'transaction' ? 'transaction' : 'operation' })
	await saveDurableState(stateFile, state)
	const before = await readFile(stateFile)
	await expect(prepareCurrentDeployment({ acquireLocks: noLocks, path })).rejects.toThrow('different Uniswap V3 factory')
	expect(await readFile(stateFile)).toEqual(before)
	expect(await listDeploymentArchives(path)).toEqual([])
})
