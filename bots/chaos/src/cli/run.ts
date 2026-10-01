#!/usr/bin/env bun
import { assertDurableDeploymentFactory, assertDurableStateFactories } from '../config/deployment-state.ts'

import { getAddress, privateKeyToAccount, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { createBotShutdownController, runBotMain, withBotProcessLocks } from '@zoltar/bot-shared/execution/bot-process-locks'
import { assertSettingsProfileIsolation, loadSettings, saveSettings } from '../config/settings.ts'
import { CHAOS_PROCESS_LOCK_OPTIONS } from '../core/process-lock-options.ts'
import { restartSafeSettings } from '../runtime/configuration-candidates.ts'
import { executionProfileId, runChaosOperator, type LoadedConfiguration } from '../runtime/operator.ts'
import { loadDurableState, saveDurableState } from '../state/operator-state.ts'
import { acceptResidualProfileReplacement, assertSafeRetirementRecipient, cancelRetirement, DEFAULT_RETIREMENT_POLICIES, registerV3Position, requestRetirement } from '../state/retirement.ts'

type RunCommand =
	| { kind: 'operator' }
	| { confirmation: string; exitAfterCompletion: boolean; exitUnmatchedShares: boolean; kind: 'request-drain'; maximumExitLossBps: number; migrateExistingClaims: boolean; recipient: string }
	| { confirmation: string; kind: 'cancel-drain' }
	| { confirmation: string; kind: 'accept-residuals'; reason: string; targetProfileId: string }
	| { kind: 'retirement-status' }
	| { confirmation: string; json: string; kind: 'register-v3-position' }

export function parseRunCommand(args: readonly string[]): RunCommand {
	if (args.length === 0) return { kind: 'operator' }
	if (args.length === 1 && args[0] === '--retirement-status') return { kind: 'retirement-status' }
	const confirmationIndex = args.indexOf('--confirm')
	const confirmation = confirmationIndex === -1 ? undefined : args[confirmationIndex + 1]
	if (confirmation === undefined) throw new Error('Retirement mutations require --confirm followed by the exact confirmation text')
	if (args[0] === '--cancel-drain') return { confirmation, kind: 'cancel-drain' }
	if (args[0] === '--accept-residuals') {
		const targetProfileId = args[1]
		const reasonIndex = args.indexOf('--reason')
		const reason = reasonIndex === -1 ? undefined : args[reasonIndex + 1]
		if (targetProfileId === undefined || reason === undefined) throw new Error('--accept-residuals requires a target profile followed by --reason and the operator rationale')
		return { confirmation, kind: 'accept-residuals', reason, targetProfileId }
	}
	if (args[0] === '--register-v3-position') {
		const json = args[1]
		if (json === undefined) throw new Error('--register-v3-position requires a JSON position record')
		return { confirmation, json, kind: 'register-v3-position' }
	}
	if (args[0] !== '--drain' || args[1] === undefined) throw new Error('Supported commands are --drain, --cancel-drain, --accept-residuals, --register-v3-position, and --retirement-status')
	const lossArgument = args.find(argument => argument.startsWith('--exit-unmatched-shares='))
	const maximumExitLossBps = lossArgument === undefined ? 0 : Number(lossArgument.slice('--exit-unmatched-shares='.length))
	if (!Number.isSafeInteger(maximumExitLossBps) || maximumExitLossBps < 0 || maximumExitLossBps > 10_000) throw new Error('Unmatched-share loss must be an integer from 0 through 10000 bps')
	const recipient = getAddress(args[1])
	if (recipient.toLowerCase() === zeroAddress) throw new Error('Retirement recipient must not be the zero address')
	return {
		confirmation,
		exitAfterCompletion: args.includes('--exit-after-completion'),
		exitUnmatchedShares: lossArgument !== undefined,
		kind: 'request-drain',
		maximumExitLossBps,
		migrateExistingClaims: args.includes('--migrate-existing-claims'),
		recipient,
	}
}

async function applyRetirementCommand(command: Exclude<RunCommand, { kind: 'operator' }>, loaded: Pick<LoadedConfiguration, 'path' | 'revision' | 'settings'>) {
	const state = await loadDurableState(loaded.settings.runtime.stateFile, loaded.settings.network.chainId)
	if (command.kind === 'retirement-status') {
		console.log(JSON.stringify(state.retirement, undefined, 2))
		return
	}
	assertDurableStateFactories(loaded.settings, state)
	const profileId = executionProfileId(loaded.settings)
	if (state.profileId !== profileId) throw new Error(`Durable state belongs to ${state.profileId}, not configured profile ${profileId}`)
	assertDurableDeploymentFactory(loaded.settings, state, loaded.settings.runtime.stateFile)
	if (command.kind === 'request-drain') {
		const recipient = getAddress(command.recipient)
		const configuredSigner = loaded.settings.privateKey === undefined ? undefined : privateKeyToAccount(loaded.settings.privateKey).address
		assertSafeRetirementRecipient(recipient, configuredSigner)
		requestRetirement(
			state.retirement,
			profileId,
			recipient,
			{ ...DEFAULT_RETIREMENT_POLICIES, exitAfterCompletion: command.exitAfterCompletion, exitUnmatchedShares: command.exitUnmatchedShares, maximumExitLossBps: command.maximumExitLossBps, migrateExistingClaims: command.migrateExistingClaims },
			command.confirmation,
			state.signerAddress,
		)
	} else if (command.kind === 'cancel-drain') {
		cancelRetirement(state.retirement, command.confirmation)
	} else if (command.kind === 'accept-residuals') {
		acceptResidualProfileReplacement(state.retirement, state.profileId, command.targetProfileId, command.reason, command.confirmation)
	} else {
		const input = JSON.parse(command.json) as Record<string, unknown>
		if (command.confirmation !== `REGISTER V3 ${profileId}`) throw new Error(`Confirmation must exactly match REGISTER V3 ${profileId}`)
		const owner = getAddress(String(input['owner']))
		if (state.signerAddress === undefined || owner.toLowerCase() !== state.signerAddress.toLowerCase()) throw new Error('Registered V3 owner must be the durable signer')
		const integer = (key: string) => {
			const value = input[key]
			if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${key} must be an integer`)
			return value
		}
		registerV3Position(state.retirement, {
			creationWorkflowId: String(input['workflowId']),
			fee: integer('fee'),
			owner,
			pool: getAddress(String(input['pool'])),
			profileId,
			tickLower: integer('tickLower'),
			tickUpper: integer('tickUpper'),
			token0: getAddress(String(input['token0'])),
			token1: getAddress(String(input['token1'])),
		})
	}
	await saveDurableState(loaded.settings.runtime.stateFile, state)
}

export async function main() {
	const command = parseRunCommand(process.argv.slice(2))
	using shutdown = createBotShutdownController()
	let loaded: LoadedConfiguration = await loadSettings()
	do {
		await assertSettingsProfileIsolation(loaded.path, loaded.settings)
		const restart = await withBotProcessLocks(
			{
				chainId: loaded.settings.network.chainId,
				execute: loaded.settings.runtime.execute,
				privateKey: loaded.settings.privateKey,
				stateFile: loaded.settings.runtime.stateFile,
			},
			{ ...CHAOS_PROCESS_LOCK_OPTIONS, allowSignerConflict: command.kind === 'operator' && loaded.settings.runtime.ui },
			shutdown,
			async locks => {
				if (command.kind !== 'operator') {
					await applyRetirementCommand(command, loaded)
					return
				}
				if (locks.startupSignerConflict !== undefined) {
					loaded.settings = { ...loaded.settings, paused: true, runtime: { ...loaded.settings.runtime, execute: false } }
					loaded.revision = await saveSettings(loaded.path, restartSafeSettings(loaded.settings, loaded.rememberSigner ?? loaded.settings.privateKey !== undefined), loaded.revision)
					console.error(locks.startupSignerConflict)
				}
				return await runChaosOperator(loaded, locks, shutdown)
			},
		)
		if (restart === undefined) break
		loaded = restart
	} while (!shutdown.isRequested())
}

if (import.meta.main) runBotMain(main)
