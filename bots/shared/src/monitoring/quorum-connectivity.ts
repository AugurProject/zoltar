import type { ProcessEnvironment } from '../config/environment.ts'
import { type ConnectivitySettings, validateConnectivitySettings, validateIndependentReadRpcUrls } from './connectivity.ts'
import { rpcQuorumRequirement, type RpcQuorumRequirement } from './rpc-quorum-policy.ts'

/** The `connectivity` section every bot stores: the primary reader, the public submission RPCs, the independent quorum readers, and the read agreement requirement. */
export type QuorumConnectivitySettings = ConnectivitySettings & {
	quorumRpcUrls: readonly string[]
	rpcQuorum: RpcQuorumRequirement
}

const QUORUM_CONNECTIVITY_KEYS = ['publicRpcUrls', 'quorumRpcUrls', 'readRpcUrl', 'rpcQuorum']

/** Parses a stored `connectivity` section; an omitted `rpcQuorum` falls back to `ZOLTAR_BOT_RPC_QUORUM`. */
export function parseQuorumConnectivitySettings(value: unknown, environment: ProcessEnvironment = process.env): QuorumConnectivitySettings {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('connectivity must be an object')
	const record = Object.fromEntries(Object.entries(value))
	const unsupported = Object.keys(record).find(key => !QUORUM_CONNECTIVITY_KEYS.includes(key))
	if (unsupported !== undefined) throw new Error(`connectivity contains unsupported field ${unsupported}`)
	if (!('quorumRpcUrls' in record)) throw new Error('connectivity is missing quorumRpcUrls')
	const connectivity = validateConnectivitySettings({ publicRpcUrls: record['publicRpcUrls'], readRpcUrl: record['readRpcUrl'] })
	const quorumValues: unknown = record['quorumRpcUrls']
	if (!Array.isArray(quorumValues) || quorumValues.some(candidate => typeof candidate !== 'string')) throw new Error('connectivity.quorumRpcUrls must contain only RPC URLs')
	const quorumRpcUrls = validateIndependentReadRpcUrls(
		connectivity.readRpcUrl,
		quorumValues.map(candidate => String(candidate)),
	)
	const rpcQuorum = record['rpcQuorum'] === undefined ? rpcQuorumRequirement(environment) : record['rpcQuorum']
	if (rpcQuorum !== 1 && rpcQuorum !== 2) throw new Error('connectivity.rpcQuorum must be 1 or 2')
	return { ...connectivity, quorumRpcUrls, rpcQuorum }
}

/** The in-memory connectivity of a network the operator has not configured yet: an unusable placeholder reader and no quorum readers. */
export function unconfiguredQuorumConnectivity(environment: ProcessEnvironment = process.env): QuorumConnectivitySettings {
	return { publicRpcUrls: [], quorumRpcUrls: [], readRpcUrl: 'http://127.0.0.1:1', rpcQuorum: rpcQuorumRequirement(environment) }
}
