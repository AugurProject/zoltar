import { deployment as deploymentCopy } from '../../../copy/securityPoolTransactions.js'
import { prepareStages } from '../../../copy/securityPoolCapital.js'
import { invalidateStatoblastEntries } from '../../../protocol/statoblastEntries.js'
import { securityPoolCollateral, type CollateralSymbol } from '../../../protocol/collateral.js'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { signal, useSignal } from '@preact/signals'
import { useEffect, useMemo, useRef } from 'preact/hooks'
import { getAddress, parseUnits, TransactionLookupNotFoundError, type Address, type Hash, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { createTransactionScope, mergeTransactionScopes } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { localEntityScopeForNetwork, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { getErrorDetail, getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { currentStateCheckFailed } from '@zoltar/ui-core-shared/copy/transaction.js'
import { getTransactionFailureKind } from '@zoltar/ui-core-shared/transactions/transactionLifecycle.js'
import { getActiveBackend, getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import { isUniverseForked, loadSecurityPoolSetup, securityPoolPreparationRequest, securityPoolAddressFromCreationReceipt, securityPoolContractRequest, securityPoolCreationRequest, sendSecurityPoolTransaction, type SecurityPoolTransaction } from '../../../protocol/securityPool.js'
import { securityPoolAmountOrUndefined, securityPoolUnsignedId } from '../lib/draft.js'
import type { useSecurityPool } from './useSecurityPool.js'
import * as copy from '../../../copy/securityPool.js'
import { defaultSecurityPoolCreationDraft, parseFixedSecurityPoolQuestions, parseSecurityPoolCreationEconomics, securityPoolDeploymentReviewDescription, type CuratedAdmissionMode, type SecurityPoolCreationDraft } from '../lib/creation.js'
import { securityPoolAdmissionCreationRequest, requireSecurityPoolQuestionAdmission, requireSecurityPoolQuestionHorizon, requireSecurityPoolQuestionEligibility } from '../../../protocol/securityPoolAdmission.js'
import { buildSecurityPoolAuctionVaultExecuteRequest } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { authenticateSecurityPoolAuctionVault } from '../../../protocol/securityPoolRepairAuction.js'
import { deploymentProgressStore, type DeploymentDraft } from '../lib/deploymentProgress.js'
import { matchesQuestionRules, readDeploymentNonce, recoverQuestionRules } from '../lib/deploymentRecovery.js'
import { withStatoblastRequestTimeout } from '../../../protocol/requestTimeout.js'

const MINIMUM_SECURITY_MULTIPLIER_BPS = 10_500n

const createReviewReadClient = () => withStatoblastRequestTimeout(createConnectedReadClient(), currentStateCheckFailed)

function initialDeploymentDraft(originInput: string): DeploymentDraft {
	return {
		collateralSymbol: 'WETH',
		reportFloor: '0.01',
		originInput,
		multiplierInput: '200',
		priorityFeeInput: (DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS / 10n ** 9n).toString(),
		horizonDays: '30',
		admissionMode: 'open',
		fixedQuestions: '',
		economicsDraft: defaultSecurityPoolCreationDraft(),
	}
}

export function useSecurityPoolActions(model: ReturnType<typeof useSecurityPool>, parameters: WriteOperationsParameters, deploying = false, walletUnavailableReason?: string, checkDeploymentOrigin = deploying) {
	const backend = getActiveBackend()
	const wallet = parameters.accountAddress
	const journal = useMemo(() => {
		const store = deploymentProgressStore(backend.profile, deploying ? wallet : undefined)
		const restored = store.read()
		return { store, restored, current: signal(restored), persistent: signal(store.available) }
	}, [backend, wallet, deploying])
	const progress = journal.current.value
	const readProgress = () => (journal.persistent.value ? journal.store.read() : journal.current.value)
	const saveProgress = (next: typeof progress) => {
		if (journal.persistent.value && !journal.store.write(next)) journal.persistent.value = false
		journal.current.value = next
	}
	const originEdited = useRef(false)
	const originForkState = useSignal<{ backend: ReturnType<typeof getActiveBackend>; key: string; forked: boolean } | undefined>(undefined)
	const draftInput = useSignal(initialDeploymentDraft(model.universeInput))
	const draft = progress?.draft ?? draftInput.value
	const updateDraft = (patch: Partial<DeploymentDraft>) => {
		if (journal.current.value === undefined) draftInput.value = { ...draftInput.value, ...patch }
	}
	const collateral = securityPoolCollateral(getActiveNetworkProfile(), draft.collateralSymbol)
	const deployedAdmission = useSignal<{ address: Address; key: string; universeId: bigint; backend: ReturnType<typeof getActiveBackend> } | undefined>(undefined)
	const questionInput = useSignal('')
	const busy = useSignal<string | undefined>(undefined)
	const checkingDeploymentReceipt = useSignal(false)
	const error = useSignal<string | undefined>(undefined)
	const lastFailedAction = useSignal<string | undefined>(undefined)
	const feedback = useSignal<string | undefined>(undefined)
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
		// A failed read leaves the check to submission, which repeats it for a universe that forks after this one.
		const load = async () => {
			if (originUniverse === undefined) return
			const forked = await isUniverseForked(createConnectedReadClient(), originUniverse)
			if (current) originForkState.value = { backend, key: originForkKey, forked }
		}
		void load().catch(() => undefined)
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
	const refreshDeploymentProgress = async () => {
		if (checkingDeploymentReceipt.value || busy.value !== undefined || wallet === undefined) return
		const latest = readProgress()
		journal.current.value = latest
		const pending = latest?.pending
		if (latest === undefined || pending?.hash === undefined || pending.restartAllowed === true) {
			if (latest?.pool !== undefined && (latest.pool !== model.managerInput || model.setup?.securityPool !== latest.pool)) await model.load(latest.pool, wallet, latest.draft.originInput)
			else await model.refresh()
			return
		}
		checkingDeploymentReceipt.value = true
		error.value = undefined
		try {
			const client = createReviewReadClient()
			const receipt = await client.getTransactionReceipt({ hash: pending.hash }).catch((failure: unknown) => {
				if (failure instanceof TransactionLookupNotFoundError && failure.kind === 'receipt') return undefined
				throw failure
			})
			if (receipt !== undefined) {
				const pool = settleDeployment(pending.id, receipt)
				if (pool !== undefined) await model.load(pool, wallet, latest.draft.originInput)
			} else if (pending.step === 'rules') {
				const nonce = pending.nonce ?? (await readDeploymentNonce(client, wallet, pending.hash))
				const originUniverse = securityPoolUnsignedId(latest.draft.originInput, 248)
				if (nonce === undefined || originUniverse === undefined) return
				const updated = readProgress()
				if (updated?.pending?.id !== pending.id || updated.pending.hash !== pending.hash) return
				if (updated.pending.nonce === undefined) saveProgress({ ...updated, pending: { ...updated.pending, nonce } })
				const ids = updated.draft.admissionMode === 'fixed' ? parseFixedSecurityPoolQuestions(updated.draft.fixedQuestions) : []
				const recovered = await recoverQuestionRules(client, wallet, BigInt(nonce), updated.draft.admissionMode, originUniverse, ids)
				if (recovered === undefined) return
				const current = readProgress()
				if (current?.pending?.id !== pending.id || current.pending.hash !== pending.hash) return
				if (recovered.rules === undefined) saveProgress({ ...current, pending: { ...current.pending, restartAllowed: true } })
				else saveProgress({ ...current, rules: recovered.rules, pending: undefined })
			}
		} catch (failure) {
			error.value = getErrorMessage(failure, deploymentCopy.receiptCheckFailed)
		} finally {
			checkingDeploymentReceipt.value = false
		}
	}
	useEffect(() => {
		if (journal.restored?.pending !== undefined) void refreshDeploymentProgress()
	}, [journal])
	const run = async (action: string, label: string, build: () => Promise<SecurityPoolTransaction> | SecurityPoolTransaction, validate: () => Promise<void> = async () => undefined, onConfirmed?: (result: Awaited<ReturnType<typeof sendSecurityPoolTransaction>>) => Promise<void>, deploymentStep?: 'rules' | 'pool') => {
		if (busy.value !== undefined) return
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

					const id = crypto.randomUUID()
					const saveHash = (hash: Hash) => {
						const latest = readProgress()
						if (latest?.pending?.id !== id || latest.pending.hash === hash) return
						saveProgress({ ...latest, pending: { ...latest.pending, hash } })
						if (latest.pending.nonce !== undefined || deploymentStep !== 'rules') return
						void readDeploymentNonce(createReviewReadClient(), account, hash)
							.then(nonce => {
								const current = readProgress()
								if (nonce !== undefined && current?.pending?.id === id && current.pending.hash === hash) saveProgress({ ...current, pending: { ...current.pending, nonce } })
							})
							.catch(() => undefined)
					}
					const client = createWalletWriteClient(account, {
						...commonCallbacks,
						assertBeforeSubmit: () => {
							context.assertActive()
							const latest = readProgress()
							if (latest?.pending !== undefined) throw new Error(deploymentCopy.receiptPending)
							if (deploymentStep === 'rules' && latest?.rules !== undefined) throw new Error(copy.admissionDeployed)
							if (deploymentStep === 'pool') {
								if (latest?.pool !== undefined) throw new Error(copy.poolAlreadyDeployed)
								if (latest?.rules !== progress?.rules) throw new Error(deploymentCopy.rulesChanged)
							}
							// The wallet provides the hash after the send. Lock the step before the wallet receives the transaction.
							saveProgress({ ...latest, draft, pending: { id, step: deploymentStep } })
						},
						onTransactionSubmitted: (hash, status, replacedHash) => {
							if (replacedHash === undefined) saveHash(hash)
							parameters.onTransactionSubmitted(hash, status, replacedHash)
						},
					})
					try {
						const result = await sendSecurityPoolTransaction(client, request, label, validate, {
							onTransactionReplaced: (hash, reason) => {
								if (reason === 'repriced') saveHash(hash)
								else settleDeployment(id)
							},
						})
						const pool = settleDeployment(id, result.receipt)
						if (pool !== undefined) await model.load(pool, account, draft.originInput)
						return result
					} catch (failure) {
						const kind = getTransactionFailureKind(failure)
						const latest = readProgress()
						if (latest?.pending?.id === id && (latest.pending.hash === undefined || kind !== 'error')) settleDeployment(id)
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
		}
	}
	let creationError: string | undefined
	let fixedQuestionIds: bigint[] | undefined
	let fixedQuestionError: string | undefined
	if (draft.admissionMode === 'fixed') {
		try {
			fixedQuestionIds = parseFixedSecurityPoolQuestions(draft.fixedQuestions)
		} catch (failure) {
			fixedQuestionError = getErrorMessage(failure, copy.creationInvalid)
		}
	}
	const approvedQuestions = fixedQuestionIds ?? []
	let economics: ReturnType<typeof parseSecurityPoolCreationEconomics> | undefined
	let horizon: bigint | undefined
	let origin: import('@zoltar/statoblast-shared/statoblast/securityPool').SecurityPoolOriginConfig | undefined
	try {
		const originUniverse = securityPoolUnsignedId(draft.originInput, 248)
		if (originUniverse === undefined) throw new Error(copy.enterOrigin)
		const securityMultiplierBps = parseUnits(draft.multiplierInput, 2)
		const reportPriorityFeeAttoEthPerGas = parseUnits(draft.priorityFeeInput, 9)
		if (securityMultiplierBps < MINIMUM_SECURITY_MULTIPLIER_BPS) throw new Error(deploymentCopy.securityMultiplierTooLow)
		if (reportPriorityFeeAttoEthPerGas <= 0n) throw new Error(deploymentCopy.priorityFeeRequired)
		if (reportPriorityFeeAttoEthPerGas > MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS) throw new Error(deploymentCopy.priorityFeeAboveLimit)
		if (collateral.address === undefined) throw new Error(deploymentCopy.collateralUnavailable)
		const minimumReportCollateral = securityPoolAmountOrUndefined(draft.reportFloor, collateral.decimals)
		if (minimumReportCollateral === undefined || minimumReportCollateral === 0n) throw new Error(deploymentCopy.reportStakeRequired(collateral.decimals))
		origin = { collateralToken: collateral.address, minimumReportCollateral, universeId: originUniverse, securityMultiplierBps, reportPriorityFeeAttoEthPerGas }
		if (fixedQuestionError !== undefined) throw new Error(fixedQuestionError)
		economics = parseSecurityPoolCreationEconomics(draft.economicsDraft, collateral.decimals)
		if (!/^\d+$/.test(draft.horizonDays)) throw new Error(copy.horizonInvalid)
		horizon = BigInt(draft.horizonDays) * 86400n
		if (horizon === 0n || horizon >= 1n << 48n) throw new Error(copy.horizonInvalid)
	} catch (failure) {
		creationError = getErrorMessage(failure, copy.creationInvalid)
	}
	const originForked = originForkState.value?.backend === backend && originForkState.value.key === originForkKey && originForkState.value.forked
	const originForkReason = originForked ? copy.originForked : undefined
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
	let pendingDeploymentReason: string | undefined
	if (progress?.pending !== undefined) {
		if (progress.pending.restartAllowed === true) pendingDeploymentReason = deploymentCopy.restartAvailable
		else pendingDeploymentReason = progress.pending.hash === undefined ? deploymentCopy.walletSendUncertain : deploymentCopy.receiptPending
	}
	const canStartNewDeployment = progress !== undefined && (progress.pending === undefined || progress.pending.restartAllowed === true) && (progress.activated === true || progress.pool === undefined || originForked || (verifiedSetup?.originForkTime ?? 0n) !== 0n)
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
		deploymentProgressPersistent: wallet === undefined || journal.persistent.value,
		deploymentPool: savedPool,
		deploymentActivated: progress?.activated === true,
		pendingDeployment: progress?.pending,
		checkingDeploymentReceipt: checkingDeploymentReceipt.value,
		refreshDeploymentProgress,
		canStartNewDeployment,
		startNewDeployment: () => {
			if (!canStartNewDeployment || progress === undefined || busy.value !== undefined) return false
			if (journal.persistent.value) {
				const discarded = journal.store.discard(progress)
				if (discarded === 'changed') {
					journal.current.value = readProgress()
					return false
				}
				if (discarded === 'unavailable') journal.persistent.value = false
			}
			originEdited.current = false
			draftInput.value = initialDeploymentDraft(model.universeInput)
			journal.current.value = undefined
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
		admissionDeployReason: walletReason ?? (admission === undefined ? pendingDeploymentReason : undefined) ?? creationError ?? (origin === undefined ? copy.enterOrigin : undefined) ?? originForkReason ?? (admission !== undefined ? copy.admissionDeployed : undefined),
		deployReason: walletReason ?? pendingDeploymentReason ?? creationError ?? (origin === undefined ? copy.enterOrigin : undefined) ?? originForkReason ?? deploymentStatus,
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
						reviewDescription: securityPoolDeploymentReviewDescription(mode, config, collateral, horizon),
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
