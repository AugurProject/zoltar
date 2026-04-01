import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { Address, Hash } from 'viem'
import { useRequestGuard } from '../lib/requestGuard.js'
import { approveErc20, createMarket as createMarketTransaction, createZoltarChildUniverse, forkZoltarUniverse, getDeploymentSteps, loadAllZoltarQuestions, loadErc20Allowance, loadErc20Balance, loadRepTokensMigratedRepBalance, loadZoltarQuestionCount, loadZoltarUniverseSummary, migrateInternalRepInZoltar, prepareRepForMigrationInZoltar } from '../contracts.js'
import { createReadClient, createWalletWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseBigIntListInput } from '../lib/inputs.js'
import { createMarketParameters, hasDeployedStep } from '../lib/marketCreation.js'
import { getDefaultMarketFormState, getDefaultZoltarMigrationFormState, parseBigIntInput, parseRepAmountInput } from '../lib/marketForm.js'
import type { MarketFormState, ZoltarMigrationFormState } from '../types/app.js'
import type { DeploymentStatus, MarketCreationResult, MarketDetails, ZoltarForkActionResult, ZoltarMigrationActionResult, ZoltarUniverseSummary } from '../types/contracts.js'

type UseMarketCreationParameters = {
	accountAddress: Address | undefined
	activeUniverseId: bigint
	autoLoadInitialData: boolean
	deploymentStatuses: DeploymentStatus[]
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

function formatQuestionId(questionId: bigint) {
	return `0x${ questionId.toString(16) }`
}

function getZoltarAddress() {
	const zoltarStep = getDeploymentSteps().find(step => step.id === 'zoltar')
	if (zoltarStep === undefined) throw new Error('Zoltar deployment step not found')
	return zoltarStep.address
}

export function useMarketCreation({ accountAddress, activeUniverseId, autoLoadInitialData, deploymentStatuses, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseMarketCreationParameters) {
	const marketForm = useSignal<MarketFormState>(getDefaultMarketFormState())
	const marketCreating = useSignal(false)
	const marketResult = useSignal<MarketCreationResult | undefined>(undefined)
	const marketError = useSignal<string | undefined>(undefined)
	const loadingZoltarUniverse = useSignal(false)
	const zoltarUniverseMissing = useSignal(false)
	const zoltarUniverseLoadedId = useSignal<bigint | undefined>(undefined)
	const loadingZoltarQuestionCount = useSignal(false)
	const loadingZoltarQuestions = useSignal(false)
	const zoltarQuestionCount = useSignal<bigint | undefined>(undefined)
	const zoltarQuestions = useSignal<MarketDetails[]>([])
	const zoltarUniverse = useSignal<ZoltarUniverseSummary | undefined>(undefined)
	const zoltarForkError = useSignal<string | undefined>(undefined)
	const zoltarForkPending = useSignal(false)
	const zoltarForkQuestionId = useSignal('')
	const zoltarForkResult = useSignal<ZoltarForkActionResult | undefined>(undefined)
	const zoltarForkAllowance = useSignal<bigint | undefined>(undefined)
	const zoltarForkRepBalance = useSignal<bigint | undefined>(undefined)
	const zoltarMigrationPreparedRepBalance = useSignal<bigint | undefined>(undefined)
	const zoltarMigrationChildRepBalances = useSignal<Record<string, bigint | undefined>>({})
	const loadingZoltarForkAccess = useSignal(false)
	const nextUniverseLoad = useRequestGuard()
	const nextForkAccessLoad = useRequestGuard()
	const nextQuestionCountLoad = useRequestGuard()
	const nextQuestionsLoad = useRequestGuard()
	const zoltarChildUniverseError = useSignal<string | undefined>(undefined)
	const zoltarMigrationError = useSignal<string | undefined>(undefined)
	const zoltarMigrationPending = useSignal(false)
	const zoltarMigrationResult = useSignal<ZoltarMigrationActionResult | undefined>(undefined)
	const zoltarMigrationForm = useSignal<ZoltarMigrationFormState>(getDefaultZoltarMigrationFormState())

	const ensureZoltarUniverse = async (): Promise<ZoltarUniverseSummary> => {
		if (zoltarUniverse.value !== undefined && zoltarUniverseLoadedId.value === activeUniverseId) return zoltarUniverse.value

		const loadedUniverse = await loadZoltarUniverse()
		if (loadedUniverse !== undefined) return loadedUniverse
		if (zoltarUniverseMissing.value) throw new Error('Zoltar universe does not exist yet')

		throw new Error('Failed to load current Zoltar universe')
	}

	const loadZoltarForkAccess = async () => {
		if (accountAddress === undefined || zoltarUniverse.value === undefined) {
			zoltarForkAllowance.value = undefined
			zoltarForkRepBalance.value = undefined
			zoltarMigrationPreparedRepBalance.value = undefined
			zoltarMigrationChildRepBalances.value = {}
			return
		}

		const isCurrent = nextForkAccessLoad()
		loadingZoltarForkAccess.value = true
		try {
			const readClient = createReadClient()
			const [allowance, balance, preparedRepBalance, childRepBalances] = await Promise.all([loadErc20Allowance(readClient, zoltarUniverse.value.reputationToken, accountAddress, getZoltarAddress()), loadErc20Balance(readClient, zoltarUniverse.value.reputationToken, accountAddress), loadRepTokensMigratedRepBalance(readClient, zoltarUniverse.value.universeId, accountAddress), Promise.all(zoltarUniverse.value.childUniverses.map(async child => [child.universeId.toString(), await loadErc20Balance(readClient, child.reputationToken, accountAddress)] as const))])
			if (!isCurrent()) return
			zoltarForkAllowance.value = allowance
			zoltarForkRepBalance.value = balance
			zoltarMigrationPreparedRepBalance.value = preparedRepBalance
			const nextChildRepBalances: Record<string, bigint | undefined> = {}
			for (const [universeId, childRepBalance] of childRepBalances) {
				nextChildRepBalances[universeId] = childRepBalance
			}
			zoltarMigrationChildRepBalances.value = nextChildRepBalances
		} finally {
			if (isCurrent()) {
				loadingZoltarForkAccess.value = false
			}
		}
	}

	const createChildUniverse = async (outcomeIndex: bigint) => {
		try {
			getRequiredInjectedEthereum()
		} catch {
			zoltarChildUniverseError.value = 'No injected wallet found'
			return
		}
		if (accountAddress === undefined) {
			zoltarChildUniverseError.value = 'Connect a wallet before deploying a child universe'
			return
		}

		zoltarChildUniverseError.value = undefined
		try {
			onTransactionRequested()
			const universe = await ensureZoltarUniverse()
			if (!universe.hasForked) {
				throw new Error('Zoltar needs to fork before child universes can be deployed')
			}
			const result = await createZoltarChildUniverse(createWalletWriteClient(accountAddress, { onTransactionSubmitted }), universe.universeId, outcomeIndex)
			onTransaction(result.hash)
			await loadZoltarUniverse()
			await loadZoltarForkAccess()
		} catch (error) {
			zoltarChildUniverseError.value = getErrorMessage(error, 'Failed to deploy child universe')
		} finally {
			onTransactionFinished()
		}
	}

	const createMarket = async () => {
		try {
			getRequiredInjectedEthereum()
		} catch {
			marketError.value = 'No injected wallet found'
			return
		}
		if (accountAddress === undefined) {
			marketError.value = 'Connect a wallet before creating a question'
			return
		}
		const marketParameters = createMarketParameters(marketForm.value)
		if (!hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')) {
			marketError.value = 'Deploy ZoltarQuestionData before creating a question'
			return
		}

		marketCreating.value = true
		marketError.value = undefined
		marketResult.value = undefined

		try {
			onTransactionRequested()
			const result = await createMarketTransaction(createWalletWriteClient(accountAddress, { onTransactionSubmitted }), marketParameters)
			marketResult.value = result
			zoltarForkQuestionId.value = result.questionId
			onTransaction(result.createQuestionHash)
			await refreshState()
			await loadQuestions()
		} catch (error) {
			marketError.value = getErrorMessage(error, 'Failed to create question')
		} finally {
			marketCreating.value = false
			onTransactionFinished()
		}
	}

	const loadZoltarUniverse = async () => {
		const isCurrent = nextUniverseLoad()
		const requestedUniverseId = activeUniverseId
		zoltarUniverseMissing.value = false
		loadingZoltarUniverse.value = true
		zoltarUniverse.value = undefined
		zoltarUniverseLoadedId.value = undefined
		zoltarForkAllowance.value = undefined
		zoltarForkRepBalance.value = undefined
		zoltarMigrationPreparedRepBalance.value = undefined
		zoltarMigrationChildRepBalances.value = {}
		zoltarForkError.value = undefined
		zoltarForkResult.value = undefined
		zoltarChildUniverseError.value = undefined
		zoltarMigrationError.value = undefined
		zoltarMigrationResult.value = undefined
		zoltarMigrationPending.value = false
		zoltarForkQuestionId.value = ''
		try {
			const universe = await loadZoltarUniverseSummary(createReadClient(), requestedUniverseId)
			if (!isCurrent()) return undefined
			if (requestedUniverseId !== activeUniverseId) return undefined
			if (universe === undefined) {
				zoltarUniverseMissing.value = true
				return undefined
			}
			zoltarUniverse.value = universe
			zoltarUniverseLoadedId.value = requestedUniverseId
			return universe
		} finally {
			if (isCurrent()) {
				loadingZoltarUniverse.value = false
			}
		}
	}

	const loadZoltarQuestionCountData = async () => {
		const isCurrent = nextQuestionCountLoad()
		loadingZoltarQuestionCount.value = true
		try {
			const questionCount = await loadZoltarQuestionCount(createReadClient())
			if (!isCurrent()) return
			zoltarQuestionCount.value = questionCount
		} finally {
			if (isCurrent()) {
				loadingZoltarQuestionCount.value = false
			}
		}
	}

	const loadQuestions = async () => {
		const isCountCurrent = nextQuestionCountLoad()
		const isQuestionsCurrent = nextQuestionsLoad()
		loadingZoltarQuestions.value = true
		loadingZoltarQuestionCount.value = true
		try {
			const readClient = createReadClient()
			const [questions, questionCount] = await Promise.all([loadAllZoltarQuestions(readClient), loadZoltarQuestionCount(readClient)])
			if (!isQuestionsCurrent()) return
			zoltarQuestions.value = questions
			if (isCountCurrent()) {
				zoltarQuestionCount.value = questionCount
			}
		} finally {
			if (isQuestionsCurrent()) {
				loadingZoltarQuestions.value = false
			}
			if (isCountCurrent()) {
				loadingZoltarQuestionCount.value = false
			}
		}
	}

	const runZoltarForkAction = async (action: (walletAddress: Address, universe: ZoltarUniverseSummary, questionId: bigint) => Promise<ZoltarForkActionResult>, errorFallback: string, refreshAfter: boolean) => {
		try {
			getRequiredInjectedEthereum()
		} catch {
			zoltarForkError.value = 'No injected wallet found'
			return
		}
		if (accountAddress === undefined) {
			zoltarForkError.value = 'Connect a wallet before using Zoltar fork actions'
			return
		}

		zoltarForkPending.value = true
		zoltarForkError.value = undefined
		zoltarForkResult.value = undefined

		try {
			onTransactionRequested()
			const questionId = parseBigIntInput(zoltarForkQuestionId.value, 'Fork question ID')
			const universe = await ensureZoltarUniverse()
			const result = await action(accountAddress, universe, questionId)
			zoltarForkResult.value = result
			onTransaction(result.hash)
			if (refreshAfter) {
				await refreshState()
				await loadZoltarUniverse()
			}
			await loadZoltarForkAccess()
		} catch (error) {
			zoltarForkError.value = getErrorMessage(error, errorFallback)
		} finally {
			zoltarForkPending.value = false
			onTransactionFinished()
		}
	}

	const approveZoltarForkRep = async () =>
		await runZoltarForkAction(
			async (walletAddress, universe, questionId) => {
				const approval = await approveErc20(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), universe.reputationToken, getZoltarAddress(), universe.forkThreshold, 'approveForkRep')
				return {
					action: 'approveForkRep',
					hash: approval.hash,
					questionId: formatQuestionId(questionId),
					universeId: universe.universeId,
				} satisfies ZoltarForkActionResult
			},
			'Failed to approve REP for Zoltar fork',
			false,
		)

	const forkZoltar = async () =>
		await runZoltarForkAction(
			async (walletAddress, universe, questionId) => {
				if (universe.hasForked) throw new Error('Zoltar has already forked')
				return await forkZoltarUniverse(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), universe.universeId, questionId)
			},
			'Failed to fork Zoltar',
			true,
		)

	type MigrationAmountResolver = (amount: bigint, preparedRepBalance: bigint | undefined, repBalance: bigint | undefined) => bigint

	const runZoltarMigrationAction = async (action: (walletAddress: Address, universe: ZoltarUniverseSummary, amount: bigint, outcomeIndexes: bigint[]) => Promise<ZoltarMigrationActionResult>, errorFallback: string, refreshAfter: boolean, requiresOutcomeIndexes: boolean, resolveAmount: MigrationAmountResolver = amount => amount) => {
		try {
			getRequiredInjectedEthereum()
		} catch {
			zoltarMigrationError.value = 'No injected wallet found'
			return
		}
		if (accountAddress === undefined) {
			zoltarMigrationError.value = 'Connect a wallet before using REP migration actions'
			return
		}

		zoltarMigrationPending.value = true
		zoltarMigrationError.value = undefined
		zoltarMigrationResult.value = undefined

		try {
			onTransactionRequested()
			const universe = await ensureZoltarUniverse()
			if (!universe.hasForked) {
				throw new Error('Zoltar has not forked yet')
			}
			const amount = parseRepAmountInput(zoltarMigrationForm.value.amount, 'Migration amount')
			if (amount <= 0n) {
				throw new Error('Migration amount must be greater than zero')
			}
			const resolvedAmount = resolveAmount(amount, zoltarMigrationPreparedRepBalance.value, zoltarForkRepBalance.value)
			if (resolvedAmount <= 0n) {
				throw new Error('Selected amount is already prepared')
			}
			const outcomeIndexes = requiresOutcomeIndexes ? parseBigIntListInput(zoltarMigrationForm.value.outcomeIndexes, 'Outcome indexes') : []
			const result = await action(accountAddress, universe, resolvedAmount, outcomeIndexes)
			zoltarMigrationResult.value = result
			onTransaction(result.hash)
			if (refreshAfter) {
				await refreshState()
				await loadZoltarUniverse()
			}
			await loadZoltarForkAccess()
		} catch (error) {
			zoltarMigrationError.value = getErrorMessage(error, errorFallback)
		} finally {
			zoltarMigrationPending.value = false
			onTransactionFinished()
		}
	}

	const prepareRepForMigration = async () =>
		await runZoltarMigrationAction(
			async (walletAddress, universe, amount) => await prepareRepForMigrationInZoltar(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), universe.universeId, amount),
			'Failed to prepare REP for migration',
			false,
			false,
			(amount, preparedRepBalance, repBalance) => {
				const currentPreparedBalance = preparedRepBalance ?? 0n
				const missingAmount = amount > currentPreparedBalance ? amount - currentPreparedBalance : 0n
				if (missingAmount === 0n) {
					throw new Error('Selected amount is already prepared')
				}
				const currentRepBalance = repBalance ?? 0n
				if (currentRepBalance < missingAmount) {
					throw new Error('Not enough REP in this universe to prepare the selected amount')
				}
				return missingAmount
			},
		)

	const migrateInternalRep = async () => await runZoltarMigrationAction(async (walletAddress, universe, amount, outcomeIndexes) => await migrateInternalRepInZoltar(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), universe.universeId, amount, outcomeIndexes), 'Failed to migrate REP', true, true)

	useEffect(() => {
		if (!autoLoadInitialData) return
		void Promise.allSettled([loadZoltarUniverse(), loadZoltarQuestionCountData()])
	}, [activeUniverseId, autoLoadInitialData])

	useEffect(() => {
		void loadZoltarForkAccess().catch(() => undefined)
	}, [accountAddress, zoltarUniverse.value?.reputationToken, zoltarUniverse.value?.childUniverses.map(child => child.universeId.toString()).join(',')])

	const resetMarket = () => {
		marketForm.value = getDefaultMarketFormState()
		marketError.value = undefined
		marketResult.value = undefined
	}

	return {
		approveZoltarForkRep,
		createChildUniverse,
		createMarket,
		forkZoltar,
		loadZoltarQuestionCount: loadZoltarQuestionCountData,
		loadZoltarQuestions: loadQuestions,
		loadZoltarUniverse,
		loadingZoltarForkAccess: loadingZoltarForkAccess.value,
		loadingZoltarQuestionCount: loadingZoltarQuestionCount.value,
		loadingZoltarQuestions: loadingZoltarQuestions.value,
		loadingZoltarUniverse: loadingZoltarUniverse.value,
		zoltarUniverseMissing: zoltarUniverseMissing.value,
		marketCreating: marketCreating.value,
		marketError: marketError.value,
		marketForm: marketForm.value,
		marketResult: marketResult.value,
		migrateInternalRep,
		resetMarket,
		prepareRepForMigration,
		setMarketForm: (updater: (current: MarketFormState) => MarketFormState) => {
			marketForm.value = updater(marketForm.value)
		},
		setZoltarForkQuestionId: (questionId: string) => {
			zoltarForkQuestionId.value = questionId
		},
		setZoltarMigrationForm: (updater: (current: ZoltarMigrationFormState) => ZoltarMigrationFormState) => {
			zoltarMigrationForm.value = updater(zoltarMigrationForm.value)
		},
		zoltarMigrationError: zoltarMigrationError.value,
		zoltarMigrationForm: zoltarMigrationForm.value,
		zoltarMigrationPending: zoltarMigrationPending.value,
		zoltarMigrationPreparedRepBalance: zoltarMigrationPreparedRepBalance.value,
		zoltarMigrationChildRepBalances: zoltarMigrationChildRepBalances.value,
		zoltarMigrationResult: zoltarMigrationResult.value,
		zoltarForkError: zoltarForkError.value,
		zoltarForkAllowance: zoltarForkAllowance.value,
		zoltarForkPending: zoltarForkPending.value,
		zoltarForkQuestionId: zoltarForkQuestionId.value,
		zoltarForkRepBalance: zoltarForkRepBalance.value,
		zoltarForkResult: zoltarForkResult.value,
		zoltarChildUniverseError: zoltarChildUniverseError.value,
		zoltarQuestionCount: zoltarQuestionCount.value,
		zoltarQuestions: zoltarQuestions.value,
		zoltarUniverse: zoltarUniverseLoadedId.value === activeUniverseId ? zoltarUniverse.value : undefined,
	}
}
