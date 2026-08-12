import { describe, expect, test } from 'bun:test'
import { parseOperatorSettings, type PersistedOperatorSettings } from '#config/settings-store'
import { checkIndependentRpcChains, updateOperatorConnectivity } from '../../src/runtime/connectivity-update.ts'
import type { EndpointCheck } from '#monitoring/connectivity'

async function exampleSettings() {
	const settings = parseOperatorSettings(JSON.parse(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).text()))
	settings.submission = { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] }
	return settings
}

function request(network: 'mainnet' | 'sepolia', rpcUrl = 'https://rpc.example/') {
	return { connectivity: { publicRpcUrls: [rpcUrl], readRpcUrl: rpcUrl }, network }
}

function relayCheck(): EndpointCheck {
	return { chainId: 1, checkedAt: '2026-08-12T00:00:00.000Z', error: undefined, kind: 'private-relay', status: 'healthy', target: 'relay.example' }
}

describe('operator connectivity updates', () => {
	test('preserves private relay health when applying same-chain RPC checks', async () => {
		let settings = await exampleSettings()
		const state = { endpointChecks: [relayCheck()] }
		await updateOperatorConnectivity({
			activeNetwork: 'mainnet',
			check: async () => [
				{ chainId: 1, checkedAt: '2026-08-12T00:00:01.000Z', error: undefined, kind: 'read-rpc', status: 'healthy', target: 'rpc.example' },
				{ chainId: 1, checkedAt: '2026-08-12T00:00:01.000Z', error: undefined, kind: 'public-rpc', status: 'healthy', target: 'rpc.example' },
			],
			deployment: settings.deployment,
			endpointState: state,
			execute: false,
			persist: async update => {
				settings = update(settings)
			},
			submission: settings.submission,
			value: request('mainnet'),
		})
		expect(state.endpointChecks.map(check => check.kind)).toEqual(['read-rpc', 'public-rpc', 'private-relay'])
		expect(settings.connectivity.readRpcUrl).toBe('https://rpc.example/')
	})

	test('records wrong-chain RPC failures without discarding private relay health', async () => {
		const rpc = Bun.serve({
			async fetch(request) {
				const body = (await request.json()) as { id: unknown }
				return Response.json({ id: body.id, jsonrpc: '2.0', result: '0xaa36a7' })
			},
			hostname: '127.0.0.1',
			port: 0,
		})
		try {
			if (rpc.port === undefined) throw new Error('Test RPC did not expose a port')
			const settings = await exampleSettings()
			const state = { endpointChecks: [relayCheck()] }
			let persisted = false
			await expect(
				updateOperatorConnectivity({
					activeNetwork: 'mainnet',
					deployment: settings.deployment,
					endpointState: state,
					execute: false,
					persist: async () => {
						persisted = true
					},
					submission: settings.submission,
					value: request('mainnet', `http://127.0.0.1:${rpc.port.toString()}/`),
				}),
			).rejects.toThrow('Expected chain 1')
			expect(persisted).toBe(false)
			expect(state.endpointChecks.map(check => check.kind)).toEqual(['read-rpc', 'public-rpc', 'private-relay'])
			expect(state.endpointChecks.slice(0, 2).every(check => check.status === 'failed')).toBe(true)
		} finally {
			rpc.stop(true)
		}
	})

	test('rejects live chain changes before checks or persistence', async () => {
		const settings = await exampleSettings()
		const before = structuredClone(settings)
		let checked = false
		let persisted: PersistedOperatorSettings | undefined
		await expect(
			updateOperatorConnectivity({
				activeNetwork: 'mainnet',
				check: async () => {
					checked = true
					return [{ chainId: 11_155_111, checkedAt: '2026-08-12T00:00:01.000Z', error: undefined, kind: 'read-rpc', status: 'healthy', target: 'rpc.example' }]
				},
				deployment: settings.deployment,
				endpointState: { endpointChecks: [relayCheck()] },
				execute: true,
				persist: async update => {
					persisted = update(settings)
				},
				submission: settings.submission,
				value: request('sepolia'),
			}),
		).rejects.toThrow('Disable live execution and restart before changing chains')
		expect(checked).toBe(false)
		expect(persisted).toBeUndefined()
		expect(settings).toEqual(before)
	})

	test('rejects a chain switch when an independent quorum RPC is on another chain', async () => {
		const settings = await exampleSettings()
		settings.deployment.quorumRpcUrls = ['https://quorum.example/']
		let persisted = false
		await expect(
			updateOperatorConnectivity({
				activeNetwork: 'mainnet',
				check: async () => [{ chainId: 11_155_111, checkedAt: '2026-08-12T00:00:01.000Z', error: undefined, kind: 'read-rpc', status: 'healthy', target: 'rpc.example' }],
				deployment: settings.deployment,
				endpointState: { endpointChecks: [relayCheck()] },
				execute: false,
				persist: async () => {
					persisted = true
				},
				readChainId: async () => 1,
				submission: settings.submission,
				value: request('sepolia'),
			}),
		).rejects.toThrow('returned chain 1; expected chain 11155111')
		expect(persisted).toBe(false)
	})

	test('rejects a wrong-chain independent quorum RPC update', async () => {
		await expect(checkIndependentRpcChains(['https://quorum.example/'], 1, async () => 11_155_111)).rejects.toThrow('returned chain 11155111; expected chain 1')
	})
})
