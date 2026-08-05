import { encodeFunctionData, parseUnits, type Address, type Hex, zeroAddress } from '#ethereum'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple, OPEN_ORACLE_FLAG_TIME_TYPE } from '@zoltar/shared/openOracle'
import { openOracleArbitrageExecutorAbi } from '#contracts/abi'
import type { Configuration } from '#config/configuration'
import { attemptHasFinality, canonicalBlockHashWithQuorum, finalizeSubmittedLifecycleAttempt, guardedTransactionSubmission, journaledSubmission, lifecycleAllowanceMismatch, lifecycleAttemptNeedsRecovery, lifecycleLastValidBlockNumber, lifecycleWithdrawalMismatch } from '#execution/execution-orchestration'
import type { ActiveReport } from '#monitoring/oracle-log-state'
import { replacementCredit } from '#core/position-accounting'
import { parseDecimalWeth } from '#state/operator-state'
import type { PositionRecord } from '#state/position-store'
import { prepareSignedTransaction, simulateSignedBundleEveryRelay, submitConfiguredSignedBundle } from '#execution/transaction-submission'
import { submitContractTransaction, waitForTrackedTransaction, type TrackTransaction } from '#execution/transaction-tracker'
import type { ReadClient, WriteClient } from '#core/operator-types'
import { errorMessage } from '#core/rpc-validation'
import { currentBlockNumberWithQuorum, dateFromBlockTimestamp, durableTransactionIntent, immediateReplacementAmounts, lifecycleBalancesWithQuorum, pendingNonceWithQuorum, storedReportWithQuorum } from '#execution/recovery-support'
import { discoverPublicReplacementWithQuorum, expireEntryWithQuorum, finalizeLifecycleAfterFinalityWithQuorum, recoverPendingEntryWithQuorum, recoverPendingLifecycleWithQuorum, tokenDecimalsFromSnapshot } from '#execution/position-recovery'

export {
	discoverPublicReplacementWithQuorum,
	executionRecordForConfirmedPosition,
	expireEntryWithQuorum,
	finalizeLifecycleAfterFinalityWithQuorum,
	reconcileExpiredAttemptsWithQuorum,
	recoverPendingEntryWithQuorum,
	recoverPendingLifecycleWithQuorum,
} from '#execution/position-recovery'

