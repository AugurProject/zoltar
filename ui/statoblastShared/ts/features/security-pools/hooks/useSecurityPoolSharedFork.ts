import { fork as transactionCopy } from '../../../copy/securityPoolTransactions.js'
import { useSignal } from '@preact/signals'
import { useEffect, useMemo, useRef } from 'preact/hooks'
import { formatUnits, getAddress, isAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	buildSecurityPoolForkChoiceRequest,
	buildSecurityPoolForkPreparationRequest,
	buildSecurityPoolForkStartRequest,
	buildSecurityPoolForkFinalizeRequest,
	buildSecurityPoolForkRecoveryRequest,
	buildSecurityPoolRecoveryRightsTransferRequest,
	loadSecurityPoolForkSnapshot,
	loadSecurityPoolUnclaimedRepairAuctionBids,
	buildSecurityPoolAuctionClaimAllRequest,
	MAX_REPAIR_AUCTION_CLAIM_BATCH,
	type SecurityPoolForkSnapshot,
} from '@zoltar/statoblast-shared/statoblast/securityPool'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getActiveBackend, getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { currentStateCheckFailed } from '@zoltar/ui-core-shared/copy/transaction.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { decodeStoredValue } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import { withStatoblastRequestTimeout } from '../../../protocol/requestTimeout.js'
import { securityPoolReadClient, type SecurityPoolAccountSnapshot, type SecurityPoolTransaction } from '../../../protocol/securityPool.js'
import { loadSharedForkOutcome, loadSecurityPoolSourceRecovery, buildSecurityPoolRecoveryPreparation } from '../../../protocol/securityPoolSharedFork.js'
import { loadSecurityPoolBranchAuction } from '../../../protocol/securityPoolRepairAuction.js'
import { securityPoolAmountOrUndefined, securityPoolUnsignedId } from '../lib/draft.js'
import { reviewBalance, type ReviewRow } from '../lib/reviewRows.js'
import type { SecurityPoolActions } from '../components/SecurityPoolControls.js'
import * as copy from '../../../copy/securityPoolSharedFork.js'
import { connect } from '../../../copy/securityPool.js'
import * as recoveryCopy from '../../../copy/forkRecovery.js'
import { branchPriceTarget } from './useSecurityPoolPrice.js'
import { statoblastDisplayCache } from '../../../protocol/statoblastPageCache.js'
import { forkDisplayCache, recoveryDisplayCache, storedRecoverySnapshot } from '../../../protocol/forkDisplayCache.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'

export type SecurityPoolSharedForkParameters = {
	snapshot: SecurityPoolAccountSnapshot | undefined
	presentationSnapshot?: SecurityPoolAccountSnapshot | undefined
	actions: Pick<SecurityPoolActions, 'scope' | 'busy' | 'ownerReason' | 'runSecurityPoolAction'>
	openUniverse: (universeId: bigint) => void
	bidder: Address | undefined
}

function branchDisplayCache(profile: NetworkProfile, pool: Address, owner: Address, universeId: bigint, outcomeIndex?: bigint) {
	return statoblastDisplayCache(profile, { universeId, owner, page: `fork-branch:${pool.toLowerCase()}:${outcomeIndex ?? 'chosen'}` }, value =>
		decodeStoredValue(value, read => ({ securityPool: pool, owner, universeId: read.bigint('universeId'), blockHash: read.string('blockHash'), started: read.boolean('started'), reportingDeadline: read.optional('reportingDeadline', read.bigint) })),
	)
}

