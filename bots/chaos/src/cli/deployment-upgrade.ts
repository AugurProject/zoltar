#!/usr/bin/env bun

import { getAddress, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { acquireBotProcessLocks } from '@zoltar/bot-shared/execution/bot-process-locks'
import { createInterface } from 'node:readline/promises'
import { lstat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { canonicalDeployment } from '../config/canonical-deployment.ts'
import { assertDurableDeploymentFactory, restoreDeploymentForDurableState } from '../config/deployment-state.ts'
import { executionProfileId } from '../config/execution-profile.ts'
import { assertSettingsProfileIsolation, loadSettings, saveSettings, type OperatorSettings } from '../config/settings.ts'
import { CHAOS_PROCESS_LOCK_OPTIONS } from '../core/process-lock-options.ts'
import { chaosReadEndpoints } from '../runtime/canonical-scan.ts'
import { resetPristineStateForDeploymentProfile, verifyRetirementCompletionFinality } from '../runtime/deployment-profile.ts'
import { initialRuntimeState } from '../state/initial-state.ts'
import { loadDurableState, saveDurableState } from '../state/operator-state.ts'
import { isPristineBootstrapState } from '../state/pristine.ts'
import { assertSafeRetirementRecipient, DEFAULT_RETIREMENT_POLICIES, requestRetirement } from '../state/retirement.ts'

type PreparationOptions = {
	acquireLocks?: (settings: OperatorSettings) => Promise<{ release: () => Promise<void> }>
	ask?: (message: string) => Promise<string>
	path?: string
	verifyCompletion?: typeof verifyRetirementCompletionFinality
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

async function askTerminal(message: string) {
	const input = createInterface({ input: process.stdin, output: process.stdout })
	try {
		return await input.question(message)
	} finally {
		input.close()
	}
}

function configuredWallet(settings: OperatorSettings) {
	return settings.privateKey === undefined ? undefined : privateKeyToAccount(settings.privateKey).address
}

function deploymentIsCurrent(settings: OperatorSettings, current: OperatorSettings) {
	return executionProfileId(settings) === executionProfileId(current) && settings.deployment.uniswapV3Factory?.toLowerCase() === current.deployment.uniswapV3Factory?.toLowerCase()
}

function replacementStatePath(previous: string, profileId: string) {
	return join(dirname(previous), `chaos.${profileId.replaceAll(':', '-')}.json`)
}

async function assertUnusedStatePath(path: string) {
	for (const candidate of [path, `${path}.protocol-index-v1`, `${path}.immutable-topology-v1`]) {
		try {
			await lstat(candidate)
		} catch (error) {
			if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') continue
			throw error
		}
		throw new Error(`Current deployment needs a new state file, but ${candidate} already exists; review it before retrying`)
	}
}

function isUnoperatedKeylessState(settings: OperatorSettings, state: Awaited<ReturnType<typeof loadDurableState>>) {
	return (
		settings.privateKey === undefined &&
		state.signerAddress === undefined &&
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

async function saveCurrentWithNewState(loaded: Awaited<ReturnType<typeof loadSettings>>, current: OperatorSettings, currentProfileId: string) {
	const nextStateFile = replacementStatePath(loaded.settings.runtime.stateFile, currentProfileId)
	if (resolve(nextStateFile) === resolve(loaded.settings.runtime.stateFile)) throw new Error('Current deployment must use a separate state file')
	await assertUnusedStatePath(nextStateFile)
	const next: OperatorSettings = { ...current, runtime: { ...current.runtime, stateFile: nextStateFile } }
	await assertSettingsProfileIsolation(loaded.path, next)
	await saveSettings(loaded.path, next, loaded.revision)
	return nextStateFile
}

async function requestOldProfileRetirement(settings: OperatorSettings, state: Awaited<ReturnType<typeof loadDurableState>>, ask: (message: string) => Promise<string>) {
	if (!settings.runtime.execute || settings.paused || settings.privateKey === undefined || !settings.networkConfigured || settings.connectivity === undefined) {
		throw new Error('Enable live execution with a configured signer and unpause the old profile before requesting automatic retirement')
	}
	if (new Set(chaosReadEndpoints(settings).map(rpcUrl => new URL(rpcUrl).origin)).size < 2) throw new Error('Retirement completion requires at least two independent RPC readers')
	const recipient = getAddress((await ask('Updated contracts found. Enter the retirement recipient for recovered assets: ')).trim())
	const wallet = configuredWallet(settings)
	assertSafeRetirementRecipient(recipient, state.signerAddress ?? wallet)
	const confirmation = `DRAIN ${state.profileId} TO ${recipient}`
	requestRetirement(state.retirement, state.profileId, recipient, DEFAULT_RETIREMENT_POLICIES, await ask(`Type ${confirmation} to retire the old deployment: `), state.signerAddress ?? wallet)
	await saveDurableState(settings.runtime.stateFile, state)
}

export async function prepareCurrentDeployment(options: PreparationOptions = {}): Promise<{ kind: 'current' | 'retiring'; message: string }> {
	const loaded = await loadSettings(options.path)
	await assertSettingsProfileIsolation(loaded.path, loaded.settings)
	const locks = await (options.acquireLocks ?? acquireUpgradeLocks)(loaded.settings)
	try {
		const state = await loadDurableState(loaded.settings.runtime.stateFile, loaded.settings.network.chainId)
		const active = restoreDeploymentForDurableState(loaded.settings, state, loaded.needsDeploymentPin)
		const current: OperatorSettings = { ...active, deployment: canonicalDeployment(active.network.chainId) }
		const activeProfileId = executionProfileId(active)
		const currentProfileId = executionProfileId(current)
		const pristine = isPristineBootstrapState(state)
		const wallet = configuredWallet(active)
		if (wallet !== undefined && state.signerAddress !== undefined && wallet.toLowerCase() !== state.signerAddress.toLowerCase()) {
			throw new Error(`Durable state is scoped to signer ${state.signerAddress}; restore the old signer before retirement`)
		}
		if (state.profileId === activeProfileId && (state.uniswapV3Factory !== undefined || !pristine)) assertDurableDeploymentFactory(active, state, active.runtime.stateFile)
		else if (!pristine) throw new Error(`Durable state belongs to profile ${state.profileId}, but the saved configuration selects ${activeProfileId}; restore the old pin before retirement`)

		if (deploymentIsCurrent(active, current)) {
			if (loaded.needsDeploymentPin) await saveSettings(loaded.path, current, loaded.revision)
			return { kind: 'current', message: 'The saved deployment already matches the current contract manifest.' }
		}

		if (pristine) {
			await assertSettingsProfileIsolation(loaded.path, current)
			await saveSettings(loaded.path, current, loaded.revision)
			return { kind: 'current', message: 'Selected current contract addresses; the unused state will adopt them at startup.' }
		}
		if (isUnoperatedKeylessState(active, state)) {
			const nextStateFile = await saveCurrentWithNewState(loaded, current, currentProfileId)
			return { kind: 'current', message: `Selected current contracts in new state file ${nextStateFile}. The old keyless journal was preserved.` }
		}
		if (activeProfileId === currentProfileId) throw new Error('A factory-only deployment change with operated state needs manual review and a distinct state file')

		if (state.retirement.status === 'inactive') {
			await requestOldProfileRetirement(active, state, options.ask ?? askTerminal)
			return { kind: 'retiring', message: 'Retirement requested for the old deployment. Its pin and state remain in place until completion.' }
		}

		if (state.retirement.status !== 'drained' && state.retirement.status !== 'drained-with-residuals') {
			return { kind: 'retiring', message: `Old deployment retirement is ${state.retirement.status}. Its pin and state remain in place.` }
		}
		if (state.retirement.status === 'drained-with-residuals' && state.retirement.profileReplacementOverride?.targetProfileId !== currentProfileId) {
			return { kind: 'retiring', message: `Retirement has residuals. Review them and accept replacement for ${currentProfileId} in the dashboard before switching.` }
		}

		const checked = initialRuntimeState(active.paused, wallet, active.network.chainId, structuredClone(state))
		await resetPristineStateForDeploymentProfile(checked, currentProfileId, current.deployment.uniswapV3Factory, current.paused, wallet, active.runtime.stateFile, async evidence => (options.verifyCompletion ?? verifyRetirementCompletionFinality)(current, evidence))
		const nextStateFile = await saveCurrentWithNewState(loaded, current, currentProfileId)
		return { kind: 'current', message: `Verified retirement and selected current contracts in new state file ${nextStateFile}. The old state was preserved.` }
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
	if (state.retirement.status === 'drained-with-residuals' && state.retirement.profileReplacementOverride?.targetProfileId !== executionProfileId(current)) return 'retiring'
	const wallet = configuredWallet(active)
	const checked = initialRuntimeState(active.paused, wallet, active.network.chainId, structuredClone(state))
	await resetPristineStateForDeploymentProfile(checked, executionProfileId(current), current.deployment.uniswapV3Factory, current.paused, wallet, active.runtime.stateFile, async evidence => verifyCompletion(current, evidence))
	return 'ready'
}

async function main() {
	const command = process.argv[2]
	if (process.argv.length !== 3 || (command !== 'prepare' && command !== 'status')) throw new Error('Usage: bun src/cli/deployment-upgrade.ts <prepare|status>')
	if (command === 'status') {
		const status = await retirementUpgradeStatus()
		if (status === 'ready') console.log('Old deployment retirement is ready for final verification and switch.')
		else {
			const loaded = await loadSettings()
			const state = await loadDurableState(loaded.settings.runtime.stateFile, loaded.settings.network.chainId)
			if (state.retirement.status === 'drained-with-residuals') {
				const targetProfileId = executionProfileId({ ...loaded.settings, deployment: canonicalDeployment(loaded.settings.network.chainId) })
				console.log(`Retirement has residuals. Review them and accept replacement for ${targetProfileId} in the dashboard.`)
			} else console.log(`Old deployment retirement is ${state.retirement.status}. Inspect the dashboard Retirement panel for blockers and progress.`)
		}
		if (status === 'retiring') process.exitCode = RETIRING_EXIT_CODE
		return
	}
	const result = await prepareCurrentDeployment()
	console.log(result.message)
	if (result.kind === 'retiring') process.exitCode = RETIRING_EXIT_CODE
}

if (import.meta.main) {
	main().catch(error => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}
