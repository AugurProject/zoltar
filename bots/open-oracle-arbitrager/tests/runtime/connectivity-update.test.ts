import { describe, expect, test } from 'bun:test'
import { parseOperatorSettings, type PersistedOperatorSettings } from '#config/settings-store'
import { checkIndependentRpcChains, updateOperatorConnectivity } from '../../src/runtime/connectivity-update.ts'
import { EndpointCheckFailure, type EndpointCheck } from '#monitoring/connectivity'
import { deploymentIdentityChanged, deploymentUpdateMustWait, requireSafeDeploymentTransition, tokenUpdateForDeployment } from '../../src/runtime/operator-control-plane.ts'

async function exampleSettings() {
	const settings = parseOperatorSettings(JSON.parse(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).text()))
	settings.submission = { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] }
	return settings
}

function request(network: 'mainnet' | 'sepolia', rpcUrl = 'https://rpc.example/', rpcQuorum: 1 | 2 = 2) {
	return { connectivity: { publicRpcUrls: [rpcUrl], readRpcUrl: rpcUrl }, network, rpcQuorum }
}

function relayCheck(): EndpointCheck {
	return { chainId: 1, checkedAt: '2026-08-12T00:00:00.000Z', error: undefined, kind: 'private-relay', status: 'healthy', target: 'relay.example' }
}

describe('operator connectivity updates', () => {
	test('distinguishes deployment identity switches from same-identity routing updates', async () => {
		const current = (await exampleSettings()).deployment
		expect(deploymentIdentityChanged(current, { ...current, uniswapRouter: current.rep })).toBe(false)
		expect(deploymentIdentityChanged(current, { ...current, openOracle: '0x0000000000000000000000000000000000000002' })).toBe(true)
		expect(deploymentIdentityChanged(current, { ...current, executor: '0x0000000000000000000000000000000000000002' })).toBe(true)
		expect(deploymentUpdateMustWait(current, { ...current, openOracle: '0x0000000000000000000000000000000000000002' }, [{ status: 'open' }])).toBe(true)
		expect(deploymentUpdateMustWait(current, { ...current, openOracle: '0x0000000000000000000000000000000000000002' }, [{ status: 'closed' }])).toBe(false)
		expect(() => requireSafeDeploymentTransition({ positions: [{ status: 'open' }] }, current, { ...current, executor: '0x0000000000000000000000000000000000000002' })).toThrow('cannot change while a position still consumes risk')
		expect(() => requireSafeDeploymentTransition({ positions: [{ status: 'open' }] }, current, { ...current, executor: current.executor })).not.toThrow()
		const nextRep = '0x0000000000000000000000000000000000000002'
		expect(tokenUpdateForDeployment([current.rep], current.rep, { ...current, rep: nextRep }, false)).toEqual([nextRep])
	})

	test('persists a dashboard switch to the isolated-development quorum for live application', async () => {
		let settings = await exampleSettings()
		const state = { endpointChecks: [relayCheck()] }
		const result = await updateOperatorConnectivity({
			activeNetwork: 'mainnet',
			activeRpcQuorum: 2,
			check: async () => [{ chainId: 1, checkedAt: '2026-08-12T00:00:01.000Z', error: undefined, kind: 'read-rpc', status: 'healthy', target: 'rpc.example' }],
			deployment: settings.deployment,
			endpointState: state,
			execute: false,
			persist: async update => {
				settings = update(settings)
			},
			submission: settings.submission,
			value: request('mainnet', 'https://rpc.example/', 1),
		})
		expect(result).toMatchObject({ rpcQuorum: 1, rpcQuorumChanged: true })
		expect(settings.rpcQuorum).toBe(1)
		expect(state.endpointChecks).toEqual([relayCheck()])
	})

	test('queues the persisted market chain when dedicated connectivity initializes Sepolia', async () => {
		let settings = await exampleSettings()
		const result = await updateOperatorConnectivity({
			activeNetwork: undefined,
			activeRpcQuorum: 1,
			check: async () => [{ chainId: 11_155_111, checkedAt: '2026-08-12T00:00:01.000Z', error: undefined, kind: 'read-rpc', status: 'healthy', target: 'rpc.example' }],
			deployment: settings.deployment,
			endpointState: { endpointChecks: [] },
			execute: false,
			persist: async update => {
				settings = update(settings)
			},
			submission: settings.submission,
			value: request('sepolia', 'https://rpc.example/', 1),
		})
		expect(result.centralizedMarkets.assetChainId).toBe(11_155_111)
		expect(settings.centralizedMarkets.assetChainId).toBe(11_155_111)
	})

	test('preserves active endpoint health when a quorum-change check fails', async () => {
		const settings = await exampleSettings()
		const state = { endpointChecks: [relayCheck()] }
		let persisted = false
		const failedCheck = { chainId: 1, checkedAt: '2026-08-12T00:00:01.000Z', error: 'offline', kind: 'read-rpc', status: 'failed', target: 'saved.example' } as const
		await expect(
			updateOperatorConnectivity({
				activeNetwork: 'mainnet',
				activeRpcQuorum: 2,
				check: () => Promise.reject(new EndpointCheckFailure('saved RPC failed', [failedCheck])),
				deployment: settings.deployment,
				endpointState: state,
				execute: false,
				persist: async () => {
					persisted = true
				},
				submission: settings.submission,
				value: request('mainnet', 'https://saved.example/', 1),
			}),
		).rejects.toThrow('saved RPC failed')
		expect(state.endpointChecks).toEqual([relayCheck()])
		expect(persisted).toBe(false)
	})

	test('preserves private relay health when applying same-chain RPC checks', async () => {
		let settings = await exampleSettings()
		const state = { endpointChecks: [relayCheck()] }
		await updateOperatorConnectivity({
			activeNetwork: 'mainnet',
			activeRpcQuorum: 2,
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
					activeRpcQuorum: 2,
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
				activeRpcQuorum: 2,
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
		).rejects.toThrow('Select the chain profile before saving its RPC settings')
		expect(checked).toBe(false)
		expect(persisted).toBeUndefined()
		expect(settings).toEqual(before)
	})

	test('rejects a dry-run chain switch before checking independent RPCs', async () => {
		const settings = await exampleSettings()
		settings.deployment.quorumRpcUrls = ['https://quorum.example/']
		let persisted = false
		await expect(
			updateOperatorConnectivity({
				activeNetwork: 'mainnet',
				activeRpcQuorum: 2,
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
		).rejects.toThrow('Select the chain profile before saving its RPC settings')
		expect(persisted).toBe(false)
	})

	test('rejects a wrong-chain independent quorum RPC update', async () => {
		await expect(checkIndependentRpcChains(['https://quorum.example/'], 1, async () => 11_155_111)).rejects.toThrow('returned chain 11155111; expected chain 1')
	})
})
