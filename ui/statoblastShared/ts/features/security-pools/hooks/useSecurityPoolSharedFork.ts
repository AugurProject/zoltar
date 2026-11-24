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
	type SecurityPoolForkSnapshot,
} from '@zoltar/statoblast-shared/statoblast/securityPool'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getActiveBackend, getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { decodeStoredValue } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { securityPoolReadClient, type SecurityPoolAccountSnapshot, type SecurityPoolTransaction } from '../../../protocol/securityPool.js'
import { loadSharedForkOutcome, loadSecurityPoolSourceRecovery, buildSecurityPoolRecoveryPreparation } from '../../../protocol/securityPoolSharedFork.js'
import { securityPoolAmountOrUndefined, securityPoolUnsignedId } from '../lib/draft.js'
import type { SecurityPoolActions } from '../components/SecurityPoolControls.js'
import * as copy from '../../../copy/securityPoolSharedFork.js'
import { branchPriceTarget } from './useSecurityPoolPrice.js'
import { statoblastDisplayCache } from '../../../protocol/statoblastPageCache.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'

export type SecurityPoolSharedForkParameters = {
	snapshot: SecurityPoolAccountSnapshot | undefined
	presentationSnapshot?: SecurityPoolAccountSnapshot | undefined
	actions: Pick<SecurityPoolActions, 'scope' | 'busy' | 'ownerReason' | 'runSecurityPoolAction'>
	openUniverse: (universeId: bigint) => void
	bidder?: Address | undefined
	openVault?: ((vault: Address, universeId: bigint) => void) | undefined
}

function branchDisplayCache(profile: NetworkProfile, pool: Address, owner: Address, universeId: bigint, outcomeIndex?: bigint) {
	return statoblastDisplayCache(profile, { universeId, owner, page: `fork-branch:${pool.toLowerCase()}:${outcomeIndex ?? 'chosen'}` }, value =>
		decodeStoredValue(value, read => ({ securityPool: pool, owner, universeId: read.bigint('universeId'), blockHash: read.string('blockHash'), started: read.boolean('started'), reportingDeadline: read.optional('reportingDeadline', read.bigint) })),
	)
}

