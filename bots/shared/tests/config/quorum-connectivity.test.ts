import { describe, expect, test } from 'bun:test'
import { parseQuorumConnectivitySettings, unconfiguredQuorumConnectivity } from '../../src/monitoring/quorum-connectivity.ts'

const connectivity = {
	publicRpcUrls: ['https://broadcast.example'],
	quorumRpcUrls: ['https://second.example', 'https://third.example'],
	readRpcUrl: 'https://primary.example',
	rpcQuorum: 2,
}

describe('shared connectivity settings', () => {
	test('parses the connectivity section every bot stores', () => {
		expect(parseQuorumConnectivitySettings(connectivity)).toEqual({
			publicRpcUrls: ['https://broadcast.example/'],
			quorumRpcUrls: ['https://second.example/', 'https://third.example/'],
			readRpcUrl: 'https://primary.example/',
			rpcQuorum: 2,
		})
	})

	test('takes the RPC agreement requirement from the environment only when the file omits it', () => {
		const { rpcQuorum: _rpcQuorum, ...withoutQuorum } = connectivity
		expect(parseQuorumConnectivitySettings(withoutQuorum, { ZOLTAR_BOT_RPC_QUORUM: '2' }).rpcQuorum).toBe(2)
		expect(parseQuorumConnectivitySettings(withoutQuorum, {}).rpcQuorum).toBe(1)
		expect(parseQuorumConnectivitySettings({ ...connectivity, rpcQuorum: 1 }, { ZOLTAR_BOT_RPC_QUORUM: '2' }).rpcQuorum).toBe(1)
	})

	test('rejects unknown fields, missing quorum readers, invalid quorum values, and dependent origins', () => {
		expect(() => parseQuorumConnectivitySettings({ ...connectivity, chainId: 1 })).toThrow('connectivity contains unsupported field chainId')
		const { quorumRpcUrls: _quorumRpcUrls, ...withoutQuorumReaders } = connectivity
		expect(() => parseQuorumConnectivitySettings(withoutQuorumReaders)).toThrow('connectivity is missing quorumRpcUrls')
		expect(() => parseQuorumConnectivitySettings({ ...connectivity, quorumRpcUrls: [1] })).toThrow('connectivity.quorumRpcUrls must contain only RPC URLs')
		for (const rpcQuorum of [null, '1', 0, 3]) expect(() => parseQuorumConnectivitySettings({ ...connectivity, rpcQuorum })).toThrow('connectivity.rpcQuorum must be 1 or 2')
		expect(() => parseQuorumConnectivitySettings({ ...connectivity, quorumRpcUrls: ['https://primary.example/other'] })).toThrow('independent origins')
		expect(() => parseQuorumConnectivitySettings(null)).toThrow('connectivity must be an object')
		expect(() => parseQuorumConnectivitySettings({ ...connectivity, quorumRpcUrls: ['http://quorum.example'] })).toThrow('HTTPS or HTTP on loopback, anvil, or reth')
		expect(() => parseQuorumConnectivitySettings({ ...connectivity, quorumRpcUrls: ['https://user:secret@quorum.example'] })).toThrow('embedded credentials')
		expect(() => parseQuorumConnectivitySettings({ ...connectivity, quorumRpcUrls: Array.from({ length: 9 }, (_, index) => `https://quorum-${index.toString()}.example`) })).toThrow('At most 8 read quorum RPC URLs are supported')
	})

	test('describes an unconfigured network with an unusable placeholder reader and no quorum readers', () => {
		expect(unconfiguredQuorumConnectivity({ ZOLTAR_BOT_RPC_QUORUM: '2' })).toEqual({ publicRpcUrls: [], quorumRpcUrls: [], readRpcUrl: 'http://127.0.0.1:1', rpcQuorum: 2 })
	})
})
