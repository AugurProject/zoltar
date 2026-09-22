import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSettings, saveSettings } from '../../src/config/settings-store.ts'
import { createConfigurationMutationGate } from '../../src/core/configuration-gate.ts'
import { privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { acquireBotProcessLocks } from '@zoltar/bot-shared/execution/bot-process-locks'
import example from '../../config/operator.example.json'
import { parseSettings, type OperatorSettings } from '../../src/config/settings.ts'
import { createGoLiveControls, PENDING_INTENT_MODE_CHANGE } from '../../src/core/go-live-controls.ts'
import { initialRuntimeState, type PendingTransactionIntent } from '../../src/state/operator-state.ts'

const keyA = `0x${'11'.repeat(32)}` as const
const keyB = `0x${'22'.repeat(32)}` as const

const sender = '0x1111111111111111111111111111111111111111' as const

function pendingIntent(mode: 'private' | 'public'): PendingTransactionIntent {
	return {
		hash: `0x${'ab'.repeat(32)}`,
		kind: 'deposit',
		label: 'Deposit REP',
		maxBlockNumber: 120n,
		mode,
		nonce: 7n,
		receiptExpectation: { type: 'transaction' },
		requiresMarketEvidence: false,
		sender,
		serializedTransaction: `0x${'02'.repeat(40)}`,
		submissionBlock: 100n,
	}
}

function controls(settings: OperatorSettings, pending: PendingTransactionIntent[], failure?: 'lock' | 'persist') {
	const state = initialRuntimeState(settings.paused, undefined, settings.network.chainId)
	state.pendingTransactions = pending
	let current = settings
	let active = settings.privateKey
	const events: string[] = []
	const locks = {
		acquireSigner: async () => {
			events.push('acquire')
			if (failure === 'lock') throw new Error('lock busy')
			return undefined
		},
		commitSigner: async () => {
			events.push('commit')
		},
		disableExecution: async () => undefined,
		discardSigner: async () => {
			events.push('discard')
		},
		enableExecution: async () => undefined,
	}
	const gate = createConfigurationMutationGate(() => false)
	const controller = createGoLiveControls({
		activePrivateKey: () => active,
		applySigner: key => {
			events.push('activate')
			active = key
		},
		locks,
		persist: async update => {
			events.push('persist')
			if (failure === 'persist') throw new Error('disk full')
			current = update(current)
			return current
		},
		runMutation: mutation => gate.run(mutation),
		settings: () => current,
		state,
	})
	return { active: () => active, controller, events, settings: () => current, state }
}

describe('liquidator go-live controls', () => {
	const settings = parseSettings({ ...example, connectivity: { publicRpcUrls: ['https://public.example'], quorumRpcUrls: [], readRpcUrl: 'https://read.example', rpcQuorum: 1 }, network: { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' }, networkConfigured: true })

	for (const paused of [false, true]) {
		test(`rejects a conflicting live memory-only replacement before side effects (paused=${paused})`, async () => {
			const live = { ...settings, paused, privateKey: keyA, runtime: { ...settings.runtime, execute: true } }
			const fixture = controls(live, [])
			await expect(fixture.controller.setSigner({ privateKey: keyB, rememberSigner: false })).rejects.toThrow('saved key differs')
			expect(fixture.events).toEqual([])
			expect(fixture.active()).toBe(keyA)
			expect(fixture.settings()).toBe(live)
			expect(fixture.state.paused).toBe(paused)
		})
	}

	test('already-live saves reject an inconsistent active signer', async () => {
		const fixture = controls({ ...settings, privateKey: keyA }, [])
		await fixture.controller.setSigner({ privateKey: keyB, rememberSigner: false })
		fixture.settings().runtime = { ...fixture.settings().runtime, execute: true }
		fixture.events.length = 0
		await expect(fixture.controller.setExecution({ execute: true })).rejects.toThrow('saved key differs')
		expect(fixture.events).toEqual([])
	})

	for (const rememberSigner of [false, true]) {
		test(`preserves recovery identity for pending transactions (remember=${rememberSigner})`, async () => {
			const pending = [pendingIntent('public')]
			const fixture = controls({ ...settings, privateKey: keyA }, pending)
			await expect(fixture.controller.setSigner({ privateKey: keyB, rememberSigner })).rejects.toThrow('recovery')
			expect(fixture.events).toEqual([])
			expect(fixture.state.pendingTransactions).toBe(pending)
			await fixture.controller.setSigner({ privateKey: keyA, rememberSigner })
			expect(fixture.active()).toBe(keyA)
		})
	}

	test('permits same-key, remembered, and no-saved-key live updates', async () => {
		for (const [saved, candidate, rememberSigner] of [
			[keyA, keyA, false],
			[keyA, keyB, true],
			[undefined, keyB, false],
		] as const) {
			const fixture = controls({ ...settings, privateKey: saved, runtime: { ...settings.runtime, execute: true } }, [])
			await fixture.controller.setSigner({ privateKey: candidate, rememberSigner })
			expect(fixture.active()).toBe(candidate)
			expect(fixture.settings().privateKey).toBe(rememberSigner ? candidate : saved)
			expect(fixture.events).toEqual(rememberSigner ? ['acquire', 'persist', 'activate', 'commit'] : ['acquire', 'activate', 'commit'])
		}
	})

	for (const failure of ['lock', 'persist'] as const) {
		test(`keeps the original signer when ${failure} fails`, async () => {
			const fixture = controls({ ...settings, privateKey: keyA, runtime: { ...settings.runtime, execute: true } }, [], failure)
			await expect(fixture.controller.setSigner({ privateKey: keyB, rememberSigner: true })).rejects.toThrow(failure === 'lock' ? 'lock busy' : 'disk full')
			expect(fixture.active()).toBe(keyA)
			expect(fixture.settings().privateKey).toBe(keyA)
			expect(fixture.events).toEqual(failure === 'lock' ? ['acquire'] : ['acquire', 'persist', 'discard'])
		})
	}

	test('resume checks live identity before persistence and stays paused on failure', async () => {
		const fixture = controls({ ...settings, privateKey: keyA }, [])
		await fixture.controller.setSigner({ privateKey: keyB, rememberSigner: false })
		fixture.settings().runtime = { ...fixture.settings().runtime, execute: true }
		fixture.events.length = 0
		await expect(fixture.controller.setPaused({ paused: false })).rejects.toThrow('saved key differs')
		expect(fixture.events).toEqual([])
		expect(fixture.state.paused).toBe(true)
		await fixture.controller.setExecution({ execute: false })
		await fixture.controller.setSigner({ privateKey: '', rememberSigner: true })
		await fixture.controller.setSigner({ privateKey: keyB, rememberSigner: false })
		await fixture.controller.setExecution({ execute: true })
		await fixture.controller.setPaused({ paused: false })
		expect(fixture.state.paused).toBe(false)
		expect(fixture.settings().privateKey).toBeUndefined()
	})

	test('retains staged recovery and blocks clearing or replacing its signer', async () => {
		const fixture = controls({ ...settings, privateKey: keyA }, [])
		const operations = [{ coordinator: sender, operationId: 1n, queuedBlock: 2n, target: sender }]
		fixture.state.pendingStagedOperations = operations
		for (const privateKey of ['', keyB]) {
			await expect(fixture.controller.setSigner({ privateKey, rememberSigner: true })).rejects.toThrow('recovery')
		}
		expect(fixture.events).toEqual([])
		expect(fixture.state.pendingStagedOperations).toBe(operations)
	})

	test('cannot clear a live signer and does not expose keys in rejection messages', async () => {
		const fixture = controls({ ...settings, privateKey: keyA, runtime: { ...settings.runtime, execute: true } }, [])
		await expect(fixture.controller.setSigner({ privateKey: '', rememberSigner: true })).rejects.toThrow('active signer')
		try {
			await fixture.controller.setSigner({ privateKey: keyB, rememberSigner: false })
		} catch (error) {
			expect(String(error)).not.toContain(keyA)
			expect(String(error)).not.toContain(keyB)
		}
		expect(fixture.events).toEqual([])
	})

	test('failed resume persistence leaves the operator paused', async () => {
		const fixture = controls({ ...settings, privateKey: keyA, runtime: { ...settings.runtime, execute: true } }, [], 'persist')
		await expect(fixture.controller.setPaused({ paused: false })).rejects.toThrow('disk full')
		expect(fixture.state.paused).toBe(true)
	})

	test('rejected replacement preserves the live restart identity and exclusive signer reservation', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'liquidator-signer-'))
		const path = join(directory, 'operator.json')
		const current = { ...settings, paused: false, privateKey: keyA, runtime: { ...settings.runtime, execute: true } }
		const lockSettings = { chainId: settings.network.chainId, execute: true, privateKey: keyA, signerLockRoot: directory, stateFile: join(directory, 'state.json') }
		const locks = await acquireBotProcessLocks(lockSettings, { label: 'test liquidator', signerLocksInDryRun: false })
		try {
			await saveSettings(path, current)
			const state = initialRuntimeState(false, undefined, current.network.chainId)
			const controller = createGoLiveControls({
				activePrivateKey: () => keyA,
				applySigner: () => {
					throw new Error('Rejected replacement must not activate')
				},
				locks,
				persist: async update => {
					const next = update(current)
					await saveSettings(path, next)
					throw new Error('Rejected replacement must not persist')
				},
				runMutation: mutation => mutation(),
				settings: () => current,
				state,
			})
			await expect(controller.setSigner({ privateKey: keyB, rememberSigner: false })).rejects.toThrow('saved key differs')
			const restarted = await loadSettings(path)
			expect(restarted.settings.privateKey).toBe(keyA)
			expect(restarted.settings.runtime.execute).toBe(true)
			expect(restarted.settings.paused).toBe(false)
			await expect(acquireBotProcessLocks({ ...lockSettings, stateFile: join(directory, 'other.json') }, { label: 'contender', signerLocksInDryRun: false })).rejects.toThrow()
			const candidateLocks = await acquireBotProcessLocks({ ...lockSettings, privateKey: keyB, stateFile: join(directory, 'candidate.json') }, { label: 'candidate', signerLocksInDryRun: false })
			await candidateLocks.release()
		} finally {
			await locks.release()
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('serializes replacement before arming and checks the resulting active identity', async () => {
		const fixture = controls({ ...settings, privateKey: keyA }, [])
		const replacement = fixture.controller.setSigner({ privateKey: keyB, rememberSigner: false })
		const arm = fixture.controller.setExecution({ execute: true })
		await replacement
		await expect(arm).rejects.toThrow('saved key differs')
		expect(fixture.active()).toBe(keyB)
		expect(fixture.settings().runtime.execute).toBe(false)
		expect(fixture.events).toEqual(['acquire', 'activate', 'commit'])
	})

	test('restores a memory-only recovery signer after restart without accepting a different pending sender', async () => {
		const pending = [{ ...pendingIntent('public'), sender: privateKeyToAccount(keyB).address }]
		const fixture = controls({ ...settings, privateKey: undefined }, pending)
		await expect(fixture.controller.setSigner({ privateKey: keyA, rememberSigner: false })).rejects.toThrow('recovery')
		expect(fixture.events).toEqual([])
		await fixture.controller.setSigner({ privateKey: keyB, rememberSigner: false })
		expect(fixture.active()).toBe(keyB)
		expect(fixture.settings().privateKey).toBeUndefined()
		expect(fixture.state.pendingTransactions).toBe(pending)
	})

	test('restores a missing signer for read-only staged-outcome recovery', async () => {
		const fixture = controls({ ...settings, privateKey: undefined }, [])
		const operations = [{ coordinator: sender, operationId: 1n, queuedBlock: 2n, target: sender }]
		fixture.state.pendingStagedOperations = operations
		await fixture.controller.setSigner({ privateKey: keyB, rememberSigner: false })
		expect(fixture.active()).toBe(keyB)
		expect(fixture.state.pendingStagedOperations).toBe(operations)
	})

	test('keeps the delivery mode of a pending intent until recovery resolves it', async () => {
		const { controller, settings: current } = controls(settings, [pendingIntent('public')])
		// Recovery would resubmit the public intent through the new mode, so the switch waits for the intent to settle.
		await expect(controller.setSubmission({ minimumBundleRelaySuccesses: 1, mode: 'private', relayUrls: ['https://relay.flashbots.net'] })).rejects.toThrow(PENDING_INTENT_MODE_CHANGE)
		expect(current().submission.mode).toBe('public')
		// Same-mode edits stay possible while the intent is pending.
		await controller.setSubmission({ minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] })
		expect(current().submission.mode).toBe('public')
	})

	test('changes the delivery mode once no intent depends on the previous one', async () => {
		const { controller, settings: current, state } = controls({ ...settings, submission: { minimumBundleRelaySuccesses: 1, mode: 'private', relayUrls: ['https://relay.flashbots.net'] } }, [pendingIntent('private')])
		await expect(controller.setSubmission({ minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] })).rejects.toThrow(PENDING_INTENT_MODE_CHANGE)
		state.pendingTransactions = []
		await controller.setSubmission({ minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] })
		expect(current().submission.mode).toBe('public')
		expect(state.activities[0]?.message).toBe('Transaction delivery settings saved')
	})
})
