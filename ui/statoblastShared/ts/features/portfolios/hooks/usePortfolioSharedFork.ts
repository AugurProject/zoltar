import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { formatEther, getAddress, isAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioForkChoiceRequest, buildPortfolioForkStartRequest, buildPortfolioForkFinalizeRequest, buildPortfolioForkRecoveryRequest, buildPortfolioRecoveryRightsTransferRequest, loadPortfolioForkSnapshot, type PortfolioForkSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { portfolioReadClient, type PortfolioAccountSnapshot, type PortfolioTransaction } from '../../../protocol/securityPoolPortfolio.js'
import { loadSharedForkOutcome, loadPortfolioSourceRecovery, buildPortfolioRecoveryPreparation } from '../../../protocol/securityPoolSharedFork.js'
import { portfolioAmountOrUndefined, portfolioUnsignedId } from '../lib/draft.js'
import type { PortfolioActions } from '../components/PortfolioControls.js'

export type PortfolioSharedForkParameters = { snapshot: PortfolioAccountSnapshot | undefined; actions: Pick<PortfolioActions, 'scope' | 'busy' | 'ownerReason' | 'runPortfolioAction'>; openUniverse: (universeId: bigint) => void }
export function usePortfolioSharedFork({ snapshot: portfolio, actions, openUniverse }: PortfolioSharedForkParameters) {
	const backend = getActiveBackend()
	const sourceInput = useSignal('')
	const outcomeInput = useSignal('')
	const questionInput = useSignal('')
	const sharesInput = useSignal('')
	const recipientInput = useSignal('')
	const invalidRightsInput = useSignal('0')
	const yesRightsInput = useSignal('0')
	const noRightsInput = useSignal('0')
	const loaded = useSignal<{ key: string; state?: PortfolioForkSnapshot; outcome?: Awaited<ReturnType<typeof loadSharedForkOutcome>>; error?: string } | undefined>(undefined)
	const recovered = useSignal<{ key: string; source?: Awaited<ReturnType<typeof loadPortfolioSourceRecovery>>; error?: string } | undefined>(undefined)
	const draftIdentity = useRef<{ backend: typeof backend; key: string } | undefined>(undefined)
	useEffect(() => {
		const identity = portfolio === undefined ? undefined : `${portfolio.portfolio}:${portfolio.owner}:${portfolio.universeId}`
		const sameBackend = draftIdentity.current?.backend === backend
		if (sameBackend && (identity === undefined || draftIdentity.current?.key === identity)) return
		draftIdentity.current = identity === undefined ? undefined : { backend, key: identity }
		sourceInput.value = portfolio?.universeId.toString() ?? ''
		outcomeInput.value = ''
		questionInput.value = ''
		sharesInput.value = ''
		recipientInput.value = ''
		invalidRightsInput.value = '0'
		yesRightsInput.value = '0'
		noRightsInput.value = '0'
	}, [backend, portfolio?.portfolio, portfolio?.owner, portfolio?.universeId])
	const universeId = portfolioUnsignedId(sourceInput.value, 248)
	const outcomeIndex = portfolioUnsignedId(outcomeInput.value)
	const questionId = portfolioUnsignedId(questionInput.value)
	const shares = portfolioAmountOrUndefined(sharesInput.value)
	const recipient = isAddress(recipientInput.value.trim()) ? getAddress(recipientInput.value.trim()) : undefined
	const invalidRights = portfolioAmountOrUndefined(invalidRightsInput.value)
	const yesRights = portfolioAmountOrUndefined(yesRightsInput.value)
	const noRights = portfolioAmountOrUndefined(noRightsInput.value)
	const transferAmounts = invalidRights === undefined || yesRights === undefined || noRights === undefined ? undefined : ([invalidRights, yesRights, noRights] satisfies readonly [bigint, bigint, bigint])
	const key = `${backend}:${portfolio?.portfolio}:${portfolio?.owner}:${portfolio?.blockHash}:${universeId}:${outcomeIndex}`
	useEffect(() => {
		let current = true
		loaded.value = undefined
		if (portfolio !== undefined && universeId !== undefined) {
			const client = createConnectedReadClient()
			void (async () => {
				const state = await loadPortfolioForkSnapshot({ client: portfolioReadClient(client), portfolio: portfolio.portfolio, owner: portfolio.owner, universeId, ...(outcomeIndex === undefined ? {} : { outcomeIndex }) })
				const outcome = state.forkTime === 0n || state.branch === undefined ? undefined : await loadSharedForkOutcome(client, state, state.branch.outcomeIndex)
				if (current && getActiveBackend() === backend) loaded.value = { key, state, ...(outcome === undefined ? {} : { outcome }) }
			})().catch(error => {
				if (current && getActiveBackend() === backend) loaded.value = { key, error: getErrorMessage(error, 'Unable to load this fork.') }
			})
		}
		return () => {
			current = false
		}
	}, [key])
	const current = loaded.value?.key === key ? loaded.value : undefined
	const state = current?.state
	const recoveryKey = `${key}:${state?.blockHash}:${questionId}`
	useEffect(() => {
		let current = true
		recovered.value = undefined
		if (state !== undefined && state.forkTime > 0n && questionId !== undefined) {
			void loadPortfolioSourceRecovery(createConnectedReadClient(), state, questionId)
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
		(portfolio !== undefined && universeId === portfolio.universeId && !portfolio.positions.some(position => position.rep > 0n && position.commitment > 0n) ? 'No pledged REP to move.' : undefined)
	const startReason = branchReason ?? (state !== undefined && state.timestamp < state.choiceDeadline ? 'Wait until the choice deadline.' : undefined) ?? (state?.branch?.started ? 'This branch is already prepared.' : undefined)
	const finalizeReason = branchReason ?? (state !== undefined && state.timestamp < state.activationDeadline ? 'Wait until the activation deadline.' : undefined) ?? (state?.branch?.ready ? 'This branch is already active.' : undefined)
	const sourceReason =
		forkReason ??
		(questionId === undefined ? 'Enter a question ID.' : undefined) ??
		recoveryState?.error ??
		(recovery === undefined ? 'Loading source recovery rights.' : undefined) ??
		(recovery !== undefined && recovery.pool !== zeroAddress && !recovery.eligible ? 'No live source recovery rights. Redeem finalized shares through the source pool.' : undefined)
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

	const run = (action: string, title: string, reason: string | undefined, build: (selected: PortfolioForkSnapshot) => PortfolioTransaction, check?: (latest: PortfolioForkSnapshot) => Promise<void>) =>
		actions.runPortfolioAction(action, title, () => {
			if (reason !== undefined || state === undefined) throw new Error(reason ?? 'Fork state unavailable.')
			const selected = state
			const request = build(selected)
			return {
				...request,
				validateBeforeSubmit: async () => {
					if (getActiveBackend() !== backend) throw new Error('Wallet environment changed. Review again.')
					const latest = await loadPortfolioForkSnapshot({ client: portfolioReadClient(createConnectedReadClient()), portfolio: selected.portfolio, owner: selected.owner, universeId: selected.universeId, ...(selected.branch === undefined ? {} : { outcomeIndex: selected.branch.outcomeIndex }) })
					if (latest.chainId !== selected.chainId || latest.controller !== selected.controller) throw new Error('Fork context changed. Review again.')
					await check?.(latest)
				},
			}
		})
	const base = (selected: PortfolioForkSnapshot) => ({ owner: selected.owner, controller: selected.controller, universeId: selected.universeId })
	return {
		state,
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
		startReason,
		finalizeReason,
		prepareReason,
		recoverReason,
		openReason: state?.branch?.ready ? undefined : 'Activate the branch before opening its account.',
		open: () => {
			if (state?.branch?.ready) openUniverse(state.branch.universeId)
		},
		choose: () =>
			run(
				'choosePortfolioFork',
				'Commit fork branch',
				chooseReason,
				selected => {
					if (selected.branch === undefined) throw new Error('Select a branch.')
					return {
						...buildPortfolioForkChoiceRequest({ ...base(selected), outcomeIndex: selected.branch.outcomeIndex }),
						reviewDescription: `Irreversibly choose outcome ${selected.branch.outcomeIndex} for your committed principal in universe ${selected.universeId}. Idle REP and old fees remain in the source. REP in every unchosen branch belongs to that branch’s outcome claimants. There is no revoke action.`,
					}
				},
				async latest => {
					if (latest.choice.recorded || latest.timestamp >= latest.choiceDeadline) throw new Error('Fork choice is no longer available.')
				},
			),
		start: () =>
			run('startPortfolioFork', 'Prepare shared branch', startReason, selected => {
				if (selected.branch === undefined) throw new Error('Select a branch.')
				return { ...buildPortfolioForkStartRequest({ ...base(selected), outcomeIndex: selected.branch.outcomeIndex }), reviewDescription: 'Prepare this branch for all owners. This does not choose anyone’s branch or require processing each question.' }
			}),
		finalize: () =>
			run('finalizePortfolioFork', 'Activate fork branch', finalizeReason, selected => {
				if (selected.branch === undefined) throw new Error('Select a branch.')
				return { ...buildPortfolioForkFinalizeRequest({ ...base(selected), universeId: selected.branch.universeId }), reviewDescription: 'Activate this branch’s funded ETH and REP claim basket and chosen underwriting positions.' }
			}),
		prepare: () =>
			run('preparePortfolioRecovery', 'Prepare source question', prepareReason, selected => {
				if (recovery === undefined) throw new Error('Source question unavailable.')
				return { ...buildPortfolioRecoveryPreparation(selected, recovery), reviewDescription: 'Prepare this question’s source share namespace for all holders. This does not claim or migrate vault principal.' }
			}),
		transfer: () =>
			run(
				'transferPortfolioRecoveryRights',
				'Transfer recovery rights',
				transferReason,
				selected => {
					if (questionId === undefined || recovery === undefined || recipient === undefined || transferAmounts === undefined) throw new Error('Enter the recipient and recovery rights to transfer.')
					return {
						...buildPortfolioRecoveryRightsTransferRequest({ owner: selected.owner, shareToken: recovery.shareToken, universeId: selected.universeId, recipient, amountsAttoShares: transferAmounts }),
						reviewDescription: `Transfer ${formatEther(transferAmounts[0])} Invalid, ${formatEther(transferAmounts[1])} Yes and ${formatEther(transferAmounts[2])} No recovery rights for question 0x${questionId.toString(16)} in source universe ${selected.universeId} to ${recipient}. The recipient receives these rights to source cash. Spending source-backed rights locks those original source shares. Your child migration rights remain yours.`,
					}
				},
				async latest => {
					if (questionId === undefined || recovery === undefined || transferAmounts === undefined) throw new Error('Recovery transfer unavailable.')
					const fresh = await loadPortfolioSourceRecovery(createConnectedReadClient(), latest, questionId)
					if (latest.forkTime === 0n || !fresh.eligible || fresh.pool === zeroAddress || fresh.shareToken !== recovery.shareToken || transferAmounts.some((amount, index) => amount > (fresh.rights[index] ?? 0n))) throw new Error('Recovery transfer prerequisites changed. Refresh and review again.')
				},
			),

		recover: () =>
			run(
				'recoverPortfolioSource',
				'Recover source cash',
				recoverReason,
				selected => {
					if (questionId === undefined || shares === undefined) throw new Error('Enter recovery complete sets.')
					return {
						...buildPortfolioForkRecoveryRequest({ ...base(selected), questionId, shares }),
						reviewDescription: `Use ${formatEther(shares)} complete-set recovery rights for question 0x${questionId.toString(16)}. Spending source-backed rights locks those original source shares. Received recovery rights are consumed first; all child migration rights remain available.`,
					}
				},
				async latest => {
					if (questionId === undefined || shares === undefined) throw new Error('Recovery amount unavailable.')
					const fresh = await loadPortfolioSourceRecovery(createConnectedReadClient(), latest, questionId)
					if (!fresh.eligible || fresh.availableShares < shares || fresh.pool === zeroAddress) throw new Error('Source recovery prerequisites changed.')
				},
			),
	}
}
