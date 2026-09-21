import { expect, test } from 'bun:test'
import { decodeConfiguration, decodeMarketProbe, decodeSigner, decodeSnapshot } from '../../src/dashboard/api-validation.ts'

const configuration = {
	approvedUniverses: [],
	childMarketConfigurations: [],
	centralizedMarkets: {},
	desiredPools: [],
	networkConfigured: false,
	runtime: { execute: false, historicalLogRecovery: false, logLookbackBlocks: 256 },
	selectedPools: [],
	strategy: { enabled: true, limit: '1', retries: 3 },
	submission: { minimumBundleRelaySuccesses: 1, mode: 'public' as const, relayUrls: [] },
}

test('accepts unconfigured profiles and validates nested configuration before applying it', () => {
	expect(decodeConfiguration(configuration)).toEqual(configuration)
	for (const value of [
		null,
		[],
		{},
		{ ...configuration, strategy: { limit: {} } },
		{ ...configuration, approvedUniverses: [1] },
		{ ...configuration, runtime: { execute: false, historicalLogRecovery: 'false', logLookbackBlocks: 256 } },
		{ ...configuration, runtime: { historicalLogRecovery: false, logLookbackBlocks: 256 } },
		{ ...configuration, submission: { minimumBundleRelaySuccesses: 1, mode: 'bundle', relayUrls: [] } },
		{ ...configuration, connectivity: { publicRpcUrls: [], quorumRpcUrls: [], readRpcUrl: '', rpcQuorum: 3 } },
	])
		expect(() => decodeConfiguration(value)).toThrow('invalid configuration document')
})

test('validates market probe and signer responses before showing success', () => {
	const probe: ReturnType<typeof decodeMarketProbe> = { assets: [{ assetId: 'rep', sources: [{ id: 'dex', kind: 'dex', market: 'REP/ETH', status: 'observed' }] }], blockNumber: '42' }
	expect(decodeMarketProbe(probe)).toEqual(probe)
	expect(() => decodeMarketProbe({ ...probe, assets: [{ assetId: 'rep', sources: [null] }] })).toThrow('invalid market source response')
	expect(() => decodeMarketProbe({ ...probe, blockNumber: 42 })).toThrow('invalid market source response')
	expect(decodeSigner({})).toEqual({})
	expect(decodeSigner({ wallet: '0x123' }).wallet).toBe('0x123')
	expect(() => decodeSigner({ wallet: false })).toThrow('invalid signer response')
})

test('rejects non-object snapshots at the response boundary', () => {
	for (const value of [null, [], {}, false]) expect(() => decodeSnapshot(value)).toThrow('invalid state snapshot')
})
