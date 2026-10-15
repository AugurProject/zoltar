import { useSignal } from '@preact/signals'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import { encodeFunctionData, formatEther, getAddress, isAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioRevokePolicyRequest, exportPortfolioTransaction, loadPortfolioSnapshot, planPortfolioAllocations } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { statoblast_SecurityPool_SecurityPool as securityPoolArtifact } from '../../../contractArtifact.js'
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

type PortfolioModel = Pick<ReturnType<typeof usePortfolio>, 'snapshot' | 'selection' | 'managerInput' | 'ownerInput' | 'loading' | 'error' | 'load' | 'refresh'>

export function usePortfolioActions(model: PortfolioModel, parameters: WriteOperationsParameters, selectedUniverse: bigint) {
	const originInput = useSignal('')
	const horizonDays = useSignal('30')
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
	const scope = mergeTransactionScopes(createTransactionScope('portfolio-vault', vault), ...(snapshot?.branches.flatMap(item => item.positions.map(position => securityPoolTransactionScope(position.pool))) ?? []))
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
		deployReason: walletReason ?? (!isAddress(originInput.value) ? copy.enterOrigin : horizonError),
		createReason: (selection === undefined ? copy.enterPortfolio : undefined) ?? (vault !== undefined ? copy.vaultExists : ownerReason),
		fundingReason: (vault === undefined || branch === undefined ? copy.noVault : undefined) ?? walletReason ?? fundingError,
		allocationReason: vaultReason ?? (model.loading ? copy.loading : (model.error ?? planError ?? (plan === undefined ? copy.allocationNeeded : undefined))),
		policyReason: vaultReason ?? (policy === undefined ? (policyReadError.value ?? copy.policyLoading) : policyError),
		policyExportReason: (vault === undefined ? copy.noVault : undefined) ?? (policy === undefined ? (policyReadError.value ?? copy.policyLoading) : policyError),
		registerReason: (selection === undefined ? copy.enterPortfolio : undefined) ?? walletReason ?? (!/^(0x[0-9a-fA-F]+|\d+)$/.test(questionInput.value) ? copy.registerDisabled : undefined),
		deploy: async () => {
			let initialQuestionId: bigint | undefined
			await run(
				'deployPortfolio',
				copy.deploy,
				async () => {
					if (parameters.accountAddress === undefined) throw new Error(copy.connect)
					const initialPool = getAddress(originInput.value)
					const horizon = horizonDays.value
					initialQuestionId = await createConnectedReadClient().readContract({ address: initialPool, abi: securityPoolArtifact.abi, functionName: 'questionId' })
					return {
						...portfolioCreationRequest(parameters.accountAddress, initialPool, BigInt(horizon) * 86400n),
						reviewDescription: `Deploy a portfolio manager using settings from source pool ${initialPool}, accepting questions ending within ${horizon} days at admission. After deployment, use Add question to register its first question in a separate transaction. Question end closes minting; REP remains exposed until final resolution and may suffer losses or fork delays.`,
					}
				},
				undefined,
				async result => {
					const portfolio = result.receipt.contractAddress
					if (portfolio === null || portfolio === undefined) throw new Error('Portfolio deployment address unavailable.')
					if (initialQuestionId === undefined || parameters.accountAddress === undefined) throw new Error('Source question unavailable.')
					await model.load(portfolio, parameters.accountAddress)
					questionInput.value = initialQuestionId.toString()
					feedback.value = copy.portfolioDeployed
				},
			)
		},
		createVault: () => run('createPortfolioVault', copy.createVault, createVaultRequest),
		register: () =>
			run('registerPortfolioQuestion', copy.addQuestion, () => {
				if (selection === undefined || parameters.accountAddress === undefined) throw new Error(copy.enterPortfolio)
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
					reviewDescription: `Transfer ${formatEther(amount)} REP from ${account} to portfolio vault ${recipient} in universe ${branch.universeId}. Origin-universe REP becomes available for automatic backing of any eligible question under the vault’s reserve, health and fee settings, unless withdrawal is active. Child-universe REP stays separate.`,
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
				reviewDescription: `Revoke delegated executor allocation for portfolio vault ${requireVault()}. Automatic backing remains active unless withdrawal is requested. Existing question positions remain unchanged.`,
			})),
		exportBatch: () => exportRequest(batchRequest),
		exportCreate: () => exportRequest(createVaultRequest),
		exportPolicy: () => exportRequest(policyRequest),
	}
}
