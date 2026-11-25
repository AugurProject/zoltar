import { invalidateStatoblastEntries } from '../../../protocol/statoblastEntries.js'
import { securityPoolCollateral, type CollateralSymbol } from '../../../protocol/collateral.js'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { signal, useSignal } from '@preact/signals'
import { useEffect, useMemo, useRef } from 'preact/hooks'
import { getAddress, parseUnits, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { createTransactionScope, mergeTransactionScopes } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { localEntityScopeForNetwork, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { getErrorDetail, getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { getActiveBackend, getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import { isUniverseForked, loadSecurityPoolSetup, securityPoolPreparationRequest, securityPoolAddressFromCreationReceipt, securityPoolContractRequest, securityPoolCreationRequest, sendSecurityPoolTransaction, type SecurityPoolTransaction } from '../../../protocol/securityPool.js'
import { securityPoolAmountOrUndefined, securityPoolUnsignedId } from '../lib/draft.js'
import type { useSecurityPool } from './useSecurityPool.js'
import * as copy from '../../../copy/securityPool.js'
import { defaultSecurityPoolCreationDraft, parseFixedSecurityPoolQuestions, parseSecurityPoolCreationEconomics, securityPoolDeploymentReviewDescription, type CuratedAdmissionMode, type SecurityPoolCreationDraft } from '../lib/creation.js'
import { loadSecurityPoolAdmission, securityPoolAdmissionCreationRequest, requireSecurityPoolQuestionAdmission, requireSecurityPoolQuestionHorizon, requireSecurityPoolQuestionEligibility } from '../../../protocol/securityPoolAdmission.js'
import { buildSecurityPoolAuctionVaultExecuteRequest } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { authenticateSecurityPoolAuctionVault } from '../../../protocol/securityPoolRepairAuction.js'
import { deploymentProgressStore, type DeploymentDraft } from '../lib/deploymentProgress.js'

export function useSecurityPoolActions(model: ReturnType<typeof useSecurityPool>, parameters: WriteOperationsParameters, deploying = false) {
	const backend = getActiveBackend()
	const wallet = parameters.accountAddress
	const journal = useMemo(() => {
		const store = deploymentProgressStore(backend.profile, deploying ? wallet : undefined)
		const restored = store.read()
		return { store, restored, current: signal(restored) }
	}, [backend, wallet, deploying])
	const progress = journal.current.value
	const saveProgress = (next: typeof progress) => {
		journal.store.write(next)
		journal.current.value = next
	}
	const originEdited = useRef(false)
	const originForkState = useSignal<{ backend: ReturnType<typeof getActiveBackend>; key: string; forked: boolean } | undefined>(undefined)
	const draftInput = useSignal<DeploymentDraft>({
		collateralSymbol: 'WETH',
		reportFloor: '0.01',
		originInput: model.universeInput,
		multiplierInput: '200',
		priorityFeeInput: (DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS / 10n ** 9n).toString(),
		horizonDays: '30',
		admissionMode: 'open',
		fixedQuestions: '',
		economicsDraft: defaultSecurityPoolCreationDraft(),
	})
	const draft = progress?.draft ?? draftInput.value
	const updateDraft = (patch: Partial<DeploymentDraft>) => {
		if (journal.current.value === undefined) draftInput.value = { ...draftInput.value, ...patch }
	}
	const collateral = securityPoolCollateral(getActiveNetworkProfile(), draft.collateralSymbol)
	const deployedAdmission = useSignal<{ address: Address; key: string; universeId: bigint; backend: ReturnType<typeof getActiveBackend> } | undefined>(undefined)
	const questionInput = useSignal('')
	const busy = useSignal<string | undefined>(undefined)
	const error = useSignal<string | undefined>(undefined)
	const lastFailedAction = useSignal<string | undefined>(undefined)
	const feedback = useSignal<string | undefined>(undefined)
	const snapshot = model.snapshot
	const universeId = snapshot?.universeId ?? securityPoolUnsignedId(model.universeInput, 248) ?? 0n
	const scope = mergeTransactionScopes(createTransactionScope('securityPool', snapshot?.securityPool ?? model.setup?.securityPool), createTransactionScope('security-pool-capital', snapshot?.capitalLedger))
	const walletReason = parameters.accountAddress === undefined ? copy.connect : undefined
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
	useEffect(() => {
		const restored = journal.restored
		if (restored?.pool === undefined || wallet === undefined) return
		if (restored.pool.toLowerCase() === model.managerInput.toLowerCase() && wallet.toLowerCase() === model.ownerInput.toLowerCase() && restored.draft.originInput === model.universeInput) return
		void model.load(restored.pool, wallet, restored.draft.originInput)
	}, [journal, wallet])
	const completedPool = model.setup?.stage === 4 ? model.setup.securityPool : undefined
	useEffect(() => {
		if (savedPool !== undefined && savedPool.toLowerCase() === completedPool?.toLowerCase()) saveProgress(undefined)
	}, [savedPool, completedPool, journal])
	const originForkKey = draft.originInput.trim()
	useEffect(() => {
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
	}, [backend, originForkKey])
	const run = async (action: string, label: string, build: () => Promise<SecurityPoolTransaction> | SecurityPoolTransaction, validate: () => Promise<void> = async () => undefined, onConfirmed?: (result: Awaited<ReturnType<typeof sendSecurityPoolTransaction>>) => Promise<void>) => {
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
						request = {
							...original,
							...buildSecurityPoolAuctionVaultExecuteRequest({ bidder: selectedVault.bidder, vault: selectedVault.vault, request: { account: original.account, to: request.to, value: original.value ?? 0n, data: original.data }, sweep: { repToken: snapshot.repToken, recipient: selectedVault.bidder } }),
							reviewDescription: `${original.reviewDescription ?? label} This operation uses your independent auction vault ${selectedVault.vault}. Returned collateral, ETH and REP are sent to your wallet ${selectedVault.bidder}.`,
							validateBeforeSubmit: async () => {
								const client = createConnectedReadClient()
								const block = await client.getBlock()
								if (block.number === undefined) throw new Error('A confirmed block is required to authenticate this vault.')
								const fresh = await authenticateSecurityPoolAuctionVault(client, snapshot.securityPool, selectedVault.vault, block.number)
								if (fresh.bidder !== selectedVault.bidder || fresh.auction !== selectedVault.auction || fresh.bidId !== selectedVault.bidId) throw new Error('Auction vault authority changed. Review again.')
								await original.validateBeforeSubmit?.()
							},
						}
					}
					context.assertActive()
					const client = createWalletWriteClient(account, { reviewSignal: context.reviewSignal, onTransactionPrepared: parameters.onTransactionPrepared, onTransactionSubmitted: parameters.onTransactionSubmitted })
					return await sendSecurityPoolTransaction(client, request, label, validate)
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
	let fixedQuestionIds: bigint[] = []
	let economics: ReturnType<typeof parseSecurityPoolCreationEconomics> | undefined
	let horizon: bigint | undefined
	let origin: import('@zoltar/statoblast-shared/statoblast/securityPool').SecurityPoolOriginConfig | undefined
	try {
		const originUniverse = securityPoolUnsignedId(draft.originInput, 248)
		if (originUniverse === undefined) throw new Error(copy.enterOrigin)
		const securityMultiplierBps = parseUnits(draft.multiplierInput, 2)
		const reportPriorityFeeAttoEthPerGas = parseUnits(draft.priorityFeeInput, 9)
		if (securityMultiplierBps < 10_500n) throw new Error('Security multiplier must be at least 105%.')
		if (reportPriorityFeeAttoEthPerGas <= 0n) throw new Error('Oracle priority fee must be positive.')
		if (reportPriorityFeeAttoEthPerGas > MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS) throw new Error('Oracle priority fee exceeds the report funding limit.')
		if (collateral.address === undefined) throw new Error('This collateral token is unavailable on the selected network.')
		const minimumReportCollateral = securityPoolAmountOrUndefined(draft.reportFloor, collateral.decimals)
		if (minimumReportCollateral === undefined || minimumReportCollateral === 0n) throw new Error(`Enter a positive report stake floor with up to ${collateral.decimals} decimal places.`)
		origin = { collateralToken: collateral.address, minimumReportCollateral, universeId: originUniverse, securityMultiplierBps, reportPriorityFeeAttoEthPerGas }
		if (draft.admissionMode === 'fixed') fixedQuestionIds = parseFixedSecurityPoolQuestions(draft.fixedQuestions)
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
		if (!(await isUniverseForked(createConnectedReadClient(), origin.universeId))) return
		originForkState.value = { backend, key: originForkKey, forked: true }
		throw new Error(copy.originForked)
	}
	const admissionKey = `${draft.originInput.trim().toLowerCase()}:${draft.admissionMode}:${fixedQuestionIds.join(',')}`
	const previousAdmission = deployedAdmission.value
	const liveAdmission = previousAdmission?.key === admissionKey && previousAdmission.backend === backend ? previousAdmission : undefined
	const admission = progress !== undefined && origin !== undefined ? { address: progress.rules, universeId: origin.universeId } : liveAdmission
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
	const registerReason =
		walletReason ??
		(model.loading ? copy.loading : undefined) ??
		(snapshot === undefined ? copy.enterSecurityPool : undefined) ??
		(!admissionAllowed ? copy.unsupportedAdmission : undefined) ??
		(snapshot !== undefined && (snapshot.forkTime > 0n || snapshot.universeId !== snapshot.originUniverseId) ? copy.registrationOriginRequired : undefined) ??
		(questionId === undefined ? copy.registerDisabled : admissionStatus)
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
		setCollateralSymbol: (collateralSymbol: CollateralSymbol) => {
			if (draft.collateralSymbol === collateralSymbol) return
			updateDraft({ collateralSymbol, reportFloor: '', economicsDraft: { ...draft.economicsDraft, minimumCommitment: '', minimumPurchaseFee: '' } })
		},
		collateral,
		setReportFloor: (reportFloor: string) => updateDraft({ reportFloor }),
		setEconomicsField: (field: keyof SecurityPoolCreationDraft, value: string) => updateDraft({ economicsDraft: { ...draftInput.value.economicsDraft, [field]: value } }),
		admissionAddress: admission?.address,
		creationError,
		admissionDeployReason: walletReason ?? creationError ?? (origin === undefined ? copy.enterOrigin : undefined) ?? originForkReason ?? (admission !== undefined ? copy.admissionDeployed : undefined),
		deployReason: walletReason ?? creationError ?? (origin === undefined ? copy.enterOrigin : undefined) ?? originForkReason ?? deploymentStatus,
		deployAdmission: async () => {
			let captured: { key: string; universeId: bigint } | undefined
			await run(
				'deploySecurityPoolAdmission',
				copy.deployAdmission,
				async () => {
					if (parameters.accountAddress === undefined) throw new Error(copy.connect)
					if (creationError !== undefined) throw new Error(creationError)
					if (journal.current.value !== undefined) throw new Error(copy.admissionDeployed)
					const key = admissionKey
					const mode = draft.admissionMode
					const ids = [...fixedQuestionIds]
					if (origin === undefined) throw new Error(copy.enterOrigin)
					const originUniverse = origin.universeId
					captured = { key, universeId: originUniverse }
					return securityPoolAdmissionCreationRequest(parameters.accountAddress, mode, originUniverse, ids)
				},
				requireUnforkedOrigin,
				async result => {
					const address = result.receipt.contractAddress
					if (address === null || address === undefined || captured === undefined) throw new Error(copy.admissionAddressMissing)
					if (deploying) saveProgress({ rules: address, draft })
					else deployedAdmission.value = { ...captured, address, backend }
				},
			)
		},
		deploy: () =>
			run(
				'deploySecurityPool',
				copy.deploy,
				async () => {
					if (parameters.accountAddress === undefined) throw new Error(copy.connect)
					if (journal.current.value?.pool !== undefined) throw new Error(copy.poolAlreadyDeployed)
					if (creationError !== undefined || economics === undefined || admission === undefined || horizon === undefined || origin === undefined) throw new Error(creationError ?? copy.deployAdmissionFirst)
					const chosen = admission
					const mode = draft.admissionMode
					const config = { ...economics }
					const originConfig = { ...origin }
					const validateAdmission = async () => {
						const client = createConnectedReadClient()
						const verified = await loadSecurityPoolAdmission(client, chosen.address, chosen.universeId)
						if (verified.mode !== mode) throw new Error(copy.unsupportedAdmission)
						if (verified.mode === 'fixed') {
							if (verified.questionCount !== BigInt(fixedQuestionIds.length) || verified.questions.length !== Math.min(64, fixedQuestionIds.length) || verified.questions.some((id, index) => id !== fixedQuestionIds[index])) throw new Error(copy.unsupportedAdmission)
							for (let offset = verified.questions.length; offset < fixedQuestionIds.length; offset += 64) {
								const page = await loadSecurityPoolAdmission(client, chosen.address, chosen.universeId, undefined, BigInt(offset))
								const expected = fixedQuestionIds.slice(offset, offset + 64)
								if (page.mode !== 'fixed' || page.questions.length !== expected.length || page.questions.some((id, index) => id !== expected[index])) throw new Error(copy.unsupportedAdmission)
							}
						}
					}
					await validateAdmission()
					return {
						...securityPoolCreationRequest(parameters.accountAddress, originConfig, horizon, chosen.address, config),
						validateBeforeSubmit: validateAdmission,
						reviewDescription: securityPoolDeploymentReviewDescription(mode, config, collateral),
					}
				},
				requireUnforkedOrigin,
				async result => {
					if (parameters.accountAddress === undefined) throw new Error('Security pool deployment address unavailable.')
					const securityPool = securityPoolAddressFromCreationReceipt(result.receipt)
					if (progress !== undefined) saveProgress({ ...progress, pool: securityPool })
					await model.load(securityPool, parameters.accountAddress, admission?.universeId.toString())
				},
			),
		setupStage: model.setup?.stage,
		preparationReason: (stage: number) => {
			if (walletReason !== undefined) return walletReason
			const setup = model.setup
			if (setup === undefined) {
				if (model.savedSetupStage === undefined) return copy.setupPoolRequired
				return model.loading ? copy.checkingSetupProgress : copy.retrySavedSetup
			}
			if (model.loading) return copy.checkingSetupProgress
			if (setup.originForkTime !== 0n) return 'Origin universe forked; setup is permanently closed.'
			if (setup.stage >= stage) return 'This setup stage is complete.'
			return setup.stage === stage - 1 ? undefined : 'Complete the previous setup stage first.'
		},
		prepare: (stage: number) => {
			const selected = model.setup
			return run(
				`prepareSecurityPool${stage}`,
				'Prepare security pool modules',
				() => {
					if (selected === undefined || selected.stage !== stage - 1 || parameters.accountAddress === undefined) throw new Error('Refresh and select the next setup stage.')
					if (selected.originForkTime !== 0n) throw new Error('Origin universe forked; setup is permanently closed.')
					return {
						...securityPoolPreparationRequest(parameters.accountAddress, selected.securityPool),
						reviewDescription: `Complete setup stage ${stage} of 4. This deploys the next bounded group of custody modules. No REP or trader ETH is deposited.`,
						validateBeforeSubmit: async () => {
							const latest = await loadSecurityPoolSetup(createConnectedReadClient(), selected.securityPool, selected.owner)
							if (latest.chainId !== selected.chainId || latest.stage !== selected.stage) throw new Error('Setup advanced. Refresh before sending another preparation transaction.')
							if (latest.originForkTime !== 0n) throw new Error('Origin universe forked; setup is permanently closed.')
						},
					}
				},
				undefined,
				async () => {
					if (stage === 4 && selected !== undefined) setEntityFavorite(localEntityScopeForNetwork(backend.profile, 'statoblast', 'pool'), selected.securityPool, true)
				},
			)
		},
		questionInput: questionInput.value,
		setQuestionInput: (value: string) => {
			questionInput.value = value
		},
		registerReason,
		register: () =>
			run('registerSecurityPoolQuestion', copy.addQuestion, () => {
				if (registerReason !== undefined || snapshot === undefined || questionId === undefined || parameters.accountAddress === undefined) throw new Error(registerReason ?? copy.enterSecurityPool)
				const selected = snapshot
				const id = questionId
				return {
					...securityPoolContractRequest(parameters.accountAddress, selected.securityPool, 'addQuestion', [id]),
					reviewDescription: copy.formatRegisterQuestionReview(formatQuestionIdHex(id)),
					validateBeforeSubmit: async () => {
						const client = createConnectedReadClient()
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
