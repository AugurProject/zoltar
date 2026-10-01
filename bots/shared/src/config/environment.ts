import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseScanBlockTimeOverride } from '@zoltar/core-shared/monitoring/scanStatus'
import type { RpcQuorumRequirement } from '../monitoring/rpc-quorum-policy.ts'

/**
 * The process environment variables every bot shares, each read once into a typed value.
 *
 * Deployments set these names, so they are never renamed. The per-bot operator-file variables are read by each bot's
 * own settings loader and do not share a prefix: the liquidator reads `ZOLTAR_LIQUIDATOR_CONFIG` and the chaos bot
 * `ZOLTAR_CHAOS_CONFIG`, while the arbitrager reads `OPEN_ORACLE_ARBITRAGER_CONFIG` (named after its package rather than
 * the `ZOLTAR_*_CONFIG` pattern). `SCAN_BLOCK_TIME_MS` likewise predates the `ZOLTAR_BOT_*` prefix. The Docker entrypoint
 * (`bots/shared/scripts/docker-entrypoint.sh`) depends on both operator-file names.
 */
export type ProcessEnvironment = Readonly<Record<string, string | undefined>>

export type DashboardEnvironment = {
	/** `ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED=true`: a container publishes its loopback-bound dashboard to the host. */
	readonly loopbackPublished: boolean
	/** `ZOLTAR_BOT_DASHBOARD_PASSWORD`: required whenever the dashboard is reachable beyond loopback. */
	readonly password: string | undefined
	/** `ZOLTAR_BOT_DASHBOARD_PUBLIC_AUTHORITY`: the host and port browsers use to reach a network-bound dashboard. */
	readonly publicAuthority: string | undefined
}

/** The variables a running operator reads once at startup. */
export type BotEnvironment = {
	readonly dashboard: DashboardEnvironment
	/** `SCAN_BLOCK_TIME_MS`: overrides the block interval scan status reports use; `undefined` keeps the chain default. */
	readonly scanBlockTimeMs: number | undefined
}

function dashboardEnvironment(environment: ProcessEnvironment = process.env): DashboardEnvironment {
	return {
		loopbackPublished: environment['ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED'] === 'true',
		password: environment['ZOLTAR_BOT_DASHBOARD_PASSWORD'],
		publicAuthority: environment['ZOLTAR_BOT_DASHBOARD_PUBLIC_AUTHORITY'],
	}
}

/**
 * `ZOLTAR_BOT_RPC_QUORUM`: the RPC agreement requirement for operator files that do not save one. Settings parsing reads
 * it only as that fallback, so it is not part of `readBotEnvironment` and a malformed value fails only where it applies.
 */
export function rpcQuorumEnvironment(environment: ProcessEnvironment = process.env): RpcQuorumRequirement {
	const configured = environment['ZOLTAR_BOT_RPC_QUORUM']
	if (configured === undefined || configured === '1') return 1
	if (configured === '2') return 2
	throw new Error('ZOLTAR_BOT_RPC_QUORUM must be 1 or 2')
}

/**
 * `ZOLTAR_BOT_SIGNER_LOCK_ROOT`: the directory every bot sharing a signer coordinates through, resolved when a signer lock
 * is acquired. An unset or blank value falls back to a per-host temporary directory.
 */
export function signerLockRootEnvironment(environment: ProcessEnvironment = process.env) {
	const configured = environment['ZOLTAR_BOT_SIGNER_LOCK_ROOT']
	if (configured === undefined || configured.trim() === '') return join(tmpdir(), 'zoltar-bot-locks')
	return configured
}

/** Reads and validates the operator's shared variables once, so a malformed value fails startup instead of a later scan. */
export function readBotEnvironment(environment: ProcessEnvironment = process.env): BotEnvironment {
	return {
		dashboard: dashboardEnvironment(environment),
		scanBlockTimeMs: parseScanBlockTimeOverride(environment['SCAN_BLOCK_TIME_MS']),
	}
}