export function useSecurityPoolSharedFork({ snapshot, presentationSnapshot = snapshot, actions, openUniverse, bidder }: SecurityPoolSharedForkParameters) {
	const securityPool = snapshot?.owner === zeroAddress ? undefined : snapshot
	const backend = getActiveBackend()
	const profile = getActiveNetworkProfile()
	const sourceInput = useSignal('')
	const outcomeInput = useSignal('')
	const questionInput = useSignal('')
	const sharesInput = useSignal('')
	const recipientInput = useSignal('')
	const invalidRightsInput = useSignal('0')
	const yesRightsInput = useSignal('0')
	const noRightsInput = useSignal('0')
	const loaded = useSignal<{ backend: typeof backend; key: string; state?: SecurityPoolForkSnapshot; readAt?: number; outcome?: Awaited<ReturnType<typeof loadSharedForkOutcome>>; claims?: SourceAuctionClaims; error?: string } | undefined>(undefined)
	const savedFork = useSignal<{ backend: typeof backend; key: string; state: SecurityPoolForkSnapshot; readAt: number } | undefined>(undefined)
	const retry = useSignal(0)
	const recovered = useSignal<{ backend: typeof backend; scope: string; key: string; source?: Awaited<ReturnType<typeof loadSecurityPoolSourceRecovery>> | undefined; readAt?: number | undefined; error?: string } | undefined>(undefined)
	const recoveryRetry = useSignal(0)
	const clearRecoveryDraft = () => {
		sharesInput.value = ''
		recipientInput.value = ''
		invalidRightsInput.value = '0'
		yesRightsInput.value = '0'
		noRightsInput.value = '0'
	}
	const draftIdentity = useRef<{ backend: typeof backend; key: string } | undefined>(undefined)
	useEffect(() => {
		const identity = presentationSnapshot === undefined ? undefined : `${presentationSnapshot.securityPool}:${presentationSnapshot.owner}:${presentationSnapshot.universeId}`
		const sameBackend = draftIdentity.current?.backend === backend
		if (sameBackend && (identity === undefined || draftIdentity.current?.key === identity)) return
		draftIdentity.current = identity === undefined ? undefined : { backend, key: identity }
		sourceInput.value = presentationSnapshot?.universeId.toString() ?? ''
		outcomeInput.value = ''
		questionInput.value = ''
		clearRecoveryDraft()
	}, [backend, presentationSnapshot?.securityPool, presentationSnapshot?.owner, presentationSnapshot?.universeId])
	const universeId = securityPoolUnsignedId(sourceInput.value, 248)
	const outcomeIndex = securityPoolUnsignedId(outcomeInput.value)
	const questionId = securityPoolUnsignedId(questionInput.value)
	const shares = securityPoolAmountOrUndefined(sharesInput.value, securityPool?.collateral.decimals ?? 18)
	const recipient = isAddress(recipientInput.value.trim()) ? getAddress(recipientInput.value.trim()) : undefined
	const invalidRights = securityPoolAmountOrUndefined(invalidRightsInput.value, securityPool?.collateral.decimals ?? 18)
	const yesRights = securityPoolAmountOrUndefined(yesRightsInput.value, securityPool?.collateral.decimals ?? 18)
	const noRights = securityPoolAmountOrUndefined(noRightsInput.value, securityPool?.collateral.decimals ?? 18)
	const transferAmounts = invalidRights === undefined || yesRights === undefined || noRights === undefined ? undefined : ([invalidRights, yesRights, noRights] satisfies readonly [bigint, bigint, bigint])
	const branchCache = useMemo(() => {
		if (presentationSnapshot === undefined || presentationSnapshot.owner === zeroAddress || universeId === undefined) return undefined
		const { securityPool: pool, owner } = presentationSnapshot
		return branchDisplayCache(profile, pool, owner, universeId, outcomeIndex)
	}, [profile, presentationSnapshot?.securityPool, presentationSnapshot?.owner, universeId, outcomeIndex])
	const displayCache = useMemo(() => {
		if (presentationSnapshot === undefined || presentationSnapshot.owner === zeroAddress || universeId === undefined) return undefined
		return forkDisplayCache(profile, presentationSnapshot.securityPool, presentationSnapshot.owner, universeId, outcomeIndex)
	}, [profile, presentationSnapshot?.securityPool, presentationSnapshot?.owner, universeId, outcomeIndex])
	const presentationKey = `${presentationSnapshot?.securityPool}:${presentationSnapshot?.owner}:${universeId}:${outcomeIndex}`
	const key = `${securityPool?.securityPool}:${securityPool?.owner}:${universeId}:${outcomeIndex}:${securityPool?.blockHash}:${retry.value}`
	useEffect(() => {
		const abort = new AbortController()
		loaded.value = undefined
		if (securityPool !== undefined && universeId !== undefined) {
			const client = withStatoblastRequestTimeout(createConnectedReadClient(), copy.readTimeout, abort.signal)
			const read = async () => {
				const state = await loadSecurityPoolForkSnapshot({ client: securityPoolReadClient(client), securityPool: securityPool.securityPool, owner: securityPool.owner, universeId, ...(outcomeIndex === undefined ? {} : { outcomeIndex }) })
				const [outcome, claims] = await Promise.all([state.forkTime === 0n || state.branch === undefined ? undefined : loadSharedForkOutcome(client, state, state.branch.outcomeIndex), state.forkTime === 0n ? undefined : loadSourceAuctionClaims(client, state)])
				return { state, outcome, claims }
			}
			void read()
				.then(({ state, outcome, claims }) => {
					if (abort.signal.aborted || getActiveBackend() !== backend) return
					const child = branchPriceTarget(state)
					const block = { number: state.blockNumber, timestamp: state.timestamp }
					if (state.forkTime > 0n) {
						const { chainId, securityPool, owner, universeId, timestamp, forkTime, choiceDeadline, activationDeadline, choice, branch } = state
						const display = {
							chainId,
							securityPool,
							owner,
							universeId,
							timestamp,
							forkTime,
							choiceDeadline,
							activationDeadline,
							choice,
							branch: branch === undefined ? undefined : { universeId: branch.universeId, outcomeIndex: branch.outcomeIndex, prepared: branch.prepared, started: branch.started, ready: branch.ready, parentCash: branch.parentCash, recoveryAttoRep: branch.recoveryAttoRep },
						}
						displayCache?.write(display, block)
						if (outcomeIndex !== undefined && choice.recorded && choice.outcomeIndex === outcomeIndex) forkDisplayCache(profile, securityPool, owner, universeId).write(display, block)
					}
					if (child !== undefined && state.forkTime > 0n) {
						branchCache?.write(child, block)
						if (outcomeIndex !== undefined && state.choice.recorded && state.choice.outcomeIndex === outcomeIndex) branchDisplayCache(profile, state.securityPool, state.owner, state.universeId).write(child, block)
					}
					const readAt = Date.now()
					loaded.value = { backend, key, state, readAt, ...(outcome === undefined ? {} : { outcome }), ...(claims === undefined ? {} : { claims }) }
					savedFork.value = { backend, key: presentationKey, state, readAt }
				})
				.catch(error => {
					if (!abort.signal.aborted && getActiveBackend() === backend) loaded.value = { backend, key, error: getErrorMessage(error, copy.forkReadFailed) }
				})
		}
		return () => abort.abort()
	}, [backend, key, branchCache, displayCache])
	const current = loaded.value?.backend === backend && loaded.value.key === key ? loaded.value : undefined
	const state = current?.state
	const savedState = savedFork.value?.backend === backend && savedFork.value.key === presentationKey ? savedFork.value : undefined
	const restoredState = useMemo(() => (state === undefined && savedState === undefined ? displayCache?.read() : undefined), [displayCache, state, savedState])
	const displayedState = state ?? savedState?.state ?? restoredState?.value
	const savedBranch = useMemo(() => (state === undefined ? branchCache?.read()?.value : undefined), [branchCache, key, state])
	const recoveryScope = `${presentationSnapshot?.securityPool}:${presentationSnapshot?.owner}:${universeId}:${questionId}`
	const recoveryCache = useMemo(() => {
		if (presentationSnapshot === undefined || presentationSnapshot.owner === zeroAddress || universeId === undefined || questionId === undefined) return undefined
		return recoveryDisplayCache(profile, presentationSnapshot.securityPool, presentationSnapshot.owner, universeId, questionId)
	}, [profile, recoveryScope])
	const recoveryKey = `${securityPool?.blockHash}:${state?.blockHash}:${retry.value}:${recoveryRetry.value}`
	const displayedRecovery = recovered.value?.backend === backend && recovered.value.scope === recoveryScope ? recovered.value : undefined
	const restoredRecovery = useMemo(() => recoveryCache?.read(), [recoveryCache])
	const recoveryState = state !== undefined && displayedRecovery?.key === recoveryKey ? displayedRecovery : undefined
	useEffect(() => {
		const abort = new AbortController()
		if (state !== undefined && state.forkTime > 0n && questionId !== undefined) {
			const client = withStatoblastRequestTimeout(createConnectedReadClient(), recoveryCopy.recoveryReadTimeout, abort.signal)
			void loadSecurityPoolSourceRecovery(client, state, questionId)
				.then(source => {
					if (abort.signal.aborted || getActiveBackend() !== backend) return
					recoveryCache?.write(storedRecoverySnapshot(source), { number: state.blockNumber, timestamp: state.timestamp })
					recovered.value = { backend, scope: recoveryScope, key: recoveryKey, source, readAt: Date.now() }
				})
				.catch(error => {
					if (!abort.signal.aborted && getActiveBackend() === backend) recovered.value = { backend, scope: recoveryScope, key: recoveryKey, source: displayedRecovery?.source, readAt: displayedRecovery?.readAt, error: getErrorMessage(error, recoveryCopy.recoveryReadFailed) }
				})
		}
		return () => abort.abort()
	}, [backend, recoveryScope, recoveryKey, recoveryCache])
	const recovery = recoveryState?.source
	const pendingReason = universeId === undefined ? transactionCopy.sourceRequired : transactionCopy.checkingStatus
	const walletReason = bidder === undefined ? connect : undefined
	const ownerReason = walletReason ?? actions.ownerReason
	const baseReason = current?.error ?? (state === undefined ? pendingReason : undefined)
	const forkReason = baseReason ?? (state?.forkTime === 0n ? copy.noFork : undefined)
	const branchReason = forkReason ?? (state?.branch === undefined || current?.outcome?.outcomeLabel === undefined ? transactionCopy.chooseOutcome : undefined)
	const publicBranchReason = walletReason ?? branchReason
	const claims = current?.claims
	const unclaimedBids = claims?.unclaimed ?? 0n
	const chooseReason =
		ownerReason ??
		branchReason ??
		(state?.choice.recorded ? transactionCopy.choiceRecorded : undefined) ??
		(state !== undefined && state.timestamp >= state.choiceDeadline ? transactionCopy.choiceWindowClosed : undefined) ??
		// The source ledger refuses to export a choice while any of the owner's auction bids there is unclaimed.
		(unclaimedBids > 0n ? copy.claimBidsFirst : undefined) ??
		(securityPool !== undefined && universeId === securityPool.universeId && !securityPool.positions.some(position => position.rep > 0n && position.commitment > 0n) ? transactionCopy.noPledgedRep : undefined)
	const custodyPreparationReason = (selected: SecurityPoolForkSnapshot) => (selected.branch?.prepared ? transactionCopy.capitalPrepared : undefined)
	const migrationReason = (selected: SecurityPoolForkSnapshot) => {
		if (selected.timestamp < selected.choiceDeadline) return transactionCopy.waitForChoiceDeadline
		return selected.branch?.started ? transactionCopy.migrationStarted : undefined
	}
	const prepareBranchReason = publicBranchReason ?? (state && custodyPreparationReason(state))
	const recheckStage = (reasonFor: (latest: SecurityPoolForkSnapshot) => string | undefined, after: string) => async (latest: SecurityPoolForkSnapshot) => {
		const reason = latest.forkTime === 0n || latest.branch === undefined ? transactionCopy.contextChanged : reasonFor(latest)
		if (reason !== undefined) throw new Error(reason)
		const branch = latest.branch
		let before: string = copy.branchStates.unprepared
		if (branch?.started) before = copy.branchStates.waiting
		else if (branch?.prepared) before = copy.branchStates.chosen
		return [{ label: copy.state, value: `${before} → ${after}` }]
	}
	const startReason = publicBranchReason ?? (state && migrationReason(state))
	const activationReason = (selected: SecurityPoolForkSnapshot) => {
		if (!selected.branch?.prepared) return transactionCopy.prepareCapitalFirst
		if (selected.timestamp < selected.activationDeadline) return transactionCopy.waitUntilActivation
		return selected.branch.ready ? transactionCopy.branchActive : undefined
	}
	const finalizeReason = publicBranchReason ?? (state && activationReason(state))
	const sourceReason =
		ownerReason ??
		forkReason ??
		(questionId === undefined ? recoveryCopy.selectRecoveryQuestion : undefined) ??
		recoveryState?.error ??
		(recovery === undefined ? recoveryCopy.loadingRecoveryRights : undefined) ??
		(recovery !== undefined && recovery.pool !== zeroAddress && !recovery.eligible ? recoveryCopy.closedRecovery : undefined)
	const recoveryDeadlineReason = state !== undefined && state.timestamp < state.choiceDeadline ? recoveryCopy.waitForRecovery : undefined
	const prepareReason = sourceReason ?? recoveryDeadlineReason ?? (recovery?.pool !== zeroAddress ? recoveryCopy.recoveryAlreadyPrepared : undefined)
	const recoverReason =
		sourceReason ??
		(recovery?.pool === zeroAddress ? recoveryCopy.prepareRecoveryFirst : undefined) ??
		recoveryDeadlineReason ??
		(shares === undefined || shares === 0n ? recoveryCopy.enterRecoveryAmount : undefined) ??
		(recovery !== undefined && shares !== undefined && shares > recovery.availableShares ? recoveryCopy.insufficientRecovery : undefined)
	const transferReason =
		sourceReason ??
		(recovery?.pool === zeroAddress ? recoveryCopy.prepareRecoveryFirst : undefined) ??
		(recipient === undefined || recipient === zeroAddress || recipient === state?.owner ? recoveryCopy.enterRecoveryRecipient : undefined) ??
		(transferAmounts === undefined || transferAmounts.every(amount => amount === 0n) || transferAmounts.some(amount => amount >= 1n << 256n) ? recoveryCopy.enterTransferAmounts : undefined) ??
		(recovery !== undefined && transferAmounts?.some((amount, index) => amount > (recovery.rights[index] ?? 0n)) ? recoveryCopy.insufficientTransferRights : undefined)

	let claimBidsReason = forkReason ?? (unclaimedBids === 0n ? copy.noBidsToClaim : undefined) ?? claims?.error ?? (claims?.auction === undefined || claims.auction.claimableBidIds.length === 0 ? copy.claimAfterClose : undefined)
	if (claimBidsReason === undefined && claims?.auction !== undefined) {
		try {
			buildSecurityPoolAuctionClaimAllRequest(claims.auction, claims.auction.claimableBidIds)
		} catch (error) {
			claimBidsReason = getErrorMessage(error, copy.claimBidsFirst)
		}
	}
	const run = (action: string, title: string, reason: string | undefined, build: (selected: SecurityPoolForkSnapshot) => SecurityPoolTransaction, check?: (latest: SecurityPoolForkSnapshot, client: ReadClient) => Promise<readonly ReviewRow[] | void>) =>
		actions.runSecurityPoolAction(action, title, () => {
			if (reason !== undefined || state === undefined) throw new Error(reason ?? transactionCopy.stateUnavailable)
			const selected = state
			const request = build(selected)
			let reviewRows: readonly ReviewRow[] = []
			return {
				...request,
				readReviewRows: () => reviewRows,
				validateBeforeSubmit: async () => {
					if (getActiveBackend() !== backend) throw new Error(transactionCopy.walletChanged)
					const client = withStatoblastRequestTimeout(createConnectedReadClient(), currentStateCheckFailed)
					const latest = await loadSecurityPoolForkSnapshot({ client: securityPoolReadClient(client), securityPool: selected.securityPool, owner: selected.owner, universeId: selected.universeId, ...(selected.branch === undefined ? {} : { outcomeIndex: selected.branch.outcomeIndex }) })
					if (latest.chainId !== selected.chainId || latest.controller !== selected.controller) throw new Error(transactionCopy.contextChanged)
					reviewRows = (await check?.(latest, client)) ?? []
				},
			}
		})
	const base = (selected: SecurityPoolForkSnapshot) => ({ owner: selected.owner, controller: selected.controller, universeId: selected.universeId })
	const publicBase = (selected: SecurityPoolForkSnapshot) => {
		if (bidder === undefined) throw new Error(connect)
		return { ...base(selected), owner: bidder }
	}
	return {
		state,
		displayedState,
		displayedAt: current?.readAt ?? savedState?.readAt ?? restoredState?.savedAt,
		forkError: current?.error,
		retryFork: () => retry.value++,
		savedBranch,
		recovery: displayedRecovery?.source ?? restoredRecovery?.value,
		recoveryError: recoveryState?.error,
		recoveryReadAt: displayedRecovery?.readAt ?? restoredRecovery?.savedAt,
		recoveryLoading: questionId !== undefined && presentationSnapshot?.owner !== zeroAddress && (state === undefined ? current?.error === undefined : state.forkTime > 0n && recoveryState === undefined),
		retryRecovery: () => recoveryRetry.value++,
		outcome: current?.outcome,
		error: current?.error,
		loading: current === undefined,
		sourceInput: sourceInput.value,
		setSource: (v: string) => {
			sourceInput.value = v
		},
		outcomeInput: outcomeInput.value,
		setOutcome: (v: string) => {
			outcomeInput.value = v
		},
		questionInput: questionInput.value,
		setQuestion: (v: string) => {
			if (securityPoolUnsignedId(v) !== questionId) clearRecoveryDraft()
			questionInput.value = v
		},
		sharesInput: sharesInput.value,
		setShares: (v: string) => {
			sharesInput.value = v
		},
		recipientInput: recipientInput.value,
		setRecipient: (v: string) => {
			recipientInput.value = v
		},
		invalidRightsInput: invalidRightsInput.value,
		setInvalidRights: (v: string) => {
			invalidRightsInput.value = v
		},
		yesRightsInput: yesRightsInput.value,
		setYesRights: (v: string) => {
			yesRightsInput.value = v
		},
		noRightsInput: noRightsInput.value,
		setNoRights: (v: string) => {
			noRightsInput.value = v
		},
		transferReason,
		chooseReason,
		unclaimedBids,
		claimBidsReason,
		claimBids: () =>
			actions.runSecurityPoolAction('claimSecurityPoolForkAuctionBids', copy.claimBids, () => {
				const auction = claims?.auction
				if (claimBidsReason !== undefined || auction === undefined) throw new Error(claimBidsReason ?? copy.noBidsToClaim)
				return {
					...buildSecurityPoolAuctionClaimAllRequest(auction, auction.claimableBidIds),
					reviewDescription: copy.claimBidsReview(Math.min(auction.claimableBidIds.length, MAX_REPAIR_AUCTION_CLAIM_BATCH), auction.claimableBidIds.length),
					validateBeforeSubmit: async () => {
						if (getActiveBackend() !== backend) throw new Error(transactionCopy.walletChanged)
						const client = withStatoblastRequestTimeout(createConnectedReadClient(), currentStateCheckFailed)
						const latest = await loadSecurityPoolBranchAuction(client, auction.securityPool, auction.bidder, auction.universeId)
						if (latest.chainId !== auction.chainId || latest.capitalLedger !== auction.capitalLedger) throw new Error(transactionCopy.contextChanged)
						// Bids someone else claimed meanwhile are skipped on chain.
						buildSecurityPoolAuctionClaimAllRequest(latest, latest.claimableBidIds)
					},
				}
			}),
		prepareBranchReason,
		startReason,
		finalizeReason,
		prepareReason,
		recoverReason,
		openReason: walletReason ?? (state?.branch?.ready ? undefined : copy.openAfterActivation),
		open: () => {
			if (state?.branch?.ready) openUniverse(state.branch.universeId)
		},
		choose: () =>
			run(
				'chooseSecurityPoolFork',
				transactionCopy.commitBranch,
				chooseReason,
				selected => {
					const outcomeLabel = current?.outcome?.outcomeLabel
					if (selected.branch === undefined || outcomeLabel === undefined) throw new Error(transactionCopy.selectBranch)
					return {
						...buildSecurityPoolForkChoiceRequest({ ...base(selected), outcomeIndex: selected.branch.outcomeIndex }),
						reviewDescription: copy.choiceReview(outcomeLabel),
					}
				},
				async latest => {
					if (latest.forkTime === 0n || latest.branch === undefined || latest.choice.recorded || latest.timestamp >= latest.choiceDeadline) throw new Error(transactionCopy.choiceUnavailable)
					const outcomeLabel = current?.outcome?.outcomeLabel
					if (outcomeLabel === undefined) throw new Error(copy.forkReadFailed)
					return [{ label: copy.yourBranch, value: `${copy.unchosen} → ${outcomeLabel}` }]
				},
			),
		prepareBranch: () =>
			run(
				'prepareSecurityPoolFork',
				copy.prepareBranch,
				prepareBranchReason,
				selected => {
					if (selected.branch === undefined) throw new Error(transactionCopy.selectBranch)
					return { ...buildSecurityPoolForkPreparationRequest({ ...publicBase(selected), outcomeIndex: selected.branch.outcomeIndex }), reviewDescription: transactionCopy.prepareReview }
				},
				recheckStage(custodyPreparationReason, copy.branchStates.chosen),
			),
		start: () =>
			run(
				'startSecurityPoolFork',
				copy.start,
				startReason,
				selected => {
					if (selected.branch === undefined) throw new Error(transactionCopy.selectBranch)
					return { ...buildSecurityPoolForkStartRequest({ ...publicBase(selected), outcomeIndex: selected.branch.outcomeIndex }), reviewDescription: transactionCopy.startReview }
				},
				recheckStage(migrationReason, copy.branchStates.waiting),
			),
		finalize: () =>
			run(
				'finalizeSecurityPoolFork',
				copy.finalize,
				finalizeReason,
				selected => {
					if (selected.branch === undefined) throw new Error(transactionCopy.selectBranch)
					return { ...buildSecurityPoolForkFinalizeRequest({ ...publicBase(selected), universeId: selected.branch.universeId }), reviewDescription: transactionCopy.activateReview }
				},
				recheckStage(activationReason, copy.branchStates.active),
			),
		prepare: () =>
			run(
				'prepareSecurityPoolRecovery',
				copy.prepare,
				prepareReason,
				selected => {
					if (recovery === undefined) throw new Error(recoveryCopy.questionUnavailable)
					return { ...buildSecurityPoolRecoveryPreparation(selected, recovery), reviewDescription: recoveryCopy.prepareRecoveryReview }
				},
				async (latest, client) => {
					if (questionId === undefined || recovery === undefined) throw new Error(recoveryCopy.questionUnavailable)
					const fresh = await loadSecurityPoolSourceRecovery(client, latest, questionId)
					if (latest.forkTime === 0n || latest.timestamp < latest.choiceDeadline || fresh.pool !== zeroAddress || fresh.source !== recovery.source) throw new Error(recoveryCopy.prepareRecoveryChanged)
					return [{ label: copy.recoveryPreparation, value: `${copy.branchStates.unprepared} → ${copy.recoveryPrepared}` }]
				},
			),
		transfer: () =>
			run(
				'transferSecurityPoolRecoveryRights',
				copy.transfer,
				transferReason,
				selected => {
					if (questionId === undefined || recovery === undefined || recipient === undefined || transferAmounts === undefined) throw new Error(recoveryCopy.enterTransferDraft)
					const decimals = securityPool?.collateral.decimals ?? 18
					return {
						...buildSecurityPoolRecoveryRightsTransferRequest({ owner: selected.owner, shareToken: recovery.shareToken, universeId: selected.universeId, recipient, amountsAttoShares: transferAmounts }),
						reviewDescription: recoveryCopy.reviewRecoveryTransfer({ invalid: formatUnits(transferAmounts[0], decimals), yes: formatUnits(transferAmounts[1], decimals), no: formatUnits(transferAmounts[2], decimals), question: formatQuestionIdHex(questionId), universe: selected.universeId, recipient }),
					}
				},
				async (latest, client) => {
					if (questionId === undefined || recovery === undefined || transferAmounts === undefined) throw new Error(recoveryCopy.transferUnavailable)
					const fresh = await loadSecurityPoolSourceRecovery(client, latest, questionId)
					if (latest.forkTime === 0n || !fresh.eligible || fresh.pool === zeroAddress || fresh.shareToken !== recovery.shareToken || transferAmounts.some((amount, index) => amount > (fresh.rights[index] ?? 0n))) throw new Error(recoveryCopy.transferChanged)
					return [copy.invalidAvailable, copy.yesAvailable, copy.noAvailable].flatMap((label, index) => {
						const before = fresh.rights[index] ?? 0n
						const amount = transferAmounts[index] ?? 0n
						return amount === 0n ? [] : [reviewBalance(label, before, before - amount, securityPool?.collateral.decimals ?? 18)]
					})
				},
			),

		recover: () =>
			run(
				'recoverSecurityPoolSource',
				copy.recover,
				recoverReason,
				selected => {
					if (questionId === undefined || shares === undefined) throw new Error(recoveryCopy.enterRecoveryAmount)
					return {
						...buildSecurityPoolForkRecoveryRequest({ ...base(selected), questionId, shares }),
						reviewDescription: recoveryCopy.reviewRecoveryClaim(formatUnits(shares, securityPool?.collateral.decimals ?? 18), formatQuestionIdHex(questionId)),
					}
				},
				async (latest, client) => {
					if (questionId === undefined || recovery === undefined || shares === undefined) throw new Error(recoveryCopy.recoveryAmountUnavailable)
					const fresh = await loadSecurityPoolSourceRecovery(client, latest, questionId)
					if (latest.forkTime === 0n || latest.timestamp < latest.choiceDeadline || !fresh.eligible || fresh.availableShares < shares || fresh.pool === zeroAddress || fresh.shareToken !== recovery.shareToken) throw new Error(recoveryCopy.recoveryChanged)
					return [reviewBalance(copy.available, fresh.availableShares, fresh.availableShares - shares, securityPool?.collateral.decimals ?? 18)]
				},
			),
	}
}

type SourceAuctionClaims = { unclaimed: bigint; auction?: Awaited<ReturnType<typeof loadSecurityPoolBranchAuction>> | undefined; error?: string | undefined }
/** The owner's unclaimed repair auction bids in the source universe, and the auction to claim them in when any remain. */
async function loadSourceAuctionClaims(client: ReturnType<typeof createConnectedReadClient>, state: SecurityPoolForkSnapshot): Promise<SourceAuctionClaims> {
	const unclaimed = await loadSecurityPoolUnclaimedRepairAuctionBids({ client: securityPoolReadClient(client), securityPool: state.securityPool, owner: state.owner, universeId: state.universeId, blockNumber: state.blockNumber })
	if (unclaimed === 0n) return { unclaimed }
	// The count alone blocks the choice; an auction that fails to load only disables the offered claim.
	try {
		return { unclaimed, auction: await loadSecurityPoolBranchAuction(client, state.securityPool, state.owner, state.universeId) }
	} catch (error) {
		return { unclaimed, error: getErrorMessage(error, copy.claimLoadError) }
	}
}
