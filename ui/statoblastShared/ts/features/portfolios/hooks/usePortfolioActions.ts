import { portfolioCollateral, type CollateralSymbol } from '../../../protocol/collateral.js'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { formatEther, formatUnits, getAddress, parseUnits, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { createTransactionScope, mergeTransactionScopes } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { getActiveBackend, getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import { isUniverseForked, loadPortfolioSetup, portfolioPreparationRequest, portfolioContractRequest, portfolioCreationRequest, sendPortfolioTransaction, type PortfolioTransaction } from '../../../protocol/securityPoolPortfolio.js'
import { portfolioAmountOrUndefined, portfolioUnsignedId } from '../lib/draft.js'
import type { usePortfolio } from './usePortfolio.js'
import * as copy from '../../../copy/portfolio.js'
import { defaultPortfolioCreationDraft, parseFixedPortfolioQuestions, parsePortfolioCreationEconomics, type CuratedAdmissionMode, type PortfolioCreationDraft } from '../lib/creation.js'
import { loadPortfolioAdmission, portfolioAdmissionCreationRequest, requirePortfolioQuestionAdmission } from '../../../protocol/securityPoolPortfolioAdmission.js'
import { buildPortfolioAuctionVaultExecuteRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { authenticatePortfolioAuctionVault } from '../../../protocol/securityPoolPortfolioAuction.js'

export function usePortfolioActions(model: ReturnType<typeof usePortfolio>, parameters: WriteOperationsParameters) {
	const collateralSymbol = useSignal<CollateralSymbol>('WETH')
	const reportFloor = useSignal('0.01')
	const collateral = portfolioCollateral(getActiveNetworkProfile(), collateralSymbol.value)
	const originInput = useSignal(model.universeInput)
	const originEdited = useRef(false)
	const originForkState = useSignal<{ backend: ReturnType<typeof getActiveBackend>; key: string; forked: boolean } | undefined>(undefined)
	const multiplierInput = useSignal('200')
	const priorityFeeInput = useSignal((DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS / 10n ** 9n).toString())
	const horizonDays = useSignal('30')
	const admissionMode = useSignal<CuratedAdmissionMode>('open')
	const fixedQuestions = useSignal('')
	const economicsDraft = useSignal(defaultPortfolioCreationDraft())
	const deployedAdmission = useSignal<{ address: Address; key: string; universeId: bigint; backend: ReturnType<typeof getActiveBackend> } | undefined>(undefined)
	const questionInput = useSignal('')
	const busy = useSignal<string | undefined>(undefined)
	const error = useSignal<string | undefined>(undefined)
	const feedback = useSignal<string | undefined>(undefined)
	const snapshot = model.snapshot
	const backend = getActiveBackend()
	const universeId = snapshot?.universeId ?? portfolioUnsignedId(model.universeInput, 248) ?? 0n
	const scope = mergeTransactionScopes(createTransactionScope('portfolio', snapshot?.portfolio ?? model.setup?.portfolio), createTransactionScope('portfolio-capital', snapshot?.capitalLedger))
	const walletReason = parameters.accountAddress === undefined ? copy.connect : undefined
	const ownerReason =
		walletReason ??
		(model.loading || (busy.value !== undefined && snapshot === undefined) ? copy.loading : undefined) ??
		(snapshot === undefined && model.presentationSnapshot !== undefined ? copy.readUnavailable : undefined) ??
		(snapshot === undefined ? copy.enterPortfolio : undefined) ??
		(parameters.accountAddress?.toLowerCase() !== (snapshot?.auctionVault?.bidder ?? snapshot?.owner)?.toLowerCase() ? copy.ownerRequired : undefined) ??
		(snapshot?.auctionVault !== undefined && snapshot.auctionVault.filledLots > 0n && !snapshot.auctionVault.materialized ? 'Activate this individual vault in its auction panel before using capital controls.' : undefined)
	useEffect(() => {
		error.value = undefined
		feedback.value = undefined
	}, [backend, model.managerInput, model.ownerInput, universeId])
	// A forked universe cannot be an origin, so a fixed genesis default would fail once genesis forks.
	useEffect(() => {
		if (!originEdited.current) originInput.value = model.universeInput
	}, [model.universeInput])
	const originForkKey = originInput.value.trim()
	useEffect(() => {
		let current = true
		const originUniverse = portfolioUnsignedId(originInput.value, 248)
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
	const run = async (action: string, label: string, build: () => Promise<PortfolioTransaction> | PortfolioTransaction, validate: () => Promise<void> = async () => undefined, onConfirmed?: (result: Awaited<ReturnType<typeof sendPortfolioTransaction>>) => Promise<void>) => {
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
							...buildPortfolioAuctionVaultExecuteRequest({ bidder: selectedVault.bidder, vault: selectedVault.vault, request: { account: original.account, to: request.to, value: original.value ?? 0n, data: original.data }, sweep: { repToken: snapshot.repToken, recipient: selectedVault.bidder } }),
							reviewDescription: `${original.reviewDescription ?? label} This operation uses your independent auction vault ${selectedVault.vault}. Returned collateral, ETH and REP are sent to your wallet ${selectedVault.bidder}.`,
							validateBeforeSubmit: async () => {
								const client = createConnectedReadClient()
								const block = await client.getBlock()
								if (block.number === undefined) throw new Error('A confirmed block is required to authenticate this vault.')
								const fresh = await authenticatePortfolioAuctionVault(client, snapshot.portfolio, selectedVault.vault, block.number)
								if (fresh.bidder !== selectedVault.bidder || fresh.auction !== selectedVault.auction || fresh.bidId !== selectedVault.bidId) throw new Error('Auction vault authority changed. Review again.')
								await original.validateBeforeSubmit?.()
							},
						}
					}
					context.assertActive()
					const client = createWalletWriteClient(account, { reviewSignal: context.reviewSignal, onTransactionPrepared: parameters.onTransactionPrepared, onTransactionSubmitted: parameters.onTransactionSubmitted })
					return await sendPortfolioTransaction(client, request, label, validate)
				},
				copy.failure,
				async result => {
					await onConfirmed?.(result)
					await model.refresh()
					feedback.value = copy.confirmed
					parameters.onTransactionPresented({ hash: result.hash, title: copy.confirmed, tone: 'success', showStatusDialog: false, universeId })
				},
			)
		} finally {
			busy.value = undefined
		}
	}
	let creationError: string | undefined
	let fixedQuestionIds: bigint[] = []
	let economics: ReturnType<typeof parsePortfolioCreationEconomics> | undefined
	let horizon: bigint | undefined
	let origin: import('@zoltar/statoblast-shared/statoblast/securityPoolPortfolio').PortfolioOriginConfig | undefined
	try {
		const originUniverse = portfolioUnsignedId(originInput.value, 248)
		if (originUniverse === undefined) throw new Error(copy.enterOrigin)
		const securityMultiplierBps = parseUnits(multiplierInput.value, 2)
		const reportPriorityFeeAttoEthPerGas = parseUnits(priorityFeeInput.value, 9)
		if (securityMultiplierBps <= 10_001n) throw new Error('Security multiplier must exceed 100.01%.')
		if (reportPriorityFeeAttoEthPerGas <= 0n) throw new Error('Oracle priority fee must be positive.')
		if (reportPriorityFeeAttoEthPerGas > MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS) throw new Error('Oracle priority fee exceeds the report funding limit.')
		if (collateral.address === undefined) throw new Error('This collateral token is unavailable on the selected network.')
		const minimumReportCollateral = portfolioAmountOrUndefined(reportFloor.value, collateral.decimals)
		if (minimumReportCollateral === undefined || minimumReportCollateral === 0n) throw new Error(`Enter a positive report stake floor with up to ${collateral.decimals} decimal places.`)
		origin = { collateralToken: collateral.address, minimumReportCollateral, universeId: originUniverse, securityMultiplierBps, reportPriorityFeeAttoEthPerGas }
		if (admissionMode.value === 'fixed') fixedQuestionIds = parseFixedPortfolioQuestions(fixedQuestions.value)
		economics = parsePortfolioCreationEconomics(economicsDraft.value, collateral.decimals)
		if (!/^\d+$/.test(horizonDays.value)) throw new Error(copy.horizonInvalid)
		horizon = BigInt(horizonDays.value) * 86400n
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
	const admissionKey = `${originInput.value.trim().toLowerCase()}:${admissionMode.value}:${fixedQuestionIds.join(',')}`
	const admission = deployedAdmission.value?.key === admissionKey && deployedAdmission.value.backend === backend ? deployedAdmission.value : undefined
	const questionId = portfolioUnsignedId(questionInput.value)
	const admissionAllowed = snapshot?.admission.mode !== 'custom'
	const registration = useSignal<{ key: string; reason?: string } | undefined>(undefined)
	const registrationKey = `${backend.id}:${snapshot?.portfolio}:${snapshot?.blockHash}:${questionId}`
	useEffect(() => {
		let current = true
		registration.value = undefined
		if (snapshot !== undefined && questionId !== undefined && admissionAllowed) {
			void requirePortfolioQuestionAdmission(createConnectedReadClient(), snapshot.questionAdmissionPolicy, snapshot.portfolio, snapshot.originUniverseId, questionId, snapshot.blockNumber)
				.then(() => {
					if (current) registration.value = { key: registrationKey }
				})
				.catch(failure => {
					if (current) registration.value = { key: registrationKey, reason: getErrorMessage(failure, copy.admissionCheckFailed) }
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
		(snapshot === undefined ? copy.enterPortfolio : undefined) ??
		(!admissionAllowed ? copy.unsupportedAdmission : undefined) ??
		(snapshot !== undefined && (snapshot.forkTime > 0n || snapshot.universeId !== snapshot.originUniverseId) ? 'Register questions in the unforked origin universe.' : undefined) ??
		(questionId === undefined ? copy.registerDisabled : admissionStatus)
	return {
		runPortfolioAction: run,
		busy: busy.value,
		error: error.value,
		feedback: feedback.value,
		scope,
		ownerReason,
		multiplierInput: multiplierInput.value,
		setMultiplierInput: (value: string) => {
			multiplierInput.value = value
		},
		priorityFeeInput: priorityFeeInput.value,
		setPriorityFeeInput: (value: string) => {
			priorityFeeInput.value = value
		},
		originInput: originInput.value,
		originForked,
		setOriginInput: (value: string) => {
			originEdited.current = true
			originInput.value = value
		},
		horizonDays: horizonDays.value,
		setHorizonDays: (value: string) => {
			horizonDays.value = value
		},
		admissionMode: admissionMode.value,
		setAdmissionMode: (value: CuratedAdmissionMode) => {
			admissionMode.value = value
		},
		fixedQuestions: fixedQuestions.value,
		setFixedQuestions: (value: string) => {
			fixedQuestions.value = value
		},
		collateralSymbol: collateralSymbol.value,
		setCollateralSymbol: (value: CollateralSymbol) => {
			if (collateralSymbol.value === value) return
			collateralSymbol.value = value
			reportFloor.value = ''
			economicsDraft.value = { ...economicsDraft.value, minimumCommitment: '', minimumPurchaseFee: '' }
		},
		collateral,
		reportFloor: reportFloor.value,
		setReportFloor: (value: string) => {
			reportFloor.value = value
		},
		economicsDraft: economicsDraft.value,
		setEconomicsField: (field: keyof PortfolioCreationDraft, value: string) => {
			economicsDraft.value = { ...economicsDraft.value, [field]: value }
		},
		admissionAddress: admission?.address,
		creationError,
		admissionDeployReason: walletReason ?? creationError ?? (origin === undefined ? copy.enterOrigin : undefined) ?? originForkReason ?? (admission !== undefined ? copy.admissionDeployed : undefined),
		deployReason: walletReason ?? creationError ?? (origin === undefined ? copy.enterOrigin : undefined) ?? originForkReason ?? (admission === undefined ? copy.deployAdmissionFirst : undefined),
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
					if (origin === undefined) throw new Error(copy.enterOrigin)
					const originUniverse = origin.universeId
					captured = { key, universeId: originUniverse }
					return portfolioAdmissionCreationRequest(parameters.accountAddress, mode, originUniverse, ids)
				},
				requireUnforkedOrigin,
				async result => {
					const address = result.receipt.contractAddress
					if (address === null || address === undefined || captured === undefined) throw new Error(copy.admissionAddressMissing)
					deployedAdmission.value = { ...captured, address, backend }
				},
			)
		},
		deploy: () =>
			run(
				'deployPortfolio',
				copy.deploy,
				async () => {
					if (parameters.accountAddress === undefined) throw new Error(copy.connect)
					if (creationError !== undefined || economics === undefined || admission === undefined || horizon === undefined || origin === undefined) throw new Error(creationError ?? copy.deployAdmissionFirst)
					const chosen = admission
					const mode = admissionMode.value
					const config = { ...economics }
					const originConfig = { ...origin }
					const validateAdmission = async () => {
						const verified = await loadPortfolioAdmission(createConnectedReadClient(), chosen.address, chosen.universeId)
						if (verified.mode !== mode) throw new Error(copy.unsupportedAdmission)
					}
					await validateAdmission()
					return {
						...portfolioCreationRequest(parameters.accountAddress, originConfig, horizon, chosen.address, config),
						validateBeforeSubmit: validateAdmission,
						reviewDescription: `Deploy a portfolio with immutable ${mode} question admission. Fixed annual time fee ${formatUnits(config.annualFeeBps, 2)}%. Purchase fee ${formatUnits(config.purchaseFeeBps, 2)}% of required backing value, minimum ${formatEther(config.minimumPurchaseFeeAttoEth)} ETH. Each purchase also prepays up to 52 days of resolution fees. The whole purchase fee goes to underwriters; price reporters and keepers pay their own costs. Winners can retire if spare backing permits; there is no minimum holding period. Minimum commitment and auction ETH lot ${formatEther(config.minimumCommitmentAttoEth)} ETH; prepaid rewards vest over ${config.rewardVestingSeconds} seconds. Each owner chooses their own health target. Register eligible questions in a separate transaction.`,
					}
				},
				requireUnforkedOrigin,
				async result => {
					const portfolio = result.receipt.contractAddress
					if (portfolio === null || portfolio === undefined || parameters.accountAddress === undefined) throw new Error('Portfolio deployment address unavailable.')
					await model.load(portfolio, parameters.accountAddress, admission?.universeId.toString())
				},
			),
		setupStage: model.setup?.stage,
		preparationReason: (stage: number) =>
			walletReason ??
			(model.setup === undefined ? 'Deploy or load a portfolio first.' : undefined) ??
			(model.loading ? 'Refreshing setup status.' : undefined) ??
			(model.setup !== undefined && model.setup.stage >= stage ? 'This setup stage is complete.' : undefined) ??
			(model.setup !== undefined && model.setup.stage !== stage - 1 ? 'Complete the previous setup stage first.' : undefined),
		prepare: (stage: number) =>
			run(`preparePortfolio${stage}`, 'Prepare portfolio modules', () => {
				const selected = model.setup
				if (selected === undefined || selected.stage !== stage - 1 || parameters.accountAddress === undefined) throw new Error('Refresh and select the next setup stage.')
				return {
					...portfolioPreparationRequest(parameters.accountAddress, selected.portfolio),
					reviewDescription: `Complete setup stage ${stage} of 4. This deploys the next bounded group of custody modules. No REP or trader ETH is deposited.`,
					validateBeforeSubmit: async () => {
						const latest = await loadPortfolioSetup(createConnectedReadClient(), selected.portfolio, selected.owner)
						if (latest.chainId !== selected.chainId || latest.stage !== selected.stage) throw new Error('Setup advanced. Refresh before sending another preparation transaction.')
					},
				}
			}),
		questionInput: questionInput.value,
		setQuestionInput: (value: string) => {
			questionInput.value = value
		},
		registerReason,
		register: () =>
			run('registerPortfolioQuestion', copy.addQuestion, () => {
				if (registerReason !== undefined || snapshot === undefined || questionId === undefined || parameters.accountAddress === undefined) throw new Error(registerReason ?? copy.enterPortfolio)
				const selected = snapshot
				const id = questionId
				return {
					...portfolioContractRequest(parameters.accountAddress, selected.portfolio, 'addQuestion', [id]),
					reviewDescription: `Register question 0x${id.toString(16)} in portfolio ${selected.portfolio}. Registration does not pledge additional REP.`,
					validateBeforeSubmit: async () => {
						await requirePortfolioQuestionAdmission(createConnectedReadClient(), selected.questionAdmissionPolicy, selected.portfolio, selected.originUniverseId, id)
					},
				}
			}),
	}
}
