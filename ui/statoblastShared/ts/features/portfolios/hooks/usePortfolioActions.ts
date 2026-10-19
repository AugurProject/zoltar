import { useSignal } from '@preact/signals'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import { encodeFunctionData, formatEther, formatUnits, getAddress, isAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioRevokePolicyRequest, exportPortfolioTransaction, loadPortfolioSnapshot, planPortfolioAllocations } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { statoblast_SecurityPool_SecurityPool as securityPoolArtifact, statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact } from '../../../contractArtifact.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { createConnectedReadClient, createWalletWriteClient, type ReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { createTransactionScope, mergeTransactionScopes, securityPoolTransactionScope } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { createActiveEnvironmentGuard, getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import { portfolioContractRequest, portfolioCreationRequest, portfolioReadClient, loadPortfolioPolicy, sendPortfolioTransaction, vaultArtifact, capturePortfolioBatchReview, portfolioPolicyReviewRequest, type PortfolioTransaction } from '../../../protocol/securityPoolPortfolio.js'
import { emptyAllocationDraft, parseAllocationDrafts, parsePortfolioAmount, type AllocationDraft } from '../lib/draft.js'
import type { usePortfolio } from './usePortfolio.js'
import * as copy from '../../../copy/portfolio.js'
import { defaultPortfolioCreationDraft, parseFixedPortfolioQuestions, parsePortfolioCreationEconomics, type CuratedAdmissionMode, type PortfolioCreationDraft } from '../lib/creation.js'
import { loadPortfolioAdmission, portfolioAdmissionCreationRequest, requirePortfolioQuestionAdmission } from '../../../protocol/securityPoolPortfolioAdmission.js'

type PortfolioModel = Pick<ReturnType<typeof usePortfolio>, 'snapshot' | 'selection' | 'managerInput' | 'ownerInput' | 'loading' | 'error' | 'load' | 'refresh'>

