import type { OperatorSnapshot } from '#state/operator-state'
import { rawNonPollFailure, rawRelayFailure, rawRpcFailure, sampledAt } from './fixture-constants.mts'
import { snapshot } from './fixture-snapshot.mts'

/** The scenario switches the capture steps flip between screenshots; the fixture server reads them on every request. */
export type FixtureScenario = {
	status: OperatorSnapshot['status']
	paused: boolean
	attention: 'error' | 'none' | 'recovery' | 'transaction'
	pollFailureMetadata: boolean
	retryInProgress: boolean
	nextRetryAt: string | undefined
	stateUnavailable: boolean
	stateHanging: boolean
	connectivityFailure: boolean
	connectivityHanging: boolean
	configurationHanging: boolean
	configurationUnavailable: boolean
	networkConfigured: boolean
	pauseHanging: boolean
	profileHanging: boolean
	network: 'mainnet' | 'sepolia'
	/** Every pause request the dashboard sent, in order. */
	pauseRequests: boolean[]
}

export const fixture: FixtureScenario = {
	status: 'running',
	paused: false,
	attention: 'none',
	pollFailureMetadata: true,
	retryInProgress: false,
	nextRetryAt: undefined,
	stateUnavailable: false,
	stateHanging: false,
	connectivityFailure: false,
	connectivityHanging: false,
	configurationHanging: false,
	configurationUnavailable: false,
	networkConfigured: true,
	pauseHanging: false,
	profileHanging: false,
	network: 'mainnet',
	pauseRequests: [],
}

function fixtureLastError(attention: string, pollFailureMetadata: boolean) {
	if (attention !== 'error') return undefined
	return pollFailureMetadata ? rawRpcFailure : rawNonPollFailure
}

/** Derives the operator snapshot for the current scenario from the healthy mainnet fixture. */
export function currentFixtureSnapshot(): OperatorSnapshot {
	const fixturePositions = fixture.attention === 'recovery' ? snapshot.positions.map((position, index) => (index === 0 ? { ...position, status: 'recovery-required' as const } : position)) : snapshot.positions
	const fixtureTransactions = snapshot.transactionActivity.map((transaction, index) => {
		if (index !== 0) return transaction
		if (fixture.attention === 'transaction') return { ...transaction, status: 'confirmation-unknown' as const }
		if (fixture.attention === 'error') return { ...transaction, failedTargets: [{ error: rawRelayFailure, target: 'https://relay.example' }], status: 'submission-failed' as const }
		return transaction
	})
	const expectedChainId = fixture.network === 'mainnet' ? 1 : 11_155_111
	const endpointChecks = snapshot.endpointChecks.map(check => ({
		...check,
		chainId: expectedChainId,
		target: fixture.network === 'mainnet' ? check.target : check.target.replace('read.example', 'sepolia-read.example').replace('rpc.example', 'sepolia-rpc.example').replace('relay.flashbots.net', 'sepolia-relay.example'),
	}))
	const pollFailure = fixture.attention === 'error' && fixture.pollFailureMetadata
	return {
		...snapshot,
		expectedChainId,
		explorerUrl: fixture.network === 'mainnet' ? 'https://etherscan.io' : 'https://sepolia.etherscan.io',
		network: fixture.network,
		networkConfigured: fixture.networkConfigured,
		endpointChecks: fixture.attention === 'error' ? endpointChecks.map((check, index) => (index === 0 ? { ...check, chainId: undefined, error: rawRpcFailure, status: 'failed' as const } : check)) : endpointChecks,
		rpcEndpointHealth: snapshot.rpcEndpointHealth?.map(endpoint => ({ ...endpoint, target: fixture.network === 'mainnet' ? endpoint.target : endpoint.target.replace('rpc.example', 'sepolia-rpc.example').replace('quorum.example', 'sepolia-quorum.example') })),
		lastError: fixtureLastError(fixture.attention, fixture.pollFailureMetadata),
		lastPollFailureAt: pollFailure ? new Date(Date.now() - 2_000).toISOString() : undefined,
		lastRetryAt: pollFailure && fixture.retryInProgress ? new Date(Date.now() - 1_000).toISOString() : undefined,
		nextRetryAt: pollFailure && !fixture.retryInProgress ? (fixture.nextRetryAt ?? new Date(Date.now() + 10_000).toISOString()) : undefined,
		retryInProgress: fixture.retryInProgress,
		operationLog: fixture.attention === 'error' ? [{ category: 'transaction', details: rawRelayFailure, level: 'error', message: 'Transaction submission failed', reason: rawRpcFailure, reportId: '816', timestamp: sampledAt(0) }, ...snapshot.operationLog] : snapshot.operationLog,
		operatorCapable: !fixture.paused && fixture.status === 'running' && fixture.attention === 'none',
		paused: fixture.paused,
		positions: fixturePositions,
		status: fixture.paused ? 'paused' : fixture.status,
		transactionActivity: fixtureTransactions,
	}
}