export function useSecurityPoolSharedFork({ snapshot: securityPool, presentationSnapshot = securityPool, actions, openUniverse }: SecurityPoolSharedForkParameters) {
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
	const loaded = useSignal<{ backend: typeof backend; key: string; state?: SecurityPoolForkSnapshot; outcome?: Awaited<ReturnType<typeof loadSharedForkOutcome>>; error?: string } | undefined>(undefined)
	const recovered = useSignal<{ key: string; source?: Awaited<ReturnType<typeof loadSecurityPoolSourceRecovery>>; error?: string } | undefined>(undefined)
	const draftIdentity = useRef<{ backend: typeof backend; key: string } | undefined>(undefined)
	useEffect(() => {
		const identity = presentationSnapshot === undefined ? undefined : `${presentationSnapshot.securityPool}:${presentationSnapshot.owner}:${presentationSnapshot.universeId}`
		const sameBackend = draftIdentity.current?.backend === backend
		if (sameBackend && (identity === undefined || draftIdentity.current?.key === identity)) return
		draftIdentity.current = identity === undefined ? undefined : { backend, key: identity }
		sourceInput.value = presentationSnapshot?.universeId.toString() ?? ''
		outcomeInput.value = ''
		questionInput.value = ''
		sharesInput.value = ''
		recipientInput.value = ''
		invalidRightsInput.value = '0'
		yesRightsInput.value = '0'
		noRightsInput.value = '0'
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
		if (presentationSnapshot === undefined || universeId === undefined) return undefined
		const { securityPool: pool, owner } = presentationSnapshot
		return branchDisplayCache(profile, pool, owner, universeId, outcomeIndex)
	}, [profile, presentationSnapshot?.securityPool, presentationSnapshot?.owner, universeId, outcomeIndex])
	const key = `${securityPool?.securityPool}:${securityPool?.owner}:${securityPool?.blockHash}:${universeId}:${outcomeIndex}`
	useEffect(() => {
		let current = true
		loaded.value = undefined
		if (securityPool !== undefined && universeId !== undefined) {
			const client = createConnectedReadClient()
			const read = async () => {
				const state = await loadSecurityPoolForkSnapshot({ client: securityPoolReadClient(client), securityPool: securityPool.securityPool, owner: securityPool.owner, universeId, ...(outcomeIndex === undefined ? {} : { outcomeIndex }) })
				const outcome = state.forkTime === 0n || state.branch === undefined ? undefined : await loadSharedForkOutcome(client, state, state.branch.outcomeIndex)
				return { state, outcome }
			}
			void withTimeout(read(), 15_000, copy.readTimeout)
				.then(({ state, outcome }) => {
					if (!current || getActiveBackend() !== backend) return
					const child = branchPriceTarget(state)
					if (child !== undefined && state.forkTime > 0n) {
						const block = { number: state.blockNumber, timestamp: state.timestamp }
						branchCache?.write(child, block)
						if (outcomeIndex !== undefined && state.choice.recorded && state.choice.outcomeIndex === outcomeIndex) branchDisplayCache(profile, state.securityPool, state.owner, state.universeId).write(child, block)
					}
					loaded.value = { backend, key, state, ...(outcome === undefined ? {} : { outcome }) }
				})
				.catch(error => {
					if (current && getActiveBackend() === backend) loaded.value = { backend, key, error: getErrorMessage(error, 'Unable to load this fork.') }
				})
		}
		return () => {
			current = false
		}
	}, [backend, key, branchCache])
	const current = loaded.value?.backend === backend && loaded.value.key === key ? loaded.value : undefined
	const state = current?.state
	const savedBranch = useMemo(() => (state === undefined ? branchCache?.read()?.value : undefined), [branchCache, key, state])
	const recoveryKey = `${key}:${state?.blockHash}:${questionId}`
	useEffect(() => {
		let current = true
		recovered.value = undefined
		if (state !== undefined && state.forkTime > 0n && questionId !== undefined) {
			void loadSecurityPoolSourceRecovery(createConnectedReadClient(), state, questionId)
				.then(source => {
					if (current && getActiveBackend() === backend) recovered.value = { key: recoveryKey, source }
				})
				.catch(error => {
					if (current && getActiveBackend() === backend) recovered.value = { key: recoveryKey, error: getErrorMessage(error, 'Unable to read source recovery rights.') }
				})
		}
		return () => {
			current = false
		}
	}, [recoveryKey])
	const recoveryState = recovered.value?.key === recoveryKey ? recovered.value : undefined
	const recovery = recoveryState?.source
	const pendingReason = universeId === undefined ? 'Enter a valid source universe.' : 'Checking fork status…'
	const baseReason = actions.ownerReason ?? current?.error ?? (state === undefined ? pendingReason : undefined)
	const forkReason = baseReason ?? (state?.forkTime === 0n ? 'This source universe has not forked.' : undefined)
	const branchReason = forkReason ?? (state?.branch === undefined || current?.outcome?.outcomeLabel === undefined ? 'Enter a valid fork outcome.' : undefined)
	const chooseReason =
		branchReason ??
		(state?.choice.recorded ? 'Your irreversible branch choice is already recorded.' : undefined) ??
		(state !== undefined && state.timestamp >= state.choiceDeadline ? 'The fork choice window has closed.' : undefined) ??
		(securityPool !== undefined && universeId === securityPool.universeId && !securityPool.positions.some(position => position.rep > 0n && position.commitment > 0n) ? 'No pledged REP to move.' : undefined)
	const custodyPreparationReason = (selected: SecurityPoolForkSnapshot) => (selected.branch?.prepared ? 'This branch capital is already prepared.' : undefined)
	const migrationReason = (selected: SecurityPoolForkSnapshot) => {
		if (selected.timestamp < selected.choiceDeadline) return 'Wait until the choice deadline.'
		return selected.branch?.started ? 'This branch migration is already started.' : undefined
	}
	const prepareBranchReason = branchReason ?? (state && custodyPreparationReason(state))
	const recheckStage = (reasonFor: (latest: SecurityPoolForkSnapshot) => string | undefined) => async (latest: SecurityPoolForkSnapshot) => {
		const reason = latest.forkTime === 0n || latest.branch === undefined ? 'Fork context changed. Review again.' : reasonFor(latest)
		if (reason !== undefined) throw new Error(reason)
	}
	const startReason = branchReason ?? (state && migrationReason(state))
	const activationReason = (selected: SecurityPoolForkSnapshot) => {
		if (!selected.branch?.prepared) return 'Prepare branch capital first.'
		if (selected.timestamp < selected.activationDeadline) return 'Wait until the earliest activation time.'
		return selected.branch.ready ? 'This branch is already active.' : undefined
	}
	const finalizeReason = branchReason ?? (state && activationReason(state))
	const sourceReason =
		forkReason ??
		(questionId === undefined ? 'Enter a question ID.' : undefined) ??
		recoveryState?.error ??
		(recovery === undefined ? 'Loading source recovery rights.' : undefined) ??
		(recovery !== undefined && recovery.pool !== zeroAddress && !recovery.eligible ? 'No live source recovery rights. Redeem finalized shares through the source question.' : undefined)
	const recoveryReason = sourceReason ?? (state !== undefined && state.timestamp < state.choiceDeadline ? 'Wait until the choice deadline.' : undefined)
	const prepareReason = recoveryReason ?? (recovery?.pool !== zeroAddress ? 'The source question is already prepared.' : undefined)
	const recoverReason =
		recoveryReason ??
		(recovery?.pool === zeroAddress ? 'Prepare the source question first.' : undefined) ??
		(shares === undefined || shares === 0n ? 'Enter a positive complete-set amount.' : undefined) ??
		(recovery !== undefined && shares !== undefined && shares > recovery.availableShares ? 'Insufficient complete-set recovery rights. Combine Invalid, Yes and No recovery rights from other holders if needed.' : undefined)
	const transferReason =
		sourceReason ??
		(recovery?.pool === zeroAddress ? 'Prepare the source question first.' : undefined) ??
		(recipient === undefined || recipient === zeroAddress || recipient === state?.owner ? 'Enter another nonzero recipient address.' : undefined) ??
		(transferAmounts === undefined || transferAmounts.every(amount => amount === 0n) || transferAmounts.some(amount => amount >= 1n << 256n) ? 'Enter nonnegative outcome amounts and transfer at least one recovery right.' : undefined) ??
		(recovery !== undefined && transferAmounts?.some((amount, index) => amount > (recovery.rights[index] ?? 0n)) ? 'Insufficient recovery rights for an outcome.' : undefined)

	const run = (action: string, title: string, reason: string | undefined, build: (selected: SecurityPoolForkSnapshot) => SecurityPoolTransaction, check?: (latest: SecurityPoolForkSnapshot) => Promise<void>) =>
		actions.runSecurityPoolAction(action, title, () => {
			if (reason !== undefined || state === undefined) throw new Error(reason ?? 'Fork state unavailable.')
			const selected = state
			const request = build(selected)
			return {
				...request,
				validateBeforeSubmit: async () => {
					if (getActiveBackend() !== backend) throw new Error('Wallet environment changed. Review again.')
					const latest = await loadSecurityPoolForkSnapshot({ client: securityPoolReadClient(createConnectedReadClient()), securityPool: selected.securityPool, owner: selected.owner, universeId: selected.universeId, ...(selected.branch === undefined ? {} : { outcomeIndex: selected.branch.outcomeIndex }) })
					if (latest.chainId !== selected.chainId || latest.controller !== selected.controller) throw new Error('Fork context changed. Review again.')
					await check?.(latest)
				},
			}
		})
	const base = (selected: SecurityPoolForkSnapshot) => ({ owner: selected.owner, controller: selected.controller, universeId: selected.universeId })
	return {
		state,
		savedBranch,
		recovery,
		outcome: current?.outcome,
		error: current?.error ?? recoveryState?.error,
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
		prepareBranchReason,
		startReason,
		finalizeReason,
		prepareReason,
		recoverReason,
		openReason: state?.branch?.ready ? undefined : copy.openAfterActivation,
		open: () => {
			if (state?.branch?.ready) openUniverse(state.branch.universeId)
		},
		choose: () =>
			run(
				'chooseSecurityPoolFork',
				'Commit fork branch',
				chooseReason,
				selected => {
					const outcomeLabel = current?.outcome?.outcomeLabel
					if (selected.branch === undefined || outcomeLabel === undefined) throw new Error('Select a branch.')
					return {
						...buildSecurityPoolForkChoiceRequest({ ...base(selected), outcomeIndex: selected.branch.outcomeIndex }),
						reviewDescription: copy.choiceReview(outcomeLabel),
					}
				},
				async latest => {
					if (latest.forkTime === 0n || latest.branch === undefined || latest.choice.recorded || latest.timestamp >= latest.choiceDeadline) throw new Error('Fork choice is no longer available.')
				},
			),
		prepareBranch: () =>
			run(
				'prepareSecurityPoolFork',
				'Prepare branch capital',
				prepareBranchReason,
				selected => {
					if (selected.branch === undefined) throw new Error('Select a branch.')
					return { ...buildSecurityPoolForkPreparationRequest({ ...base(selected), outcomeIndex: selected.branch.outcomeIndex }), reviewDescription: 'Create this branch’s REP token and shared capital contracts when needed.' }
				},
				recheckStage(custodyPreparationReason),
			),
		start: () =>
			run(
				'startSecurityPoolFork',
				'Start branch migration',
				startReason,
				selected => {
					if (selected.branch === undefined) throw new Error('Select a branch.')
					return { ...buildSecurityPoolForkStartRequest({ ...base(selected), outcomeIndex: selected.branch.outcomeIndex }), reviewDescription: 'Prepare this branch if needed, migrate its shared REP, and set up its collateral repair auction.' }
				},
				recheckStage(migrationReason),
			),
		finalize: () =>
			run(
				'finalizeSecurityPoolFork',
				'Activate fork branch',
				finalizeReason,
				selected => {
					if (selected.branch === undefined) throw new Error('Select a branch.')
					return { ...buildSecurityPoolForkFinalizeRequest({ ...base(selected), universeId: selected.branch.universeId }), reviewDescription: 'Start migration if needed, then activate this branch’s collateral and REP claim basket and chosen underwriting positions.' }
				},
				recheckStage(activationReason),
			),
		prepare: () =>
			run('prepareSecurityPoolRecovery', 'Prepare source question', prepareReason, selected => {
				if (recovery === undefined) throw new Error('Source question unavailable.')
				return { ...buildSecurityPoolRecoveryPreparation(selected, recovery), reviewDescription: 'Prepare recovery rights for everyone holding shares in this question.' }
			}),
		transfer: () =>
			run(
				'transferSecurityPoolRecoveryRights',
				'Transfer recovery rights',
				transferReason,
				selected => {
					if (questionId === undefined || recovery === undefined || recipient === undefined || transferAmounts === undefined) throw new Error('Enter the recipient and recovery rights to transfer.')
					return {
						...buildSecurityPoolRecoveryRightsTransferRequest({ owner: selected.owner, shareToken: recovery.shareToken, universeId: selected.universeId, recipient, amountsAttoShares: transferAmounts }),
						reviewDescription: `Transfer ${formatUnits(transferAmounts[0], securityPool?.collateral.decimals ?? 18)} Invalid, ${formatUnits(transferAmounts[1], securityPool?.collateral.decimals ?? 18)} Yes and ${formatUnits(transferAmounts[2], securityPool?.collateral.decimals ?? 18)} No recovery rights for question 0x${questionId.toString(16)} in source universe ${selected.universeId} to ${recipient}. The recipient receives these rights to source cash. Spending source-backed rights locks those original source shares. Your child migration rights remain yours.`,
					}
				},
				async latest => {
					if (questionId === undefined || recovery === undefined || transferAmounts === undefined) throw new Error('Recovery transfer unavailable.')
					const fresh = await loadSecurityPoolSourceRecovery(createConnectedReadClient(), latest, questionId)
					if (latest.forkTime === 0n || !fresh.eligible || fresh.pool === zeroAddress || fresh.shareToken !== recovery.shareToken || transferAmounts.some((amount, index) => amount > (fresh.rights[index] ?? 0n))) throw new Error('Recovery transfer prerequisites changed. Refresh and review again.')
				},
			),

		recover: () =>
			run(
				'recoverSecurityPoolSource',
				'Recover source cash',
				recoverReason,
				selected => {
					if (questionId === undefined || shares === undefined) throw new Error('Enter recovery complete sets.')
					return {
						...buildSecurityPoolForkRecoveryRequest({ ...base(selected), questionId, shares }),
						reviewDescription: `Use ${formatUnits(shares, securityPool?.collateral.decimals ?? 18)} complete-set recovery rights for question 0x${questionId.toString(16)}. Spending source-backed rights locks those original source shares. Received recovery rights are consumed first; all child migration rights remain available.`,
					}
				},
				async latest => {
					if (questionId === undefined || shares === undefined) throw new Error('Recovery amount unavailable.')
					const fresh = await loadSecurityPoolSourceRecovery(createConnectedReadClient(), latest, questionId)
					if (!fresh.eligible || fresh.availableShares < shares || fresh.pool === zeroAddress) throw new Error('Source recovery prerequisites changed.')
				},
			),
	}
}