export async function processPositionLifecycle(client: ReadClient, readClients: readonly ReadClient[], wallet: WriteClient, config: Configuration, position: PositionRecord, blockNumber: bigint, reportPath: ActiveReport | undefined, persistPosition: (position: PositionRecord) => Promise<void>, track: TrackTransaction) {
	const account = wallet.account
	const executor = config.executor
	if (account.signTransaction === undefined || account.signMessage === undefined) throw new Error('Position recovery requires a local transaction and relay signer')
	if (executor === undefined) throw new Error('Position recovery requires the authenticated executor parent-block guard')
	const signMessage = account.signMessage
	if (position.account.toLowerCase() !== account.address.toLowerCase()) throw new Error(`Open position ${position.reportId} belongs to ${position.account}, not the active signer`)
	if (position.status === 'closed-pending-finality') {
		const finalized = await finalizeLifecycleAfterFinalityWithQuorum(readClients, config, position, blockNumber)
		if (finalized !== position) await persistPosition(finalized)
		if (finalized.status === 'closed' || finalized.status === 'replaced') return 'processed' as const
		if (finalized.status === 'open') return 'progressed' as const
		return 'waiting' as const
	}
	const id = BigInt(position.reportId)
	const storedSnapshot = await storedReportWithQuorum(readClients, config, id, blockNumber)
	const report = storedSnapshot.report
	const game = report.game
	const balancesBefore = await lifecycleBalancesWithQuorum(readClients, config, account.address, position.token, blockNumber)
	if (balancesBefore.blockHash.toLowerCase() !== storedSnapshot.blockHash.toLowerCase()) throw new Error('Lifecycle state reads use different canonical blocks')
	let activePosition = position
	if (activePosition.entrySubmissionMode === 'public' || activePosition.lifecycleSubmissionMode === 'public') {
		let pendingKind: 'entry' | 'lifecycle' | undefined
		if (activePosition.actualEntryGasCostEth === '0' && activePosition.entrySubmissionMode === 'public') pendingKind = 'entry'
		else if (lifecycleAttemptNeedsRecovery(activePosition) && activePosition.lifecycleSubmissionMode === 'public') pendingKind = 'lifecycle'
		if (pendingKind !== undefined) activePosition = await discoverPublicReplacementWithQuorum(readClients, config, activePosition, blockNumber, pendingKind, persistPosition)
	}
	const entryAccountingNeedsRecovery = activePosition.status === 'pending-entry' || (activePosition.status === 'recovery-required' && activePosition.actualEntryGasCostEth === '0')
	if (entryAccountingNeedsRecovery) {
		try {
			activePosition = (await recoverPendingEntryWithQuorum(readClients, config, activePosition, tokenDecimalsFromSnapshot(balancesBefore, activePosition.reportId))).position
			await persistPosition(activePosition)
			if (activePosition.status === 'recovery-required') throw new Error('Successful public entry receipt does not match the durable execution intent and executor event')
		} catch (error) {
			const targetBlockNumber = activePosition.entrySubmissionBlockNumber === undefined ? undefined : BigInt(activePosition.entrySubmissionBlockNumber) + 1n
			if (activePosition.entrySubmissionMode !== undefined && targetBlockNumber !== undefined && attemptHasFinality(blockNumber, targetBlockNumber)) {
				try {
					activePosition = await expireEntryWithQuorum(readClients, config, activePosition, blockNumber, dateFromBlockTimestamp(storedSnapshot.blockTimestamp).toISOString())
					await persistPosition(activePosition)
					return 'processed' as const
				} catch (expirationError) {
					throw new Error(`Pending position ${activePosition.reportId} could not prove non-inclusion after finality: ${errorMessage(expirationError)}`)
				}
			}
			await persistPosition({ ...activePosition, status: 'recovery-required' })
			throw new Error(`Pending position ${activePosition.reportId} entry receipt could not be recovered: ${errorMessage(error)}`)
		}
	}
	if (activePosition.status === 'closed' || activePosition.status === 'expired-not-included') return 'processed' as const
	if (activePosition.status === 'replaced') return 'processed' as const
	if (activePosition.status === 'recovery-required' && (activePosition.expiredTransactionAttempts?.length ?? 0) !== 0) {
		throw new Error(`Position ${activePosition.reportId} has a previously expired transaction with unexpected canonical evidence`)
	}
	if (lifecycleAttemptNeedsRecovery(activePosition)) {
		let recovered: PositionRecord
		try {
			recovered = await recoverPendingLifecycleWithQuorum(readClients, config, activePosition, blockNumber)
		} catch (error) {
			await persistPosition({ ...activePosition, status: 'recovery-required' })
			throw new Error(`Pending position ${activePosition.reportId} lifecycle receipt could not be recovered: ${errorMessage(error)}`)
		}
		await persistPosition(recovered)
		return recovered.status === 'closed' ? ('processed' as const) : ('progressed' as const)
	}
	if (activePosition.status === 'recovery-required' && activePosition.lifecycleReceiptRecovered) {
		throw new Error(`Position ${activePosition.reportId} has recovered lifecycle receipts but requires manual residual-asset reconciliation`)
	}
	if (game.currentReporter === zeroAddress || game.token1.toLowerCase() !== config.network.weth.toLowerCase() || game.token2.toLowerCase() !== activePosition.token.toLowerCase()) {
		await persistPosition({ ...activePosition, status: 'recovery-required' })
		throw new Error(`Open position ${activePosition.reportId} cannot be reconciled with stored OpenOracle state`)
	}
	const currentReporter = game.currentReporter.toLowerCase() === account.address.toLowerCase()
	const currentTime = (game.flags & OPEN_ORACLE_FLAG_TIME_TYPE) === 0n ? blockNumber : storedSnapshot.blockTimestamp
	const settlementEligible = currentReporter && game.settlementTimestamp === 0n && currentTime >= game.reportTimestamp + game.settlementTime
	if (currentReporter && game.settlementTimestamp === 0n && !settlementEligible) {
		return 'waiting' as const
	}
	const tokenDecimals = tokenDecimalsFromSnapshot(balancesBefore, activePosition.reportId)
	const expectedAttoWeth = parseDecimalWeth(activePosition.lockedWeth)
	const expectedToken = parseUnits(activePosition.lockedToken, tokenDecimals)
	const block = await client.getBlock({ blockNumber })
	if (block.hash == null || block.hash.toLowerCase() !== storedSnapshot.blockHash.toLowerCase()) throw new Error('Lifecycle quote and quorum snapshot use different canonical blocks')
	const signTransaction = account.signTransaction
	const startingNonce = await pendingNonceWithQuorum(readClients, config, account.address)
	const targetBlockNumber = blockNumber + 1n
	let lifecycleKind: NonNullable<PositionRecord['lifecycleKind']>
	let replacementAmount: bigint | undefined
	let replacementToken: Address | undefined
	let lifecycleCall: { data: Hex; gas: bigint; kind: 'settle' | 'withdraw-replacement'; to: Address }
	if (!currentReporter) {
		if (activePosition.reportAmount1 === undefined || activePosition.reportAmount2 === undefined || activePosition.reportFeePercentage === undefined) {
			await persistPosition({ ...activePosition, status: 'recovery-required' })
			throw new Error(`Position ${activePosition.reportId} predates automatic replacement-credit accounting and requires manual reconciliation`)
		}
		const replacementAmounts = immediateReplacementAmounts(activePosition, reportPath)
		if (replacementAmounts === undefined) throw new Error(`Position ${activePosition.reportId} replacement transition is not yet available in the canonical dispute path`)
		const credit = replacementCredit({
			feePercentage: BigInt(activePosition.reportFeePercentage),
			newAmount1: replacementAmounts.amount1,
			newAmount2: replacementAmounts.amount2,
			oldAmount1: BigInt(activePosition.reportAmount1),
			oldAmount2: BigInt(activePosition.reportAmount2),
		})
		replacementAmount = credit.amount
		replacementToken = credit.token === 'token1' ? config.network.weth : activePosition.token
		const holderBalance = credit.token === 'token1' ? balancesBefore.holderAttoWeth : balancesBefore.holderToken
		const allowance = credit.token === 'token1' ? balancesBefore.internalAllowanceAttoWeth : balancesBefore.internalAllowanceToken
		if (holderBalance < replacementAmount + 1n) throw new Error(`Position ${activePosition.reportId} replacement credit is not yet available`)
		if (allowance < replacementAmount) {
			throw new Error(`Position ${activePosition.reportId} replacement credit exceeds its executor internal allowance`)
		}
		lifecycleKind = 'replacement-credit'
		lifecycleCall = {
			data: encodeFunctionData({
				abi: openOracleArbitrageExecutorAbi,
				functionName: 'withdrawReplacementCredit',
				args: [
					{
						amount: replacementAmount,
						expectedParentBlockHash: storedSnapshot.blockHash,
						openOracle: config.openOracle,
						parentBlockNumber: blockNumber,
						token: replacementToken,
					},
					id,
				],
			}),
			gas: 450_000n,
			kind: 'withdraw-replacement',
			to: executor,
		}
	} else {
		lifecycleKind = 'settlement'
		const willSettle = game.settlementTimestamp === 0n
		const withdrawalMismatch = lifecycleWithdrawalMismatch({
			currentReporter,
			expectedToken,
			expectedAttoWeth,
			holderToken: balancesBefore.holderToken,
			holderAttoWeth: balancesBefore.holderAttoWeth,
			willSettle,
		})
		if (withdrawalMismatch !== undefined) {
			await persistPosition({ ...activePosition, status: 'recovery-required' })
			throw new Error(`Position ${activePosition.reportId} cannot execute atomically: ${withdrawalMismatch}`)
		}
		const allowanceMismatch = lifecycleAllowanceMismatch({ token1: balancesBefore.internalAllowanceAttoWeth, token2: balancesBefore.internalAllowanceToken }, { token1: expectedAttoWeth, token2: expectedToken })
		if (allowanceMismatch !== undefined) throw new Error(`Position ${activePosition.reportId} cannot execute atomically: ${allowanceMismatch}`)
		lifecycleCall = {
			data: encodeFunctionData({
				abi: openOracleArbitrageExecutorAbi,
				functionName: 'settleAndWithdraw',
				args: [
					{
						amount1: expectedAttoWeth,
						amount2: expectedToken,
						expectedParentBlockHash: storedSnapshot.blockHash,
						openOracle: config.openOracle,
						parentBlockNumber: blockNumber,
					},
					getOpenOracleGameTuple(game),
					getOpenOracleHelperTuple(report.helper),
				],
			}),
			gas: BigInt(game.callbackGasLimit) + 900_000n,
			kind: 'settle',
			to: executor,
		}
	}
	const signed = await prepareSignedTransaction({
		baseFeePerGas: block.baseFeePerGas ?? 0n,
		blockNumber,
		chainId: config.network.chain.id,
		data: lifecycleCall.data,
		from: account.address,
		gasEstimate: lifecycleCall.gas,
		lastValidBlockNumber: lifecycleLastValidBlockNumber(targetBlockNumber),
		nonce: startingNonce,
		signTransaction,
		to: lifecycleCall.to,
	})
	const lifecyclePosition = {
		...activePosition,
		lifecycleKind,
		lifecycleSubmissionBlockNumber: blockNumber.toString(),
		lifecycleSubmissionMode: config.submission.mode,
		lifecycleTargetBlockNumber: targetBlockNumber.toString(),
		lifecycleTokenDecimals: tokenDecimals.toString(),
		lifecycleTransactionIntent: durableTransactionIntent(signed.transaction),
		lifecycleTransactionNonce: startingNonce.toString(),
		lifecycleTransactionHashes: [signed.hash],
		lifecycleUpdatedAt: new Date().toISOString(),
		lifecycleWalletTokenBefore: undefined,
		lifecycleWalletWethBefore: undefined,
		replacementCreditAmount: replacementAmount?.toString(),
		replacementCreditToken: replacementToken,
		status: 'withdrawing' as const,
	} satisfies PositionRecord
	if (config.submission.mode === 'public') {
		await persistPosition(lifecyclePosition)
		const submission = await submitContractTransaction(client, wallet, config, signed, { estimatedNetProfitEth: undefined, kind: lifecycleCall.kind, reportId: activePosition.reportId }, () => false, track)
		const { receipt } = await waitForTrackedTransaction(client, wallet, config, submission, track, replacement =>
			persistPosition({
				...lifecyclePosition,
				lifecycleTransactionHashes: [replacement.transaction.hash],
				status: 'recovery-required',
			}),
		)
		const observedPosition = {
			...lifecyclePosition,
			lifecycleTransactionHashes: [receipt.transactionHash],
			status: 'recovery-required' as const,
		}
		await persistPosition(observedPosition)
		try {
			const recovered = await recoverPendingLifecycleWithQuorum(readClients, config, observedPosition, receipt.blockNumber)
			await persistPosition(recovered)
			return recovered.status === 'closed' ? ('processed' as const) : ('progressed' as const)
		} catch (error) {
			throw new Error(`Pending position ${activePosition.reportId} public lifecycle receipt could not be recovered: ${errorMessage(error)}`)
		}
	}
	const relaySimulations = await simulateSignedBundleEveryRelay({
		address: account.address,
		minimumSuccessfulRelays: config.submission.minimumBundleRelaySuccesses,
		relayUrls: config.submission.relayUrls,
		signMessage,
		stateBlockNumber: blockNumber,
		targetBlockNumber,
		transactions: [signed.serializedTransaction],
	})
	await guardedTransactionSubmission(
		() => false,
		async () => {
			if ((await currentBlockNumberWithQuorum(readClients, config, 'lifecycle submission head')) !== blockNumber) throw new Error('Position lifecycle bundle quote expired before submission')
			const canonicalHash = await canonicalBlockHashWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], 'lifecycle submission', blockNumber)
			if (canonicalHash.toLowerCase() !== storedSnapshot.blockHash.toLowerCase()) throw new Error('Position lifecycle canonical parent changed before submission')
		},
		() =>
			journaledSubmission(
				() => persistPosition(lifecyclePosition),
				() =>
					submitConfiguredSignedBundle(config.submission, {
						address: account.address,
						relayUrls: relaySimulations.successful.map(result => result.relayUrl),
						signMessage,
						targetBlockNumber,
						transactions: [signed.serializedTransaction],
					}),
			),
	)
	while ((await client.getBlockNumber()) < targetBlockNumber) await Bun.sleep(Math.min(config.pollMilliseconds, 1_000))
	try {
		await finalizeSubmittedLifecycleAttempt(lifecyclePosition, pending => recoverPendingLifecycleWithQuorum(readClients, config, pending, targetBlockNumber), persistPosition)
	} catch (error) {
		throw new Error(`Pending position ${activePosition.reportId} lifecycle receipt could not be recovered: ${errorMessage(error)}`)
	}
	return 'progressed' as const
}
