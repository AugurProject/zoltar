#!/usr/bin/env bun

import { getAddress } from '@zoltar/bot-shared/ethereum'
import { assertSettingsProfileIsolation, loadSettings } from '../config/settings.ts'
import { acquireChaosProcessLocksForShutdown, ChaosProcessLockAcquisitionError, createChaosShutdownController, type ChaosProcessLocks } from '../core/process-locks.ts'
import { executionProfileId, runChaosOperator } from '../runtime/operator.ts'
import { loadDurableState, saveDurableState } from '../state/operator-state.ts'
import { acceptResidualProfileReplacement, cancelRetirement, DEFAULT_RETIREMENT_POLICIES, registerV3Position, requestRetirement } from '../state/retirement.ts'

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

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
	return {
		confirmation,
		exitAfterCompletion: args.includes('--exit-after-completion'),
		exitUnmatchedShares: lossArgument !== undefined,
		kind: 'request-drain',
		maximumExitLossBps,
		migrateExistingClaims: args.includes('--migrate-existing-claims'),
		recipient: args[1],
	}
}

async function applyRetirementCommand(command: Exclude<RunCommand, { kind: 'operator' }>, loaded: Awaited<ReturnType<typeof loadSettings>>) {
	const state = await loadDurableState(loaded.settings.runtime.stateFile, loaded.settings.network.chainId)
	if (command.kind === 'retirement-status') {
		console.log(JSON.stringify(state.retirement, undefined, 2))
		return
	}
	const profileId = executionProfileId(loaded.settings)
	if (state.profileId !== profileId) throw new Error(`Durable state belongs to ${state.profileId}, not configured profile ${profileId}`)
	if (command.kind === 'request-drain') {
		requestRetirement(
			state.retirement,
			profileId,
			getAddress(command.recipient),
			{ ...DEFAULT_RETIREMENT_POLICIES, exitAfterCompletion: command.exitAfterCompletion, exitUnmatchedShares: command.exitUnmatchedShares, maximumExitLossBps: command.maximumExitLossBps, migrateExistingClaims: command.migrateExistingClaims },
			command.confirmation,
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
	using shutdown = createChaosShutdownController()
	const loaded = await loadSettings()
	await assertSettingsProfileIsolation(loaded.path, loaded.settings)
	let locks: ChaosProcessLocks
	try {
		const acquired = await acquireChaosProcessLocksForShutdown(
			{
				chainId: loaded.settings.network.chainId,
				execute: loaded.settings.runtime.execute,
				privateKey: loaded.settings.privateKey,
				signerLockRoot: process.env['ZOLTAR_BOT_SIGNER_LOCK_ROOT'],
				stateFile: loaded.settings.runtime.stateFile,
			},
			shutdown,
		)
		if (acquired === undefined) return
		locks = acquired
	} catch (error) {
		if (error instanceof ChaosProcessLockAcquisitionError) {
			await error.releaseProcessLocks()
			throw error.acquisitionCause
		}
		throw error
	}
	try {
		if (command.kind !== 'operator') {
			await applyRetirementCommand(command, loaded)
			return
		}
		await runChaosOperator(loaded, locks, shutdown)
	} finally {
		await locks.release()
	}
}

if (import.meta.main) {
	main().catch(error => {
		console.error(errorMessage(error))
		process.exitCode = 1
	})
}
