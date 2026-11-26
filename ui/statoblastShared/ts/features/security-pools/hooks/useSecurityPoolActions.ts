import { deployment as deploymentCopy } from '../../../copy/securityPoolTransactions.js'
import { prepareStages } from '../../../copy/securityPoolCapital.js'
import { invalidateStatoblastEntries } from '../../../protocol/statoblastEntries.js'
import type { CollateralSymbol } from '../../../protocol/collateral.js'
import { signal, useSignal } from '@preact/signals'
import { useEffect, useMemo, useRef } from 'preact/hooks'
import { getAddress, type Address, type Hash, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { createTransactionScope, mergeTransactionScopes } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { localEntityScopeForNetwork, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { getErrorDetail, getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { currentStateCheckFailed } from '@zoltar/ui-core-shared/copy/transaction.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import { isUniverseForked, loadSecurityPoolSetup, securityPoolPreparationRequest, securityPoolAddressFromCreationReceipt, securityPoolContractRequest, securityPoolCreationRequest, sendSecurityPoolTransaction, type SecurityPoolTransaction } from '../../../protocol/securityPool.js'
import { securityPoolUnsignedId } from '../lib/draft.js'
import type { useSecurityPool } from './useSecurityPool.js'
import * as copy from '../../../copy/securityPool.js'
import { initialDeploymentDraft, parseDeploymentDraft, securityPoolDeploymentReviewDescription, type CuratedAdmissionMode, type DeploymentDraft, type SecurityPoolCreationDraft } from '../lib/creation.js'
import { securityPoolAdmissionCreationRequest, requireSecurityPoolQuestionAdmission, requireSecurityPoolQuestionHorizon, requireSecurityPoolQuestionEligibility } from '../../../protocol/securityPoolAdmission.js'
import { buildSecurityPoolAuctionVaultExecuteRequest } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { authenticateSecurityPoolAuctionVault } from '../../../protocol/securityPoolRepairAuction.js'
import { deploymentProgressJournal, samePendingDeployment, type PendingDeployment } from '../lib/deploymentProgress.js'
import { matchesQuestionRules, readDeploymentNonce, readSecurityPoolCreationCount } from '../../../protocol/deploymentRecovery.js'
import { isDefiniteDeploymentRejection, readPendingDeploymentRecovery, supportsDeploymentNonce } from '../lib/deploymentWallet.js'
import { withStatoblastRequestTimeout } from '../../../protocol/requestTimeout.js'

const createReviewReadClient = () => withStatoblastRequestTimeout(createConnectedReadClient(), currentStateCheckFailed)

export function useSecurityPoolActions(model: ReturnType<typeof useSecurityPool>, parameters: WriteOperationsParameters, deploying = false, walletUnavailableReason?: string, checkDeploymentOrigin = deploying) {
	const backend = getActiveBackend()
	const wallet = parameters.accountAddress
	const journal = useMemo(() => deploymentProgressJournal(backend.profile, deploying ? wallet : undefined), [backend, wallet, deploying])
	const activeJournal = useRef(journal)
	activeJournal.current = journal
	const currentContext = () => activeJournal.current === journal && getActiveBackend() === backend
	const progress = journal.current.value
	const { read: readProgress, write: saveProgress } = journal
	const originEdited = useRef(false)
	const originForkState = useSignal<{ backend: ReturnType<typeof getActiveBackend>; key: string; forked: boolean; reason?: string } | undefined>(undefined)
	const draftInput = useSignal(initialDeploymentDraft(model.universeInput))
	const draft = progress?.draft ?? draftInput.value
	const updateDraft = (patch: Partial<DeploymentDraft>) => {
		if (journal.current.value === undefined) draftInput.value = { ...draftInput.value, ...patch }
	}
	const { collateral, approvedQuestions, fixedQuestionIds, fixedQuestionError, creationError, origin, economics, horizon } = parseDeploymentDraft(draft, backend.profile)
	const deployedAdmission = useSignal<{ address: Address; key: string; universeId: bigint; backend: ReturnType<typeof getActiveBackend> } | undefined>(undefined)
	const questionInput = useSignal('')
	const busy = useSignal<string | undefined>(undefined)
	const checkingDeploymentReceipt = useMemo(() => signal(false), [journal])
	const restartProof = useMemo(() => signal<PendingDeployment | undefined>(undefined), [journal])
	const deploymentRecoveryDetail = useMemo(() => signal<string | undefined>(undefined), [journal])
	const error = useSignal<string | undefined>(undefined)
	const lastFailedAction = useSignal<string | undefined>(undefined)
	const feedback = useSignal<string | undefined>(undefined)
	const coordinationReason = journal.coordinationReason()
	const snapshot = model.snapshot
	const universeId = snapshot?.universeId ?? securityPoolUnsignedId(model.universeInput, 248) ?? 0n
	const scope = mergeTransactionScopes(createTransactionScope('securityPool', snapshot?.securityPool ?? model.setup?.securityPool), createTransactionScope('security-pool-capital', snapshot?.capitalLedger))
	const walletReason = parameters.accountAddress === undefined ? (walletUnavailableReason ?? copy.connect) : undefined
	const ownerReason =
		walletReason ??
		(snapshot === undefined && (model.loading || busy.value !== undefined) ? copy.loading : undefined) ??
		(snapshot === undefined && model.presentationSnapshot !== undefined ? copy.readUnavailable : undefined) ??
		(snapshot === undefined ? copy.enterSecurityPool : undefined) ??
		(parameters.accountAddress?.toLowerCase() !== (snapshot?.auctionVault?.bidder ?? snapshot?.owner)?.toLowerCase() ? copy.ownerRequired : undefined)
	useEffect(() => {
		error.value = undefined
		feedback.value = undefined
	}, [backend, model.managerInput, model.ownerInput, universeId])
	// A forked universe cannot be an origin, so a fixed genesis default would fail once genesis forks.
	useEffect(() => {
		if (!originEdited.current) updateDraft({ originInput: model.universeInput })
	}, [model.universeInput])
	const savedPool = progress?.pool
	const verifiedSetup = savedPool !== undefined && model.setup?.securityPool !== savedPool ? undefined : model.setup
	useEffect(() => {
		const restored = journal.restored
		if (restored?.pool === undefined || wallet === undefined) return
		if (restored.pool.toLowerCase() === model.managerInput.toLowerCase() && wallet.toLowerCase() === model.ownerInput.toLowerCase() && restored.draft.originInput === model.universeInput) return
		void model.load(restored.pool, wallet, restored.draft.originInput)
	}, [journal, wallet])
	const completedPool = verifiedSetup?.stage === 4 ? verifiedSetup.securityPool : undefined
	useEffect(() => {
		const deployment = journal.current.value
		if (deployment === undefined || deployment.activated || deployment.pool === undefined || deployment.pool.toLowerCase() !== completedPool?.toLowerCase()) return
		setEntityFavorite(localEntityScopeForNetwork(backend.profile, 'statoblast', 'pool'), deployment.pool, true)
		saveProgress({ ...deployment, activated: true })
	}, [savedPool, completedPool, journal, backend])
	const originForkKey = draft.originInput.trim()
	useEffect(() => {
		if (!checkDeploymentOrigin) return
		let current = true
		const originUniverse = securityPoolUnsignedId(draft.originInput, 248)
		// Check deployment eligibility again before either transaction.
		const load = async () => {
			if (originUniverse === undefined) return
			const forked = await isUniverseForked(createConnectedReadClient(), originUniverse)
			if (current) originForkState.value = { backend, key: originForkKey, forked }
		}
		void load().catch(failure => {
			if (current) originForkState.value = { backend, key: originForkKey, forked: false, reason: getErrorMessage(failure, deploymentCopy.originValidationUnavailable) }
		})
		return () => {
			current = false
		}
	}, [backend, checkDeploymentOrigin, originForkKey])
	const settleDeployment = (id: string, receipt?: TransactionReceipt): Address | undefined => {
		const latest = readProgress()
		if (latest?.pending?.id !== id) return undefined
		if (receipt?.status === 'success') {
			if (latest.pending.step === 'pool') {
				const pool = securityPoolAddressFromCreationReceipt(receipt)
				saveProgress({ ...latest, pool, pending: undefined })
				return pool
			}
			const rules = receipt.contractAddress
			if (rules === null || rules === undefined) throw new Error(copy.admissionAddressMissing)
			saveProgress({ ...latest, rules, pending: undefined })
			return undefined
		}
		saveProgress(latest.rules === undefined ? undefined : { ...latest, pending: undefined })
		return undefined
	}
	const refreshDeploymentProgress = async (walletRejected = false) => {
		if (!currentContext() || checkingDeploymentReceipt.value || busy.value !== undefined || wallet === undefined) return undefined
		const latest = readProgress()
		journal.current.value = latest
		const pending = latest?.pending
		if (latest === undefined || pending === undefined) {
			if (latest?.pool !== undefined && (latest.pool !== model.managerInput || model.setup?.securityPool !== latest.pool)) await model.load(latest.pool, wallet, latest.draft.originInput)
			else await model.refresh()
			return undefined
		}
		checkingDeploymentReceipt.value = true
		error.value = undefined
		restartProof.value = undefined
		deploymentRecoveryDetail.value = undefined
		try {
			const result = await readPendingDeploymentRecovery(createReviewReadClient(), wallet, { ...latest, pending }, backend.profile, walletRejected)
			if (!currentContext()) return undefined
			const checked = readProgress()
			if (checked?.pending === undefined || !samePendingDeployment(checked.pending, pending)) return undefined
			const verified = result.transactionNonce === undefined ? checked : { ...checked, pending: { ...checked.pending, nonce: result.transactionNonce, nonceVerified: true } }
			if (verified !== checked) saveProgress(verified)
			if (result.kind === 'rejected') {
				originEdited.current = true
				draftInput.value = checked.draft
				settleDeployment(pending.id)
			} else if (result.kind === 'recovered') {
				if (result.rules !== undefined) saveProgress({ ...checked, rules: result.rules, pending: undefined })
				else if (result.pool !== undefined) {
					saveProgress({ ...checked, pool: result.pool, pending: undefined })
					await model.load(result.pool, wallet, checked.draft.originInput)
				}
			} else {
				deploymentRecoveryDetail.value = result.detail
				if (result.kind === 'restart') {
					restartProof.value = verified.pending
					return verified
				}
			}
		} catch (failure) {
			if (currentContext()) error.value = getErrorMessage(failure, deploymentCopy.receiptCheckFailed)
		} finally {
			checkingDeploymentReceipt.value = false
		}
		return undefined
	}
	useEffect(() => {
		if (journal.restored?.pending !== undefined) void refreshDeploymentProgress()
	}, [journal])
	const pendingId = progress?.pending?.id
	useEffect(() => {
		if (pendingId === undefined) return
		const refreshVisible = () => {
			if (!document.hidden) void refreshDeploymentProgress()
		}
		document.addEventListener('visibilitychange', refreshVisible)
		return () => document.removeEventListener('visibilitychange', refreshVisible)
	}, [journal, pendingId])
	const run = async (action: string, label: string, build: () => Promise<SecurityPoolTransaction> | SecurityPoolTransaction, validate: () => Promise<void> = async () => undefined, onConfirmed?: (result: Awaited<ReturnType<typeof sendSecurityPoolTransaction>>) => Promise<void>, deploymentStep?: 'rules' | 'pool') => {
		if (busy.value !== undefined) return
		let recoverAmbiguousSend = false
		busy.value = action
		error.value = undefined
		feedback.value = undefined
		try {
			await runWriteAction(
				buildWriteActionConfig({ ...parameters, onTransactionCanceled: parameters.onTransactionCanceled, onTransactionFailed: parameters.onTransactionFailed, onTransactionPrepared: parameters.onTransactionPrepared }, error, copy.connect, {
					action,
					source: copy.title,
					submittedTitle: label,
					showStatusDialog: false,
					universeId,
					scope,
				}),
				async (account, context) => {
					let request = await build()
					const selectedVault = snapshot?.auctionVault
					if (selectedVault !== undefined && getAddress(request.account) === selectedVault.vault) {
						if (snapshot === undefined || request.to === undefined || getAddress(account) !== selectedVault.bidder) throw new Error(copy.ownerRequired)
						const original = request
						const destination = request.to
						const wrap = (data: typeof original.data) =>
							buildSecurityPoolAuctionVaultExecuteRequest({ bidder: selectedVault.bidder, vault: selectedVault.vault, request: { account: original.account, to: destination, value: original.value ?? 0n, data }, sweep: { repToken: snapshot.repToken, recipient: selectedVault.bidder } })
						request = {
							...original,
							...wrap(original.data),
							...(original.refreshReviewData === undefined ? {} : { refreshReviewData: async () => wrap(await (original.refreshReviewData?.() ?? original.data)).data }),
							reviewDescription: deploymentCopy.positionReview(original.reviewDescription ?? label, selectedVault.vault, selectedVault.bidder),
							validateBeforeSubmit: async () => {
								const client = createReviewReadClient()
								const block = await client.getBlock()
								if (block.number === undefined) throw new Error(deploymentCopy.positionBlockRequired)
								const fresh = await authenticateSecurityPoolAuctionVault(client, snapshot.securityPool, selectedVault.vault, block.number)
								if (fresh.bidder !== selectedVault.bidder || fresh.auction !== selectedVault.auction || fresh.bidId !== selectedVault.bidId) throw new Error(deploymentCopy.positionAuthorityChanged)
								await original.validateBeforeSubmit?.()
							},
						}
					}
					context.assertActive()
					const commonCallbacks = { reviewSignal: context.reviewSignal, onTransactionPrepared: parameters.onTransactionPrepared, onTransactionSubmitted: parameters.onTransactionSubmitted }
					if (!deploying || deploymentStep === undefined) return await sendSecurityPoolTransaction(createWalletWriteClient(account, commonCallbacks), request, label, validate)

					const coordinationReason = journal.coordinationReason()
					if (coordinationReason !== undefined) throw new Error(coordinationReason)
					const reader = createReviewReadClient()
					const initialFactoryCount =
						deploymentStep === 'pool'
							? await readSecurityPoolCreationCount(reader, account).catch(cause => {
									throw new Error(deploymentCopy.factoryCountUnavailable, { cause })
								})
							: undefined
					const nonce = (await supportsDeploymentNonce(reader, account)) ? await reader.getTransactionCount({ address: account, blockTag: 'pending' }) : undefined
					const validateDeployment = async () => {
						await request.validateBeforeSubmit?.()
						if (nonce !== undefined && (await reader.getTransactionCount({ address: account, blockTag: 'pending' })) !== nonce) throw new Error(deploymentCopy.walletActivityChanged)
					}
					const id = crypto.randomUUID()
					const saveHash = (hash: Hash, replacedWithoutDeployment?: boolean) => {
						const latest = readProgress()
						if (latest?.pending?.id !== id || latest.pending.hash === hash) return
						saveProgress({ ...latest, pending: { ...latest.pending, hash, nonceVerified: undefined, replacedWithoutDeployment } })
						if (nonce === undefined) return
						void readDeploymentNonce(reader, account, hash)
							.then(nonce => {
								const current = readProgress()
								if (nonce !== undefined && current?.pending?.id === id && current.pending.hash === hash) saveProgress({ ...current, pending: { ...current.pending, nonce, nonceVerified: true } })
							})
							.catch(() => undefined)
					}
					const client = createWalletWriteClient(account, {
						...commonCallbacks,
						assertBeforeSubmit: () =>
							journal.claim(latest => {
								context.assertActive()
								if (latest?.pending !== undefined) throw new Error(deploymentCopy.receiptPending)
								if (deploymentStep === 'rules' && latest?.rules !== undefined) throw new Error(copy.admissionDeployed)
								if (deploymentStep === 'pool') {
									if (latest?.pool !== undefined) throw new Error(copy.poolAlreadyDeployed)
									if (latest?.rules !== progress?.rules) throw new Error(deploymentCopy.rulesChanged)
								}
								// The wallet provides the hash after the send. Lock the step before the wallet receives the transaction.
								return { ...latest, draft, pending: { id, step: deploymentStep, nonce: nonce?.toString(), initialFactoryCount: initialFactoryCount?.toString() } }
							}),
						onTransactionSubmitted: (hash, status, replacedHash) => {
							if (replacedHash === undefined) saveHash(hash)
							parameters.onTransactionSubmitted(hash, status, replacedHash)
						},
					})
					try {
						const result = await sendSecurityPoolTransaction(client, { ...request, ...(nonce === undefined ? {} : { nonce }), validateBeforeSubmit: validateDeployment }, label, validate, {
							onTransactionReplaced: (hash, reason) => {
								saveHash(hash, reason !== 'repriced')
							},
						})
						const pool = settleDeployment(id, result.receipt)
						if (pool !== undefined) await model.load(pool, account, draft.originInput)
						return result
					} catch (failure) {
						const latest = readProgress()
						if (latest?.pending?.id === id) {
							if (latest.pending.hash === undefined && isDefiniteDeploymentRejection(failure)) settleDeployment(id)
							else recoverAmbiguousSend = true
						}
						throw failure
					}
				},
				copy.failure,
				async result => {
					if (action === 'registerSecurityPoolQuestion' || action.startsWith('prepareSecurityPool')) invalidateStatoblastEntries()
					await onConfirmed?.(result)
					await model.refresh()
					feedback.value = copy.confirmed
					parameters.onTransactionPresented({ hash: result.hash, title: copy.confirmed, tone: 'success', showStatusDialog: false, universeId })
				},
			)
		} finally {
			if (error.value !== undefined) lastFailedAction.value = action
			else if (lastFailedAction.value === action && feedback.value !== undefined) lastFailedAction.value = undefined
			busy.value = undefined
			if (recoverAmbiguousSend) await refreshDeploymentProgress()
		}
	}
	const originState = originForkState.value
	const checkedOrigin = originState?.backend === backend && originState.key === originForkKey ? originState : undefined
	const originForked = checkedOrigin?.forked === true
	const originForkReason = checkedOrigin?.reason ?? (originForked ? copy.originForked : undefined)
	const requireUnforkedOrigin = async () => {
		if (origin === undefined) throw new Error(copy.enterOrigin)
		if (!(await isUniverseForked(createReviewReadClient(), origin.universeId))) return
		originForkState.value = { backend, key: originForkKey, forked: true }
		throw new Error(copy.originForked)
	}
	const admissionKey = `${draft.originInput.trim().toLowerCase()}:${draft.admissionMode}:${approvedQuestions.join(',')}`
	const previousAdmission = deployedAdmission.value
	const liveAdmission = previousAdmission?.key === admissionKey && previousAdmission.backend === backend ? previousAdmission : undefined
	const admission = progress?.rules !== undefined && origin !== undefined ? { address: progress.rules, universeId: origin.universeId } : liveAdmission
	const restartReady = progress?.pending !== undefined && samePendingDeployment(progress.pending, restartProof.value)
	const pendingDeploymentReason = progress?.pending === undefined ? undefined : (deploymentRecoveryDetail.value ?? (progress.pending.hash === undefined ? deploymentCopy.walletSendUncertain : deploymentCopy.receiptPending))
	const canStartNewDeployment = progress !== undefined && (progress.pending === undefined || restartReady) && (progress.activated === true || progress.pool === undefined || originForked || (verifiedSetup?.originForkTime ?? 0n) !== 0n)
	const deploymentStatus = (savedPool === undefined ? undefined : copy.poolAlreadyDeployed) ?? (admission === undefined ? copy.deployAdmissionFirst : undefined)
	const questionId = securityPoolUnsignedId(questionInput.value)
	const admissionAllowed = snapshot?.admission.mode !== 'custom'
	const registration = useSignal<{ key: string; reason?: string } | undefined>(undefined)
	const registrationKey = `${backend.id}:${snapshot?.securityPool}:${snapshot?.blockHash}:${questionId}`
	useEffect(() => {
		let current = true
		registration.value = undefined
		if (snapshot !== undefined && questionId !== undefined && admissionAllowed) {
			const client = createConnectedReadClient()
			void requireSecurityPoolQuestionAdmission(client, snapshot.questionAdmissionPolicy, snapshot.securityPool, snapshot.originUniverseId, questionId, snapshot.blockNumber)
				.then(async () => await requireSecurityPoolQuestionHorizon(client, snapshot.securityPool, questionId, snapshot.blockNumber, snapshot.timestamp))
				.then(async () => await requireSecurityPoolQuestionEligibility(client, snapshot.originUniverseId, questionId, snapshot.blockNumber))
				.then(() => {
					if (current) registration.value = { key: registrationKey }
				})
				.catch(failure => {
					if (current) registration.value = { key: registrationKey, reason: getErrorDetail(failure, copy.admissionCheckFailed) ?? copy.admissionCheckFailed }
				})
		}
		return () => {
			current = false
		}
	}, [registrationKey, admissionAllowed])
	const admissionStatus = registration.value?.key === registrationKey ? registration.value.reason : copy.admissionChecking
	const registrationContextReason =
		walletReason ??
		(model.loading ? copy.loading : undefined) ??
		(snapshot === undefined ? copy.enterSecurityPool : undefined) ??
		(!admissionAllowed ? copy.unsupportedAdmission : undefined) ??
		(snapshot !== undefined && (snapshot.forkTime > 0n || snapshot.universeId !== snapshot.originUniverseId) ? copy.registrationOriginRequired : undefined)
	const registerReason = registrationContextReason ?? (questionId === undefined ? copy.registerDisabled : admissionStatus)
	const approvedRegistrationReason = (id: bigint) => registrationContextReason ?? (snapshot?.admission.mode === 'fixed' && snapshot.admission.questions.includes(id) ? undefined : copy.unsupportedAdmission)
	return {
		runSecurityPoolAction: run,
		busy: busy.value,
		lastFailedAction: lastFailedAction.value,
		error: error.value,
		feedback: feedback.value,
		scope,
		ownerReason,
		...draft,
		originForked,
		deploymentLocked: progress !== undefined,
		deploymentProgressPersistent: wallet === undefined || !journal.persistenceUnavailable.value,
		deploymentPool: savedPool,
		deploymentActivated: progress?.activated === true,
		pendingDeployment: progress?.pending,
		pendingDeploymentReason,
		checkingDeploymentReceipt: checkingDeploymentReceipt.value,
		refreshDeploymentProgress: async () => {
			await refreshDeploymentProgress()
		},
		confirmWalletRejection: async () => {
			await refreshDeploymentProgress(true)
		},
		canStartNewDeployment,
		startNewDeployment: async () => {
			if (!canStartNewDeployment || progress === undefined || busy.value !== undefined || checkingDeploymentReceipt.value) return false
			const current = progress.pending === undefined ? progress : await refreshDeploymentProgress()
			if (current === undefined || !currentContext() || !samePendingDeployment(current.pending, progress.pending)) return false
			try {
				if (!(await journal.restart(current))) {
					journal.current.value = readProgress()
					return false
				}
			} catch (failure) {
				if (currentContext()) error.value = getErrorMessage(failure, deploymentCopy.receiptCheckFailed)
				return false
			}
			if (!currentContext()) return false
			const preserveDraft = progress.pending !== undefined
			originEdited.current = preserveDraft
			draftInput.value = preserveDraft ? progress.draft : initialDeploymentDraft(model.universeInput)
			journal.current.value = readProgress()
			restartProof.value = undefined
			deploymentRecoveryDetail.value = undefined
			error.value = undefined
			lastFailedAction.value = undefined
			feedback.value = undefined
			return true
		},
		setMultiplierInput: (multiplierInput: string) => updateDraft({ multiplierInput }),
		setPriorityFeeInput: (priorityFeeInput: string) => updateDraft({ priorityFeeInput }),
		setOriginInput: (originInput: string) => {
			if (journal.current.value !== undefined) return
			originEdited.current = true
			updateDraft({ originInput })
		},
		setHorizonDays: (horizonDays: string) => updateDraft({ horizonDays }),
		setAdmissionMode: (admissionMode: CuratedAdmissionMode) => updateDraft({ admissionMode }),
		setFixedQuestions: (fixedQuestions: string) => updateDraft({ fixedQuestions }),
		fixedQuestionCount: fixedQuestionIds?.length,
		fixedQuestionError,
		setCollateralSymbol: (collateralSymbol: CollateralSymbol) => {
			if (draft.collateralSymbol === collateralSymbol) return
			updateDraft({ collateralSymbol, reportFloor: '', economicsDraft: { ...draft.economicsDraft, minimumCommitment: '', minimumPurchaseFee: '' } })
		},
		collateral,
		setReportFloor: (reportFloor: string) => updateDraft({ reportFloor }),
		setEconomicsField: (field: keyof SecurityPoolCreationDraft, value: string) => updateDraft({ economicsDraft: { ...draftInput.value.economicsDraft, [field]: value } }),
		admissionAddress: admission?.address,
		creationError,
		admissionDeployReason: walletReason ?? (admission === undefined ? (pendingDeploymentReason ?? coordinationReason) : undefined) ?? creationError ?? (origin === undefined ? copy.enterOrigin : undefined) ?? originForkReason ?? (admission !== undefined ? copy.admissionDeployed : undefined),
		deployReason: walletReason ?? pendingDeploymentReason ?? coordinationReason ?? creationError ?? (origin === undefined ? copy.enterOrigin : undefined) ?? originForkReason ?? deploymentStatus,
		deployAdmission: async () => {
			let captured: { key: string; universeId: bigint } | undefined
			await run(
				'deploySecurityPoolAdmission',
				copy.deployAdmission,
				async () => {
					if (parameters.accountAddress === undefined) throw new Error(copy.connect)
					if (creationError !== undefined) throw new Error(creationError)
					if (pendingDeploymentReason !== undefined) throw new Error(pendingDeploymentReason)
					if (journal.current.value?.rules !== undefined) throw new Error(copy.admissionDeployed)
					const key = admissionKey
					const mode = draft.admissionMode
					const ids = [...approvedQuestions]
					if (origin === undefined) throw new Error(copy.enterOrigin)
					const originUniverse = origin.universeId
					captured = { key, universeId: originUniverse }
					return securityPoolAdmissionCreationRequest(parameters.accountAddress, mode, originUniverse, ids)
				},
				requireUnforkedOrigin,
				async result => {
					if (deploying) return
					const address = result.receipt.contractAddress
					if (address === null || address === undefined || captured === undefined) throw new Error(copy.admissionAddressMissing)
					deployedAdmission.value = { ...captured, address, backend }
				},
				'rules',
			)
		},
		deploy: () =>
			run(
				'deploySecurityPool',
				copy.deploy,
				() => {
					if (parameters.accountAddress === undefined) throw new Error(copy.connect)
					if (pendingDeploymentReason !== undefined) throw new Error(pendingDeploymentReason)
					if (journal.current.value?.pool !== undefined) throw new Error(copy.poolAlreadyDeployed)
					if (creationError !== undefined || economics === undefined || admission === undefined || horizon === undefined || origin === undefined) throw new Error(creationError ?? copy.deployAdmissionFirst)
					const chosen = admission
					const mode = draft.admissionMode
					const config = { ...economics }
					const originConfig = { ...origin }
					const validateAdmission = async () => {
						const client = createReviewReadClient()
						if (!(await matchesQuestionRules(client, chosen.address, mode, chosen.universeId, approvedQuestions))) throw new Error(copy.unsupportedAdmission)
					}
					return {
						...securityPoolCreationRequest(parameters.accountAddress, originConfig, horizon, chosen.address, config),
						validateBeforeSubmit: validateAdmission,
						reviewDescription: securityPoolDeploymentReviewDescription(mode, config, collateral, { origin: originConfig, horizon, policy: chosen.address }),
					}
				},
				requireUnforkedOrigin,
				async result => {
					if (deploying) return
					if (parameters.accountAddress === undefined) throw new Error(deploymentCopy.poolAddressUnavailable)
					const securityPool = securityPoolAddressFromCreationReceipt(result.receipt)
					await model.load(securityPool, parameters.accountAddress, admission?.universeId.toString())
				},
				'pool',
			),
		setupStage: model.setup?.stage,
		preparationReason: (stage: number) => {
			if (walletReason !== undefined) return walletReason
			const setup = verifiedSetup
			if (setup === undefined) {
				if (model.savedSetupStage === undefined && savedPool === undefined) return copy.setupPoolRequired
				return model.loading ? copy.checkingSetupProgress : copy.retrySavedSetup
			}
			if (model.loading) return copy.checkingSetupProgress
			if (setup.originForkTime !== 0n) return deploymentCopy.setupClosed
			if (setup.stage >= stage) return deploymentCopy.stageComplete
			return setup.stage === stage - 1 ? undefined : deploymentCopy.previousStageRequired
		},
		prepare: (stage: number) => {
			const selected = verifiedSetup
			return run(
				`prepareSecurityPool${stage}`,
				deploymentCopy.prepareModules,
				() => {
					if (selected === undefined || selected.stage !== stage - 1 || parameters.accountAddress === undefined) throw new Error(deploymentCopy.nextStageRequired)
					if (selected.originForkTime !== 0n) throw new Error(deploymentCopy.setupClosed)
					return {
						...securityPoolPreparationRequest(parameters.accountAddress, selected.securityPool),
						reviewDescription: deploymentCopy.prepareModulesReview(stage, prepareStages.length),
						validateBeforeSubmit: async () => {
							const latest = await loadSecurityPoolSetup(createReviewReadClient(), selected.securityPool, selected.owner)
							if (latest.chainId !== selected.chainId || latest.stage !== selected.stage) throw new Error(deploymentCopy.stageChanged)
							if (latest.originForkTime !== 0n) throw new Error(deploymentCopy.setupClosed)
						},
					}
				},
				undefined,
				async () => {
					if (savedPool === undefined && stage === 4 && selected !== undefined) setEntityFavorite(localEntityScopeForNetwork(backend.profile, 'statoblast', 'pool'), selected.securityPool, true)
				},
			)
		},
		questionInput: questionInput.value,
		setQuestionInput: (value: string) => {
			questionInput.value = value
		},
		registerReason,
		approvedRegistrationReason,
		register: (approvedId?: bigint) =>
			run('registerSecurityPoolQuestion', copy.addQuestion, () => {
				const id = approvedId ?? questionId
				const reason = approvedId === undefined ? registerReason : approvedRegistrationReason(approvedId)
				if (reason !== undefined || snapshot === undefined || id === undefined || parameters.accountAddress === undefined) throw new Error(reason ?? copy.enterSecurityPool)
				const selected = snapshot
				return {
					...securityPoolContractRequest(parameters.accountAddress, selected.securityPool, 'addQuestion', [id]),
					reviewDescription: copy.formatRegisterQuestionReview(formatQuestionIdHex(id)),
					validateBeforeSubmit: async () => {
						const client = createReviewReadClient()
						await requireSecurityPoolQuestionAdmission(client, selected.questionAdmissionPolicy, selected.securityPool, selected.originUniverseId, id)
						// The transaction is included in a later block, at least one second after the latest one.
						const latest = await client.getBlock()
						await requireSecurityPoolQuestionHorizon(client, selected.securityPool, id, latest.number, latest.timestamp + 1n)
						await requireSecurityPoolQuestionEligibility(client, selected.originUniverseId, id, latest.number)
					},
				}
			}),
	}
}
