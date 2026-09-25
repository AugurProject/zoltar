#!/usr/bin/env bun

import { privateKeyToAccount, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { acquireBotProcessLocks } from '@zoltar/bot-shared/execution/bot-process-locks'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { canonicalDeployment } from '../config/canonical-deployment.ts'
import { assertDurableDeploymentFactory, restoreDeploymentForDurableState } from '../config/deployment-state.ts'
import { executionProfileId } from '../config/execution-profile.ts'
import { assertSettingsProfileIsolation, loadSettings, saveSettings, serializedSettings, type OperatorSettings } from '../config/settings.ts'
import { CHAOS_PROCESS_LOCK_OPTIONS } from '../core/process-lock-options.ts'
import { retirementReplacementTargetId, RetirementCompletionPendingError, verifyRetirementCompletionFinality } from '../runtime/deployment-profile.ts'
import { migrateEmptyBootstrapState } from '../state/bootstrap-migration.ts'
import { loadDurableState, saveDurableState } from '../state/operator-state.ts'
import { isPristineBootstrapState } from '../state/pristine.ts'
import { assertSafeRetirementRecipient, DEFAULT_RETIREMENT_POLICIES, requestRetirement } from '../state/retirement.ts'

type PreparationOptions = {
	acquireLocks?: (settings: OperatorSettings) => Promise<{ release: () => Promise<void> }>
	path?: string
}

const RETIRING_EXIT_CODE = 10

async function acquireUpgradeLocks(settings: OperatorSettings) {
	return acquireBotProcessLocks(
		{
			chainId: settings.network.chainId,
			execute: settings.runtime.execute,
			privateKey: settings.privateKey,
			signerLockRoot: process.env['ZOLTAR_BOT_SIGNER_LOCK_ROOT'],
			stateFile: settings.runtime.stateFile,
		},
		CHAOS_PROCESS_LOCK_OPTIONS,
	)
}

function configuredWallet(settings: OperatorSettings) {
	return settings.privateKey === undefined ? undefined : privateKeyToAccount(settings.privateKey).address
}

function deploymentIsCurrent(settings: OperatorSettings, current: OperatorSettings) {
	return executionProfileId(settings) === executionProfileId(current) && settings.deployment.uniswapV3Factory?.toLowerCase() === current.deployment.uniswapV3Factory?.toLowerCase()
}

function archivePath(path: string, id: string) {
	if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Archive ID must be the 64-character ID printed by retirement.bat')
	return `${path}.retired-${id}.json`
}

async function fileExists(path: string) {
	try {
		await lstat(path)
		return true
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false
		throw error
	}
}

async function archiveDeployment(path: string, settings: OperatorSettings) {
	const id = createHash('sha256')
		.update(JSON.stringify({ profile: executionProfileId(settings), factory: settings.deployment.uniswapV3Factory, stateFile: resolve(settings.runtime.stateFile) }))
		.digest('hex')
	const target = archivePath(path, id)
	await assertSettingsProfileIsolation(target, settings)
	if (await fileExists(target)) {
		const previous = await loadSettings(target)
		if (JSON.stringify(serializedSettings(previous.settings)) !== JSON.stringify(serializedSettings(settings))) throw new Error(`Archived configuration ${id} already exists with different settings; preserve and review it before retrying`)
	} else {
		await saveSettings(target, settings)
	}
	return id
}

export async function listDeploymentArchives(path?: string) {
	const loaded = await loadSettings(path)
	const prefix = `${basename(loaded.path)}.retired-`
	const archives: { id: string; profileId: string; stateFile: string; status: string }[] = []
	for (const entry of (await readdir(dirname(loaded.path))).sort()) {
		if (!entry.startsWith(prefix) || !entry.endsWith('.json')) continue
		const id = entry.slice(prefix.length, -5)
		const archived = await loadSettings(archivePath(loaded.path, id))
		const state = await loadDurableState(archived.settings.runtime.stateFile, archived.settings.network.chainId)
		archives.push({ id, profileId: executionProfileId(archived.settings), stateFile: archived.settings.runtime.stateFile, status: state.retirement.status })
	}
	return archives
}

function isUnoperatedSignerlessState(state: Awaited<ReturnType<typeof loadDurableState>>) {
	return (
		state.signerAddress === undefined &&
		(state.protocolIndex === undefined || state.protocolIndex.wallet.toLowerCase() === zeroAddress) &&
		state.activities.every(activity => activity.hash === undefined && activity.type !== 'transaction' && activity.type !== 'recovery' && activity.type !== 'wallet' && (activity.type !== 'operation' || activity.status === 'dry-run' || activity.status === 'skipped')) &&
		state.pendingTransactions.length === 0 &&
		state.includedTransactions.length === 0 &&
		state.rollbackQueue.length === 0 &&
		state.workflows.length === 0 &&
		state.obligations.length === 0 &&
		state.obligationTombstones.length === 0 &&
		state.retirement.status === 'inactive' &&
		state.retirement.positions.length === 0 &&
		!state.safetyPaused
	)
}

export async function prepareCurrentDeployment(options: PreparationOptions = {}) {
	const loaded = await loadSettings(options.path)
	await assertSettingsProfileIsolation(loaded.path, loaded.settings)
	const locks = await (options.acquireLocks ?? acquireUpgradeLocks)(loaded.settings)
	try {
		const state = await loadDurableState(loaded.settings.runtime.stateFile, loaded.settings.network.chainId)
		const active = restoreDeploymentForDurableState(loaded.settings, state, loaded.needsDeploymentPin)
		const current: OperatorSettings = { ...active, deployment: canonicalDeployment(active.network.chainId) }
		const wallet = configuredWallet(active)
		if (wallet !== undefined && state.signerAddress !== undefined && wallet.toLowerCase() !== state.signerAddress.toLowerCase()) throw new Error(`Durable state is scoped to signer ${state.signerAddress}; restore the old signer before changing deployments`)
		const migratedBootstrap = migrateEmptyBootstrapState(state, current)
		if (migratedBootstrap !== state) {
			await assertSettingsProfileIsolation(loaded.path, current)
			await saveSettings(loaded.path, current, loaded.revision)
			return { kind: 'current', message: 'Selected current contracts for the safely migratable zero-root bootstrap. Its journal will be preserved at startup.' }
		}
		if (!isPristineBootstrapState(state)) {
			if (state.profileId !== executionProfileId(active)) throw new Error(`Durable state belongs to profile ${state.profileId}; restore the old pin before changing deployments`)
		}
		const unboundUnoperated = state.profileId === executionProfileId(active) && state.uniswapV3Factory === undefined && !isPristineBootstrapState(state) && isUnoperatedSignerlessState(state)
		if (!unboundUnoperated && state.profileId === executionProfileId(active) && (state.uniswapV3Factory !== undefined || !isPristineBootstrapState(state))) assertDurableDeploymentFactory(active, state, active.runtime.stateFile)
		if (deploymentIsCurrent(active, current) && !unboundUnoperated) {
			if (loaded.needsDeploymentPin) await saveSettings(loaded.path, current, loaded.revision)
			return { kind: 'current', message: 'The saved deployment already matches the current contract manifest.' }
		}
		const nextStateFile = join(dirname(active.runtime.stateFile), `chaos.${randomUUID()}.json`)
		for (const candidate of [nextStateFile, `${nextStateFile}.protocol-index-v1`, `${nextStateFile}.immutable-topology-v1`]) {
			if (await fileExists(candidate)) throw new Error(`New deployment state path already exists: ${candidate}`)
		}
		const next: OperatorSettings = { ...current, runtime: { ...current.runtime, stateFile: nextStateFile } }
		await assertSettingsProfileIsolation(loaded.path, next)
		const id = await archiveDeployment(loaded.path, active)
		await saveSettings(loaded.path, next, loaded.revision)
		return { kind: 'current', message: `Selected latest contracts with new state file ${nextStateFile}. Old configuration and state preserved as archive ${id}. Run retirement.bat ${id} to retire it explicitly.` }
	} finally {
		await locks.release()
	}
}

export async function prepareArchivedRetirement(id: string, options: PreparationOptions = {}) {
	const current = await loadSettings(options.path)
	const loaded = await loadSettings(archivePath(current.path, id))
	await assertSettingsProfileIsolation(loaded.path, loaded.settings)
	if (resolve(loaded.settings.runtime.stateFile) === resolve(current.settings.runtime.stateFile)) throw new Error('Archived retirement must use a different state file from the current deployment')
	const locks = await (options.acquireLocks ?? acquireUpgradeLocks)(loaded.settings)
	try {
		const settings = loaded.settings
		const state = await loadDurableState(settings.runtime.stateFile, settings.network.chainId)
		if (state.profileId !== executionProfileId(settings)) throw new Error('Archived configuration does not match its durable deployment profile')
		const unboundUnoperated = state.uniswapV3Factory === undefined && isUnoperatedSignerlessState(state)
		if (!unboundUnoperated) assertDurableDeploymentFactory(settings, state, settings.runtime.stateFile)
		const wallet = configuredWallet(settings)
		if (wallet === undefined || !settings.runtime.execute || settings.paused || !settings.networkConfigured || settings.connectivity === undefined) throw new Error('Enable live execution with a configured signer and unpause the archived profile before requesting retirement')
		if (state.signerAddress !== undefined && wallet.toLowerCase() !== state.signerAddress.toLowerCase()) throw new Error('Restore the archived signer before requesting retirement')
		if (state.retirement.status === 'inactive') {
			if (state.signerAddress === undefined) {
				if (!isUnoperatedSignerlessState(state)) throw new Error('Archived journal contains work without a durable signer; restore its signer before retirement')
				state.signerAddress = wallet
				state.protocolIndex = undefined
			}
			assertSafeRetirementRecipient(wallet, state.signerAddress)
			if (unboundUnoperated) state.uniswapV3Factory = settings.deployment.uniswapV3Factory
			requestRetirement(state.retirement, state.profileId, wallet, DEFAULT_RETIREMENT_POLICIES, `DRAIN ${state.profileId} TO ${wallet}`, state.signerAddress ?? wallet)
			await saveDurableState(settings.runtime.stateFile, state)
		}
		return `Archived retirement is ${state.retirement.status}. Inspect the dashboard Retirement panel for progress and blockers.`
	} finally {
		await locks.release()
	}
}

export async function retirementUpgradeStatus(path?: string, verifyCompletion: typeof verifyRetirementCompletionFinality = verifyRetirementCompletionFinality): Promise<'ready' | 'retiring'> {
	const loaded = await loadSettings(path)
	const state = await loadDurableState(loaded.settings.runtime.stateFile, loaded.settings.network.chainId)
	const active = restoreDeploymentForDurableState(loaded.settings, state, loaded.needsDeploymentPin)
	if (state.retirement.status !== 'drained' && state.retirement.status !== 'drained-with-residuals') return 'retiring'
	const current: OperatorSettings = { ...active, deployment: canonicalDeployment(active.network.chainId) }
	const currentFactory = current.deployment.uniswapV3Factory
	if (currentFactory === undefined) throw new Error('Current deployment is missing its Uniswap V3 factory')
	const currentProfileId = executionProfileId(current)
	const replacementTargetId = retirementReplacementTargetId(currentProfileId, currentFactory)
	if (state.retirement.status === 'drained-with-residuals' && state.retirement.profileReplacementOverride?.targetProfileId !== replacementTargetId) return 'retiring'
	const wallet = configuredWallet(active)
	const evidence = state.retirement.completionEvidence
	if (evidence?.profileId !== state.profileId || evidence?.signerAddress === undefined || state.signerAddress === undefined || wallet === undefined || evidence.signerAddress.toLowerCase() !== state.signerAddress.toLowerCase() || evidence.signerAddress.toLowerCase() !== wallet.toLowerCase())
		throw new Error('Retirement completion evidence must match the archived deployment and signer')
	if (state.retirement.status === 'drained-with-residuals') {
		const override = state.retirement.profileReplacementOverride
		if (override === undefined || override.sourceProfileId !== state.profileId || override.recipient.toLowerCase() !== state.retirement.recipient?.toLowerCase() || override.completionBlockHash.toLowerCase() !== evidence.blockHash.toLowerCase() || override.completionBlockNumber !== evidence.blockNumber)
			throw new Error('Residual acceptance does not match the archived retirement evidence')
	}
	try {
		await verifyCompletion(active, { ...evidence, profileId: state.profileId, signerAddress: evidence.signerAddress })
	} catch (error) {
		if (error instanceof RetirementCompletionPendingError) return 'retiring'
		throw error
	}
	return 'ready'
}

async function main() {
	const command = process.argv[2]
	if (command === 'retire' && process.argv.length === 4) {
		const id = process.argv[3]
		if (id === undefined) throw new Error('Retirement requires an archive ID')
		console.log(await prepareArchivedRetirement(id))
		return
	}
	if (process.argv.length !== 3 || (command !== 'prepare' && command !== 'status' && command !== 'archives')) throw new Error('Usage: bun src/cli/deployment-upgrade.ts <prepare|status|archives|retire ARCHIVE_ID>')
	if (command === 'archives') {
		const archives = await listDeploymentArchives()
		if (archives.length === 0) console.log('No archived deployments. Run start.bat to select the latest contracts and archive an older deployment.')
		for (const archive of archives) console.log(`${archive.id}  ${archive.status}  ${archive.profileId}  ${archive.stateFile}`)
		return
	}
	if (command === 'status') {
		const status = await retirementUpgradeStatus()
		if (status === 'ready') console.log('Archived retirement is verified. The current deployment can restart.')
		else {
			const loaded = await loadSettings()
			const state = await loadDurableState(loaded.settings.runtime.stateFile, loaded.settings.network.chainId)
			if (state.retirement.status === 'drained-with-residuals') {
				const current = { ...loaded.settings, deployment: canonicalDeployment(loaded.settings.network.chainId) }
				const factory = current.deployment.uniswapV3Factory
				if (factory === undefined) throw new Error('Current deployment is missing its Uniswap V3 factory')
				const targetDeploymentId = retirementReplacementTargetId(executionProfileId(current), factory)
				if (state.retirement.profileReplacementOverride?.targetProfileId !== targetDeploymentId) console.log(`Retirement has residuals. Review them and accept replacement for ${targetDeploymentId} in the dashboard.`)
				else console.log('Old deployment retirement is waiting for its completion block to finalize.')
			} else if (state.retirement.status === 'drained') console.log('Old deployment retirement is waiting for its completion block to finalize.')
			else console.log(`Old deployment retirement is ${state.retirement.status}. Inspect the dashboard Retirement panel for blockers and progress.`)
		}
		if (status === 'retiring') process.exitCode = RETIRING_EXIT_CODE
		return
	}
	const result = await prepareCurrentDeployment()
	console.log(result.message)
}

if (import.meta.main) {
	main().catch(error => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}
