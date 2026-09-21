import { publicOpportunity } from '#state/opportunity-snapshot'
import { publicOperatorFailure, publicPollFailure } from '#state/public-failures'
import type { OperationEntry, OperatorSnapshot, PublicOperationEntry, PublicOperatorSnapshot } from '#state/operator-state'

function publicLastError(snapshot: Pick<OperatorSnapshot, 'lastError' | 'lastPollFailureAt' | 'marketAvailability'>) {
	if (snapshot.marketAvailability?.kind === 'missing-deployment' || snapshot.lastError === undefined) return undefined
	return snapshot.lastPollFailureAt === undefined ? publicOperatorFailure(snapshot.lastError) : publicPollFailure(snapshot.lastError)
}

function publicInformationalOperationValue(value: string | undefined) {
	if (value === undefined) return undefined
	if (/^(?:[A-Za-z]:[\\/]|[/~.]\/)/.test(value) || /(?:api[_-]?key|authorization|bearer|password|secret|token)\s*[=:]\s*\S+/i.test(value)) return undefined
	const urlMatches = [...value.matchAll(/https?:\/\/[^\s,;)]+/gi)]
	for (const match of urlMatches) {
		try {
			const url = new URL(match[0])
			if (url.username !== '' || url.password !== '' || (url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') return undefined
		} catch (error) {
			void error
			return undefined
		}
	}
	const nonUrlValue = urlMatches.reduce((remaining, match) => remaining.replace(match[0], ''), value)
	if (/[\\/]/.test(nonUrlValue)) return undefined
	return value
}

function publicOperationEntry(entry: OperationEntry): PublicOperationEntry {
	const publicEntry: PublicOperationEntry = {
		category: entry.category,
		level: entry.level,
		message: entry.message,
		reportId: entry.reportId,
		timestamp: entry.timestamp,
	}
	if (entry.level !== 'info') {
		publicEntry.details = entry.details === undefined ? undefined : publicOperatorFailure(entry.details)
		publicEntry.reason = entry.reason === undefined ? undefined : publicOperatorFailure(entry.reason)
		return publicEntry
	}
	publicEntry.details = entry.category === 'configuration' && entry.message === 'Complete operator configuration saved' ? undefined : publicInformationalOperationValue(entry.details)
	publicEntry.reason = publicInformationalOperationValue(entry.reason)
	return publicEntry
}

function publicEndpointTarget(target: string) {
	try {
		const parsed = new URL(target)
		return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : 'Protected endpoint'
	} catch (error) {
		void error
		return publicInformationalOperationValue(target) ?? 'Protected endpoint'
	}
}

export function publicOperatorSnapshot(snapshot: OperatorSnapshot): PublicOperatorSnapshot {
	return {
		activeReportCount: snapshot.activeReportCount,
		consecutivePollFailures: snapshot.consecutivePollFailures ?? 0,
		balances:
			snapshot.balances === undefined
				? undefined
				: {
						availableEth: snapshot.balances.availableEth,
						availableRep: snapshot.balances.availableRep,
						availableWeth: snapshot.balances.availableWeth,
						repValueWeth: snapshot.balances.repValueWeth,
						totalValueWeth: snapshot.balances.totalValueWeth,
					},
		blockNumber: snapshot.blockNumber,
		blockTimestamp: snapshot.blockTimestamp,
		canonicalDeployments: snapshot.canonicalDeployments,
		centralizedMarket: snapshot.centralizedMarket,
		marketConsensus: snapshot.marketConsensus,
		execute: snapshot.execute,
		executor: snapshot.executor,
		executorDeploymentRecovery: snapshot.executorDeploymentRecovery,
		coordinatorAddresses: snapshot.deployment.coordinatorAddresses,
		executionHistory: snapshot.executionHistory.map(record => ({
			actualGasCostEth: record.actualGasCostEth,
			direction: record.direction,
			estimatedNetProfitWeth: record.estimatedNetProfitWeth,
			executedAt: record.executedAt,
			reportId: record.reportId,
			requiredToken: record.requiredToken,
			requiredWeth: record.requiredWeth,
			tokenSymbol: record.tokenSymbol,
			trackedNetProfitEth: record.trackedNetProfitEth,
			transactionHash: record.transactionHash,
		})),
		executionHistoryRecordCount: snapshot.executionHistoryRecordCount,
		positionRecordCount: snapshot.positionRecordCount,
		expectedChainId: snapshot.expectedChainId,
		explorerUrl: snapshot.explorerUrl,
		endpointChecks: snapshot.endpointChecks.map(check => ({
			chainId: check.chainId,
			checkedAt: check.checkedAt,
			error: check.error === undefined ? undefined : publicOperatorFailure(check.error),
			kind: check.kind,
			status: check.status,
			target: publicEndpointTarget(check.target),
		})),
		gameCapital: {
			eth: snapshot.gameCapital.eth,
			totalEthWeth: snapshot.gameCapital.totalEthWeth,
			weth: snapshot.gameCapital.weth,
		},
		marketAvailability: snapshot.marketAvailability,
		lastError: publicLastError(snapshot),
		lastPollAt: snapshot.lastPollAt,
		lastPollFailureAt: snapshot.lastPollFailureAt,
		lastRetryAt: snapshot.lastRetryAt,
		nextRetryAt: snapshot.nextRetryAt,
		retryInProgress: snapshot.retryInProgress,
		mode: snapshot.mode,
		network: snapshot.network,
		networkConfigured: snapshot.networkConfigured,
		openOracle: snapshot.openOracle,
		operatorCapable: snapshot.operatorCapable,
		operationLog: snapshot.operationLog.map(publicOperationEntry),
		opportunities: snapshot.opportunities.map(publicOpportunity),
		positions: snapshot.positions.map(position => ({
			actualEntryGasCostEth: position.actualEntryGasCostEth,
			direction: position.direction,
			entryTransactionHash: position.entryTransactionHash,
			hedgedProfitBeforeGasEth: position.hedgedProfitBeforeGasEth,
			lifecycleGasCostEth: position.lifecycleGasCostEth,
			lifecycleReceiptRecovered: position.lifecycleReceiptRecovered,
			lifecycleSettlerRewardEth: position.lifecycleSettlerRewardEth,
			hasLifecycleTransactions: position.lifecycleTransactionHashes.length !== 0,
			manuallyReconciled: position.manualReconciliation !== undefined,
			openedAt: position.openedAt,
			realizedNetProfitEth: position.realizedNetProfitEth,
			reportId: position.reportId,
			status: position.status,
			tokenSymbol: position.tokenSymbol,
			withdrawnToken: position.withdrawnToken,
			withdrawnWeth: position.withdrawnWeth,
		})),
		paused: snapshot.paused,
		queuedSettings: snapshot.queuedSettings,
		queuedWallet: snapshot.queuedWallet,
		rpcEndpointHealth: (snapshot.rpcEndpointHealth ?? []).map(endpoint => ({
			...endpoint,
			error: endpoint.error === undefined ? undefined : publicOperatorFailure(endpoint.error),
			target: publicEndpointTarget(endpoint.target),
		})),
		savedWallet: snapshot.savedWallet,
		status: snapshot.status,
		submission: {
			minimumBundleRelaySuccesses: snapshot.submission.minimumBundleRelaySuccesses,
			mode: snapshot.submission.mode,
		},
		universes: snapshot.universes,
		tokenAddresses: [...snapshot.tokenAddresses],
		tokenMarkets: snapshot.tokenMarkets.map(token => ({
			address: token.address,
			balance: token.balance,
			decimals: token.decimals,
			name: token.name,
			pools: token.pools.map(pool => ({
				address: pool.address,
				fee: pool.fee,
				liquidity: pool.liquidity,
				priceWeth: pool.priceWeth,
				url: pool.url,
				venue: pool.venue,
			})),
			symbol: token.symbol,
		})),
		priceHistory: snapshot.priceHistory.map(point => ({
			blockNumber: point.blockNumber,
			pool: point.pool,
			priceWeth: point.priceWeth,
			sampledAt: point.sampledAt,
			symbol: point.symbol,
			token: point.token,
			venue: point.venue,
		})),
		reportPaths: snapshot.reportPaths.map(path => ({
			reportId: path.reportId,
			settled: path.settled,
			steps: path.steps.map(step => ({
				amount1: step.amount1,
				amount2: step.amount2,
				blockNumber: step.blockNumber,
				event: step.event,
				reporter: step.reporter,
				transactionHash: step.transactionHash,
			})),
		})),
		risk: {
			limits: {
				lifecycleGasReserveWeth: snapshot.risk.limits.lifecycleGasReserveWeth,
				maxConcurrentPositions: snapshot.risk.limits.maxConcurrentPositions,
				maxDailyGasSpendWeth: snapshot.risk.limits.maxDailyGasSpendWeth,
				maxPositionNotionalWeth: snapshot.risk.limits.maxPositionNotionalWeth,
				maxTotalLockedWeth: snapshot.risk.limits.maxTotalLockedWeth,
			},
			usage: {
				dailyGasSpentWeth: snapshot.risk.usage.dailyGasSpentWeth,
				lockedWeth: snapshot.risk.usage.lockedWeth,
				openPositions: snapshot.risk.usage.openPositions,
			},
		},
		totalActualGasCostEth: snapshot.totalActualGasCostEth,
		totalHedgedProfitBeforeGasEth: snapshot.totalHedgedProfitBeforeGasEth,
		totalOpenHedgedNetProfitEth: snapshot.totalOpenHedgedNetProfitEth,
		totalRealizedNetProfitEth: snapshot.totalRealizedNetProfitEth,
		settlements: snapshot.settlements,
		transactionActivity: snapshot.transactionActivity.map(activity => ({
			acceptedTargets: activity.acceptedTargets.map(publicEndpointTarget),
			actualGasCostEth: activity.actualGasCostEth,
			estimatedNetProfitEth: activity.estimatedNetProfitEth,
			failedTargets: activity.failedTargets.map(target => ({ error: target.error === undefined ? undefined : publicOperatorFailure(target.error), target: publicEndpointTarget(target.target) })),
			hash: activity.hash,
			kind: activity.kind,
			mode: activity.mode,
			reportId: activity.reportId,
			status: activity.status,
			tokenSymbol: activity.tokenSymbol,
			trackedNetProfitEth: activity.trackedNetProfitEth,
			updatedAt: activity.updatedAt,
		})),
		wallet: snapshot.wallet,
	}
}