export function usePortfolioActions(model: PortfolioModel, parameters: WriteOperationsParameters, selectedUniverse: bigint) {
	const originInput = useSignal('')
	const horizonDays = useSignal('30')
	const admissionMode = useSignal<CuratedAdmissionMode>('open')
	const fixedQuestions = useSignal('')
	const economicsDraft = useSignal(defaultPortfolioCreationDraft())
	const deployedAdmission = useSignal<{ address: Address; key: string; universeId: bigint; backend: ReturnType<typeof getActiveBackend> } | undefined>(undefined)
	const questionInput = useSignal('')
	const fundingAmount = useSignal('')
	const drafts = useSignal<Record<string, AllocationDraft>>({})
	const reserve = useSignal('0')
	const health = useSignal('12000')
	const executor = useSignal('')
	const expiryHours = useSignal('24')
	const depositBudget = useSignal('')
	const commitmentBudget = useSignal('')
	const busy = useSignal<string | undefined>(undefined)
	const error = useSignal<string | undefined>(undefined)
	const feedback = useSignal<string | undefined>(undefined)
	const exported = useSignal<string | undefined>(undefined)
	const exportGeneration = useRef(0)
	const policySnapshot = useSignal<{ vault: Address; backend: ReturnType<typeof getActiveBackend>; blockNumber: bigint; policy: Awaited<ReturnType<typeof loadPortfolioPolicy>> } | undefined>(undefined)
	const policyReadError = useSignal<string | undefined>(undefined)
	const snapshot = model.snapshot
	const selection = model.selection
	const vault = selection?.vault === zeroAddress ? undefined : selection?.vault
	const branch = snapshot?.branches.find(item => item.universeId === selectedUniverse)
	const backend = getActiveBackend()
	let creationError: string | undefined
	let fixedQuestionIds: bigint[] = []
	let creationEconomics: ReturnType<typeof parsePortfolioCreationEconomics> | undefined
	try {
		if (admissionMode.value === 'fixed') fixedQuestionIds = parseFixedPortfolioQuestions(fixedQuestions.value)
		creationEconomics = parsePortfolioCreationEconomics(economicsDraft.value)
	} catch (failure) {
		creationError = getErrorMessage(failure, copy.creationInvalid)
	}
	const admissionKey = `${originInput.value.trim().toLowerCase()}:${admissionMode.value}:${fixedQuestionIds.join(',')}`
	const admission = deployedAdmission.value?.key === admissionKey && deployedAdmission.value.backend === backend ? deployedAdmission.value : undefined
	const registration = useSignal<{ key: string; reason?: string } | undefined>(undefined)
	const registrationKey = `${selection?.portfolio}:${selection?.originUniverseId}:${questionInput.value}:${backend.id}`
	useEffect(() => {
		let current = true
		registration.value = undefined
		if (selection !== undefined && /^(0x[0-9a-fA-F]+|\d+)$/.test(questionInput.value)) {
			const questionId = BigInt(questionInput.value)
			const client = backend.createReadClient()
			void (async () => {
				const policyValue = await client.readContract({ address: selection.portfolio, abi: portfolioArtifact.abi, functionName: 'questionAdmissionPolicy' })
				if (typeof policyValue !== 'string' || !isAddress(policyValue)) throw new Error(copy.admissionCheckFailed)
				const policy = getAddress(policyValue)
				const verified = await loadPortfolioAdmission(client, policy, selection.originUniverseId)
				if (verified.mode === 'custom') throw new Error(copy.unsupportedAdmission)
				await requirePortfolioQuestionAdmission(client, policy, selection.portfolio, selection.originUniverseId, questionId)
				if (current) registration.value = { key: registrationKey }
			})().catch(failure => {
				if (current) registration.value = { key: registrationKey, reason: getErrorMessage(failure, copy.admissionCheckFailed) }
			})
		}
		return () => {
			current = false
		}
	}, [backend, registrationKey])
	const registrationReason = registration.value?.key === registrationKey ? registration.value.reason : copy.admissionChecking
	const loadedPolicy = policySnapshot.value
	const policy = loadedPolicy?.vault === vault && loadedPolicy?.backend === backend && loadedPolicy?.blockNumber === snapshot?.blockNumber ? loadedPolicy?.policy : undefined
	useEffect(() => {
		let current = true
		policySnapshot.value = undefined
		policyReadError.value = undefined
		if (vault !== undefined && snapshot !== undefined)
			void loadPortfolioPolicy(backend.createReadClient(), vault, snapshot.blockNumber)
				.then(next => {
					if (current) policySnapshot.value = { vault, backend, blockNumber: snapshot.blockNumber, policy: next }
				})
				.catch(failure => {
					if (current) policyReadError.value = getErrorMessage(failure, copy.snapshotFailed)
				})
		return () => {
			current = false
		}
	}, [backend, vault, snapshot])
	const connectedOwner = parameters.accountAddress !== undefined && selection?.owner.toLowerCase() === parameters.accountAddress.toLowerCase()
	const scope = mergeTransactionScopes(createTransactionScope('portfolio', selection?.portfolio), createTransactionScope('portfolio-vault', vault), ...(snapshot?.branches.flatMap(item => item.positions.map(position => securityPoolTransactionScope(position.pool))) ?? []))
	useLayoutEffect(() => {
		drafts.value = {}
		exported.value = undefined
		error.value = undefined
		feedback.value = undefined
		return () => {
			exportGeneration.current += 1
		}
	}, [backend, model.managerInput.trim().toLowerCase(), model.ownerInput.trim().toLowerCase(), selectedUniverse, snapshot?.questions.join(',')])
	const invalidateExport = () => {
		exportGeneration.current += 1
		exported.value = undefined
	}
	const setDraft = (questionId: bigint, patch: Partial<AllocationDraft>) => {
		if (busy.value !== undefined) return
		drafts.value = { ...drafts.value, [String(questionId)]: { ...emptyAllocationDraft(), ...drafts.value[String(questionId)], ...patch } }
		invalidateExport()
	}
	let plan: ReturnType<typeof planPortfolioAllocations> | undefined
	let planError: string | undefined
	try {
		if (snapshot !== undefined) plan = planPortfolioAllocations({ snapshot, universeId: selectedUniverse, minimumIdleAttoRep: parsePortfolioAmount(reserve.value), minimumHealthFactorBps: BigInt(health.value), allocations: parseAllocationDrafts(drafts.value) })
	} catch (failure) {
		planError = failure instanceof Error ? failure.message : copy.allocationNeeded
	}
	const walletReason = parameters.accountAddress === undefined ? copy.connect : undefined
	const ownerReason = walletReason ?? (!connectedOwner ? copy.ownerRequired : undefined)
	const vaultReason = vault === undefined ? copy.noVault : ownerReason
	const run = async (action: string, label: string, build: () => Promise<PortfolioTransaction> | PortfolioTransaction, validate: () => Promise<void> = async () => undefined, onConfirmed?: (result: Awaited<ReturnType<typeof sendPortfolioTransaction>>) => Promise<void>) => {
		if (busy.value !== undefined) return
		busy.value = action
		feedback.value = undefined
		try {
			await runWriteAction(
				buildWriteActionConfig({ ...parameters, onTransactionCanceled: parameters.onTransactionCanceled, onTransactionFailed: parameters.onTransactionFailed, onTransactionPrepared: parameters.onTransactionPrepared }, error, copy.connect, {
					action,
					source: copy.title,
					submittedTitle: label,
					showStatusDialog: false,
					universeId: selectedUniverse,
					scope,
				}),
				async (account, context) => {
					const request = await build()
					context.assertActive()
					const client = createWalletWriteClient(account, { reviewSignal: context.reviewSignal, onTransactionPrepared: parameters.onTransactionPrepared, onTransactionSubmitted: parameters.onTransactionSubmitted })
					return await sendPortfolioTransaction(client, request, label, validate)
				},
				copy.failure,
				async result => {
					feedback.value = copy.confirmed
					await onConfirmed?.(result)
					await model.refresh()
					parameters.onTransactionPresented({ hash: result.hash, title: copy.confirmed, tone: 'success', showStatusDialog: false, universeId: selectedUniverse })
				},
			)
		} finally {
			busy.value = undefined
		}
	}
	const owner = () => {
		if (selection === undefined) throw new Error(copy.enterPortfolio)
		return selection.owner
	}
	const requireVault = () => {
		if (vault === undefined) throw new Error(copy.noVault)
		return vault
	}
	const batchRequest = () => {
		if (model.loading) throw new Error(copy.loading)
		if (plan === undefined) throw new Error(planError ?? copy.allocationNeeded)
		if (snapshot === undefined) throw new Error(copy.enterPortfolio)
		const review = capturePortfolioBatchReview(owner(), requireVault(), snapshot, plan)
		const reads = { portfolio: snapshot.portfolio, vault: snapshot.vault, universeIds: snapshot.branches.map(item => item.universeId), questionIds: [...snapshot.questions], maximumAllocatedQuestions: 0 }
		return { ...review.request, validateBeforeSubmit: async () => review.validateSnapshot(await loadPortfolioSnapshot({ client: portfolioReadClient(createConnectedReadClient()), ...reads })) }
	}
	const policyRequest = async (client: ReadClient = createConnectedReadClient()) => {
		if (policy === undefined) throw new Error(policyReadError.value ?? copy.policyLoading)
		const previousPolicy = structuredClone(policy)
		const allocations = parseAllocationDrafts(drafts.value)
		if (allocations.length === 0) throw new Error(copy.policyRulesNeeded)
		const hours = BigInt(expiryHours.value)
		if (hours <= 0n || hours > 8760n) throw new Error('Choose an expiry between 1 and 8760 hours.')
		const policyOwner = owner()
		const policyVault = requireVault()
		const config = {
			universeId: selectedUniverse,
			executor: getAddress(executor.value),
			depositBudgetAttoRep: parsePortfolioAmount(depositBudget.value),
			commitmentIncreaseBudgetAttoEth: parsePortfolioAmount(commitmentBudget.value),
			minimumIdleAttoRep: parsePortfolioAmount(reserve.value),
			minimumHealthFactorBps: BigInt(health.value),
		}
		const rules = allocations.map(allocation => ({ questionId: allocation.questionId, depositBudgetAttoRep: allocation.depositAttoRep, maximumCommitmentAttoEth: allocation.commitmentAttoEth }))
		const block = await client.getBlock()
		return portfolioPolicyReviewRequest({ owner: policyOwner, vault: policyVault, previousPolicy, config: { ...config, expiresAt: block.timestamp + hours * 3600n }, rules, client })
	}
	const exportRequest = async (build: (client: ReadClient) => Promise<PortfolioTransaction> | PortfolioTransaction) => {
		const requestGeneration = ++exportGeneration.current
		const environment = createActiveEnvironmentGuard()
		const current = () => requestGeneration === exportGeneration.current && environment.isCurrent() && backend === getActiveBackend()
		try {
			if (!current()) return
			const client = backend.createReadClient()
			const request = await build(client)
			if (!current()) return
			if (request.to === undefined) throw new Error('Deployment export is unavailable.')
			const chainId = await client.getChainId()
			if (!current()) return
			await request.validateBeforeSubmit?.()
			if (!current()) return
			exported.value = JSON.stringify(exportPortfolioTransaction({ chainId, request: { ...request, to: request.to, value: request.value ?? 0n } }), undefined, 2)
			error.value = undefined
		} catch (failure) {
			if (current()) error.value = getErrorMessage(failure, copy.failure)
		}
	}
	const createVaultRequest = () => {
		if (selection === undefined) throw new Error(copy.enterPortfolio)
		return { ...portfolioContractRequest(selection.owner, selection.portfolio, 'createVault'), reviewDescription: `Create a portfolio vault owned by ${selection.owner} in portfolio ${selection.portfolio}.` }
	}
	let fundingError: string | undefined
	let horizonError: string | undefined
	try {
		const seconds = BigInt(horizonDays.value) * 86400n
		if (seconds <= 0n || seconds >= 1n << 48n) horizonError = copy.horizonInvalid
	} catch (failure) {
		if (!(failure instanceof SyntaxError)) throw failure
		horizonError = copy.horizonInvalid
	}
	try {
		if (parsePortfolioAmount(fundingAmount.value) <= 0n) fundingError = copy.positiveAmount
	} catch (failure) {
		fundingError = failure instanceof Error ? failure.message : copy.positiveAmount
	}
	let policyError: string | undefined
	try {
		if (!isAddress(executor.value) || getAddress(executor.value) === zeroAddress) policyError = copy.executor
		else if (parsePortfolioAmount(depositBudget.value) === 0n && parsePortfolioAmount(commitmentBudget.value) === 0n) policyError = copy.policyRulesNeeded
		else if (parseAllocationDrafts(drafts.value).length === 0) policyError = copy.policyRulesNeeded
	} catch (failure) {
		policyError = failure instanceof Error ? failure.message : copy.policyRulesNeeded
	}
	return {
		runPortfolioAction: run,
		drafts: drafts.value,
		setDraft,
		reserve: reserve.value,
		setReserve: (value: string) => {
			reserve.value = value
			invalidateExport()
		},
		health: health.value,
		setHealth: (value: string) => {
			health.value = value
			invalidateExport()
		},
		admissionMode: admissionMode.value,
		setAdmissionMode: (value: CuratedAdmissionMode) => {
			if (busy.value !== undefined) return
			admissionMode.value = value
		},
		fixedQuestions: fixedQuestions.value,
		setFixedQuestions: (value: string) => {
			fixedQuestions.value = value
		},
		economicsDraft: economicsDraft.value,
		setEconomicsField: (field: keyof PortfolioCreationDraft, value: string) => {
			economicsDraft.value = { ...economicsDraft.value, [field]: value }
		},
		admissionAddress: admission?.address,
		creationError,
		admissionDeployReason: walletReason ?? (!isAddress(originInput.value) ? copy.enterOrigin : creationError) ?? (admission !== undefined ? copy.admissionDeployed : undefined),
		deployAdmission: async () => {
			let captured: { key: string; universeId: bigint } | undefined
			await run(
				'deployPortfolioAdmission',
				copy.deployAdmission,
				async () => {
					if (parameters.accountAddress === undefined) throw new Error(copy.connect)
					if (creationError !== undefined) throw new Error(creationError)
					const key = admissionKey
					const mode = admissionMode.value
					const ids = [...fixedQuestionIds]
					const universeId = await createConnectedReadClient().readContract({ address: getAddress(originInput.value), abi: securityPoolArtifact.abi, functionName: 'universeId' })
					captured = { key, universeId }
					return portfolioAdmissionCreationRequest(parameters.accountAddress, mode, universeId, ids)
				},
				undefined,
				async result => {
					const address = result.receipt.contractAddress
					if (address === null || address === undefined || captured === undefined) throw new Error(copy.admissionAddressMissing)
					deployedAdmission.value = { ...captured, address, backend }
				},
			)
		},
		originInput: originInput.value,
		horizonDays: horizonDays.value,
		setHorizonDays: (value: string) => {
			horizonDays.value = value
		},
		setOriginInput: (value: string) => {
			originInput.value = value
		},
		questionInput: questionInput.value,
		setQuestionInput: (value: string) => {
			questionInput.value = value
		},
		fundingAmount: fundingAmount.value,
		setFundingAmount: (value: string) => {
			fundingAmount.value = value
		},
		executor: executor.value,
		setExecutor: (value: string) => {
			executor.value = value
			invalidateExport()
		},
		expiryHours: expiryHours.value,
		setExpiryHours: (value: string) => {
			expiryHours.value = value
			invalidateExport()
		},
		depositBudget: depositBudget.value,
		setDepositBudget: (value: string) => {
			depositBudget.value = value
			invalidateExport()
		},
		commitmentBudget: commitmentBudget.value,
		setCommitmentBudget: (value: string) => {
			commitmentBudget.value = value
			invalidateExport()
		},
		policy,
		policyReadError: policyReadError.value,
		busy: busy.value,
		error: error.value,
		feedback: feedback.value,
		exported: exported.value,
		scope,
		plan,
		planError,
		branch,
		ownerReason,
		vaultReason,
		deployReason: walletReason ?? (!isAddress(originInput.value) ? copy.enterOrigin : horizonError) ?? creationError ?? (admission === undefined ? copy.deployAdmissionFirst : undefined),
		createReason: (selection === undefined ? copy.enterPortfolio : undefined) ?? (vault !== undefined ? copy.vaultExists : ownerReason),
		fundingReason: (vault === undefined || branch === undefined ? copy.noVault : undefined) ?? walletReason ?? fundingError,
		allocationReason: vaultReason ?? (model.loading ? copy.loading : (model.error ?? planError ?? (plan === undefined ? copy.allocationNeeded : undefined))),
		policyReason: vaultReason ?? (policy === undefined ? (policyReadError.value ?? copy.policyLoading) : policyError),
		policyExportReason: (vault === undefined ? copy.noVault : undefined) ?? (policy === undefined ? (policyReadError.value ?? copy.policyLoading) : policyError),
		registerReason: (selection === undefined ? copy.enterPortfolio : undefined) ?? walletReason ?? (!/^(0x[0-9a-fA-F]+|\d+)$/.test(questionInput.value) ? copy.registerDisabled : registrationReason),
		deploy: async () => {
			let initialQuestionId: bigint | undefined
			await run(
				'deployPortfolio',
				copy.deploy,
				async () => {
					if (parameters.accountAddress === undefined) throw new Error(copy.connect)
					const initialPool = getAddress(originInput.value)
					const horizon = horizonDays.value
					if (creationError !== undefined || creationEconomics === undefined || admission === undefined) throw new Error(creationError ?? copy.deployAdmissionFirst)
					const config = { ...creationEconomics }
					const chosenAdmission = admission
					const chosenMode = admissionMode.value
					const validateAdmission = async () => {
						const verified = await loadPortfolioAdmission(createConnectedReadClient(), chosenAdmission.address, chosenAdmission.universeId)
						if (verified.mode !== chosenMode) throw new Error(copy.unsupportedAdmission)
					}
					await validateAdmission()
					initialQuestionId = await createConnectedReadClient().readContract({ address: initialPool, abi: securityPoolArtifact.abi, functionName: 'questionId' })
					return {
						...portfolioCreationRequest(parameters.accountAddress, initialPool, BigInt(horizon) * 86400n, chosenAdmission.address, config),
						validateBeforeSubmit: validateAdmission,
						reviewDescription: [
							`Deploy a portfolio using ${chosenMode} admission policy ${chosenAdmission.address}. These settings cannot change.`,
							`Target health: ${formatUnits(config.targetHealthFactorBps, 2)}%. Purchase fee: ${formatUnits(config.purchaseFeeBps, 2)}%.`,
							`Minimum purchase fee: ${formatEther(config.minimumPurchaseFeeAttoEth)} ETH. Completion reward: ${formatEther(config.completionRewardAttoEth)} ETH. Ownership change fee: ${formatEther(config.ownershipChangeFeeAttoEth)} ETH.`,
							`Source pool: ${initialPool}. Eligible questions end within ${horizon} days at admission.`,
							'After deployment, use Register question in a separate transaction. Question end closes minting; REP remains exposed until final resolution and may suffer losses or fork delays.',
						].join('\n'),
					}
				},
				undefined,
				async result => {
					const portfolio = result.receipt.contractAddress
					if (portfolio === null || portfolio === undefined) throw new Error('Portfolio deployment address unavailable.')
					if (initialQuestionId === undefined || parameters.accountAddress === undefined) throw new Error('Source question unavailable.')
					await model.load(portfolio, parameters.accountAddress)
					questionInput.value = (admissionMode.value === 'fixed' ? (fixedQuestionIds[0] ?? initialQuestionId) : initialQuestionId).toString()
					feedback.value = copy.portfolioDeployed
				},
			)
		},
		createVault: () => run('createPortfolioVault', copy.createVault, createVaultRequest),
		register: () =>
			run('registerPortfolioQuestion', copy.addQuestion, () => {
				if (selection === undefined || parameters.accountAddress === undefined) throw new Error(copy.enterPortfolio)
				if (registrationReason !== undefined) throw new Error(registrationReason)
				const questionId = BigInt(questionInput.value)
				return { ...portfolioContractRequest(parameters.accountAddress, selection.portfolio, 'addQuestion', [questionId]), reviewDescription: `Register question 0x${questionId.toString(16)} in portfolio ${selection.portfolio}. Registration does not allocate REP.` }
			}),
		fund: () =>
			run('fundPortfolioVault', copy.transfer, () => {
				if (branch === undefined || parameters.accountAddress === undefined) throw new Error(copy.noVault)
				const amount = parsePortfolioAmount(fundingAmount.value)
				const recipient = requireVault()
				const account = parameters.accountAddress
				return {
					account,
					to: branch.repToken,
					value: 0n,
					data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'transfer', args: [recipient, amount] }),
					reviewDescription: copy.nativeFundingReview(formatEther(amount), account, recipient, branch.universeId),
					validateBeforeSubmit: async () => {
						const balance = await createConnectedReadClient().readContract({ address: branch.repToken, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [account] })
						if (balance < amount) throw new Error(copy.insufficient)
					},
				}
			}),
		submit: () => run('allocatePortfolio', copy.submit, batchRequest),
		installPolicy: () => run('installPortfolioPolicy', copy.install, policyRequest),
		revokePolicy: () =>
			run('revokePortfolioPolicy', copy.revoke, () => ({
				...buildPortfolioRevokePolicyRequest({ owner: owner(), vault: requireVault(), vaultAbi: vaultArtifact.abi }),
				reviewDescription: copy.revokePolicyReview(requireVault()),
			})),
		exportBatch: () => exportRequest(batchRequest),
		exportCreate: () => exportRequest(createVaultRequest),
		exportPolicy: () => exportRequest(policyRequest),
	}
}
