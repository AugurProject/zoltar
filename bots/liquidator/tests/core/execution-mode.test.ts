import { describe, expect, test } from 'bun:test'
import { privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { parseSettings, type OperatorSettings } from '../../src/config/settings.ts'
import { applyExecutionMode, parseExecutionRequest } from '../../src/core/execution-mode.ts'
import example from '../../config/operator.example.json'

const privateKey = `0x${'11'.repeat(32)}` as const
const signer = privateKeyToAccount(privateKey).address

function configured(overrides: Partial<OperatorSettings> = {}): OperatorSettings {
	const parsed = parseSettings({
		...example,
		connectivity: { publicRpcUrls: ['https://public.example'], quorumRpcUrls: [], readRpcUrl: 'https://read.example', rpcQuorum: 1 },
		network: { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' },
		networkConfigured: true,
	})
	return { ...parsed, ...overrides }
}

function fakeLocks() {
	const events: string[] = []
	return {
		events,
		locks: {
			disableExecution: async () => {
				events.push('disable')
			},
			enableExecution: async (address: string) => {
				events.push(`enable:${address}`)
			},
		},
	}
}

describe('liquidator execution mode', () => {
	test('accepts only an exact execute switch', () => {
		expect(parseExecutionRequest({ execute: true })).toBe(true)
		for (const value of [undefined, null, [], {}, { execute: 'true' }, { execute: true, paused: true }]) expect(() => parseExecutionRequest(value)).toThrow('Execution mode updates require execute')
	})

	test('names the prerequisite the operator file would reject at startup before touching the signer reservation', async () => {
		const arm = (settings: OperatorSettings, activePrivateKey: typeof privateKey | undefined) => {
			const { events, locks } = fakeLocks()
			return { events, outcome: applyExecutionMode(true, { activePrivateKey, locks, pause: () => undefined, persist: async update => update(settings), settings }) }
		}
		await expect(arm(configured({ networkConfigured: false }), privateKey).outcome).rejects.toThrow('Configure the chain and RPC endpoints before enabling live execution')
		await expect(arm(configured(), undefined).outcome).rejects.toThrow('Live execution requires an active signer')
		const quorum = configured()
		const shortQuorum = arm({ ...quorum, connectivity: { ...quorum.connectivity, rpcQuorum: 2 } }, privateKey)
		await expect(shortQuorum.outcome).rejects.toThrow('Live execution with RPC quorum 2 requires at least two independent quorum RPCs')
		expect(shortQuorum.events).toEqual([])
		// A saved key that is not the active signer would go live on restart, so arming a memory-only signer beside it is refused.
		const savedOther = arm(configured({ privateKey: `0x${'22'.repeat(32)}` }), privateKey)
		await expect(savedOther.outcome).rejects.toThrow('The saved key differs from the active signer; return to dry run and save or remove the conflicting saved key before rearming live execution')
		expect(savedOther.events).toEqual([])
		const savedSame = arm(configured({ privateKey }), privateKey)
		await expect(savedSame.outcome).resolves.toEqual({ address: signer, changed: true })
	})

	test('arms live execution by reserving the signer before the paused live file is written', async () => {
		let settings = configured()
		let paused = false
		const { events, locks } = fakeLocks()
		const persist = async (update: (current: OperatorSettings) => OperatorSettings) => {
			events.push('persist')
			settings = update(settings)
			return settings
		}
		const outcome = await applyExecutionMode(true, { activePrivateKey: privateKey, locks, pause: () => (paused = true), persist, settings })
		expect(outcome).toEqual({ address: signer, changed: true })
		expect(events).toEqual([`enable:${signer}`, 'persist'])
		expect(settings.runtime.execute).toBe(true)
		expect(settings.paused).toBe(true)
		expect(paused).toBe(true)
		// Re-saving the same mode changes nothing and never touches the lock or the pause.
		const again = fakeLocks()
		expect(await applyExecutionMode(true, { activePrivateKey: privateKey, locks: again.locks, pause: () => (paused = false), persist, settings })).toEqual({ address: undefined, changed: false })
		expect(again.events).toEqual([])
		expect(paused).toBe(true)
	})

	test('releases the reservation when the live file cannot be saved and leaves dry run untouched', async () => {
		const settings = configured()
		const { events, locks } = fakeLocks()
		let paused = false
		const failure = applyExecutionMode(true, {
			activePrivateKey: privateKey,
			locks,
			pause: () => (paused = true),
			persist: async () => {
				events.push('persist')
				throw new Error('disk full')
			},
			settings,
		})
		await expect(failure).rejects.toThrow('disk full')
		expect(events).toEqual([`enable:${signer}`, 'persist', 'disable'])
		expect(paused).toBe(false)
		const unready = fakeLocks()
		await expect(applyExecutionMode(true, { activePrivateKey: undefined, locks: unready.locks, pause: () => (paused = true), persist: async update => update(settings), settings })).rejects.toThrow('Live execution requires an active signer')
		expect(unready.events).toEqual([])
	})

	test('returns to dry run by persisting first and releasing the signer afterwards', async () => {
		let settings = configured({ runtime: { ...configured().runtime, execute: true } })
		const { events, locks } = fakeLocks()
		const persist = async (update: (current: OperatorSettings) => OperatorSettings) => {
			events.push('persist')
			settings = update(settings)
			return settings
		}
		expect(await applyExecutionMode(false, { activePrivateKey: privateKey, locks, pause: () => undefined, persist, settings })).toEqual({ address: undefined, changed: true })
		expect(events).toEqual(['persist', 'disable'])
		expect(settings.runtime.execute).toBe(false)
		expect(settings.paused).toBe(configured().paused)
		const idle = fakeLocks()
		expect(await applyExecutionMode(false, { activePrivateKey: privateKey, locks: idle.locks, pause: () => undefined, persist, settings })).toEqual({ address: undefined, changed: false })
		expect(idle.events).toEqual([])
	})
})
