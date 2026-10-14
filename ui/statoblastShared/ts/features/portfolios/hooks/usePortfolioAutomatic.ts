import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { getAddress, formatEther, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	buildPortfolioAutomaticUnderwritingRequest,
	buildPortfolioWithdrawalRequest,
	buildPortfolioWithdrawEthRequest,
	buildPortfolioCancelWithdrawalRequest,
	buildPortfolioWithdrawalResidualForfeitureRequest,
	buildPortfolioProcessWithdrawalRequest,
	buildPortfolioMintRequest,
	loadPortfolioAutomaticState,
	loadPortfolioWithdrawalRequests,
	type PortfolioAutomaticState,
} from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { portfolioReadClient, vaultArtifact, type PortfolioTransaction } from '../../../protocol/securityPoolPortfolio.js'
import { parsePortfolioAmount } from '../lib/draft.js'
import { portfolioRunoffAvailability } from '../lib/runoff.js'
import type { usePortfolio } from './usePortfolio.js'
import type { usePortfolioActions } from './usePortfolioActions.js'
import { usePortfolioMintQuestion } from './usePortfolioMintQuestion.js'
import { usePortfolioMintFee } from './usePortfolioMintFee.js'
import { loadPortfolioMintQuestion, loadPortfolioMintReservationFee } from '../../../protocol/securityPoolPortfolioMint.js'
import * as copy from '../../../copy/portfolio.js'

async function readContributorAuthority(client: ReturnType<typeof createConnectedReadClient>, vault: Address, portfolio: Address, blockNumber: bigint) {
	const [automatic, withdrawing, actualPortfolio, version, nonce] = await Promise.all([
		client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: 'automaticUnderwriting', blockNumber }),
		client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: 'withdrawalRequested', blockNumber }),
		client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: 'portfolio', blockNumber }),
		client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: 'allocationPolicyVersion', blockNumber }),
		client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: 'allocationPolicyNonce', blockNumber }),
	])
	if (getAddress(actualPortfolio) !== getAddress(portfolio)) throw new Error(copy.contributorForeign)
	if (!automatic[0] || withdrawing) throw new Error(copy.contributorDisabled)
	return { vault, fingerprint: [...automatic, version, nonce].map(String).join(':') }
}

export function usePortfolioAutomatic(model: Pick<ReturnType<typeof usePortfolio>, 'snapshot' | 'selection' | 'refresh' | 'load' | 'loading'>, actions: Pick<ReturnType<typeof usePortfolioActions>, 'vaultReason' | 'runPortfolioAction'>, account: Address | undefined) {
	const loaded = useSignal<{ key: string; state: PortfolioAutomaticState } | undefined>(undefined)
	const readError = useSignal<string | undefined>(undefined)
	const reserve = useSignal('0')
	const health = useSignal('12000')
	const reservationFee = useSignal('100')
	const minimumAllocationFee = useSignal('0.001')
	const acknowledged = useSignal(false)
	const questionId = useSignal('')
	const mintAmount = useSignal('')
	const maximumReservationFee = useSignal('0')
	const maximumReservationFeeEdited = useSignal(false)
	const minimumShares = useSignal('')
	const contributors = useSignal('')
	const contributorState = useSignal<{ key: string; authorities?: Awaited<ReturnType<typeof readContributorAuthority>>[]; reason?: string | undefined } | undefined>(undefined)
	const queueOffset = useSignal(0n)
	const queue = useSignal<Awaited<ReturnType<typeof loadPortfolioWithdrawalRequests>> | undefined>(undefined)
	const queueError = useSignal<string | undefined>(undefined)
	const backend = getActiveBackend()
	const snapshot = model.snapshot
	const selection = model.selection
	const key = snapshot === undefined ? '' : `${snapshot.portfolio}:${snapshot.vault}:${snapshot.blockHash}`
	const state = loaded.value?.key === key ? loaded.value.state : undefined
	const contributorKey = `${key}:${contributors.value}`
	useEffect(() => {
		let current = true
		readError.value = undefined
		loaded.value = undefined
		if (snapshot !== undefined)
			void loadPortfolioAutomaticState({ client: portfolioReadClient(backend.createReadClient()), portfolio: snapshot.portfolio, vault: snapshot.vault, blockNumber: snapshot.blockNumber })
				.then(state => {
					if (current) loaded.value = { key, state }
				})
				.catch(failure => {
					if (current) readError.value = getErrorMessage(failure, copy.snapshotFailed)
				})
		return () => {
			current = false
		}
	}, [backend, snapshot, key])
	useEffect(() => {
		acknowledged.value = false
		queueOffset.value = 0n
		contributors.value = selection?.vault ?? ''
	}, [backend, selection?.portfolio, selection?.vault])
	useEffect(() => {
		let current = true
		queue.value = undefined
		queueError.value = undefined
		if (snapshot !== undefined)
			void loadPortfolioWithdrawalRequests({ client: portfolioReadClient(backend.createReadClient()), portfolio: snapshot.portfolio, blockNumber: snapshot.blockNumber, start: queueOffset.value, count: 16n })
				.then(next => {
					if (current) queue.value = next
				})
				.catch(failure => {
					if (current) queueError.value = getErrorMessage(failure, copy.snapshotFailed)
				})
		return () => {
			current = false
		}
	}, [backend, snapshot, key, queueOffset.value])
	useEffect(() => {
		let current = true
		contributorState.value = undefined
		if (snapshot !== undefined)
			void (async () => {
				try {
					const addresses = contributors.value
						.split(/[\s,]+/)
						.filter(Boolean)
						.map(value => getAddress(value))
					if (addresses.length > 16) throw new Error(copy.contributorLimit)
					const client = backend.createReadClient()
					const authorities = await Promise.all(addresses.map(address => readContributorAuthority(client, address, snapshot.portfolio, snapshot.blockNumber)))
					if (current) contributorState.value = { key: contributorKey, authorities }
				} catch (failure) {
					if (current) contributorState.value = { key: contributorKey, reason: getErrorMessage(failure, copy.contributorFailed) }
				}
			})()
		return () => {
			current = false
		}
	}, [backend, snapshot, contributorKey])
	const ownerReason = actions.vaultReason
	const stateReason = readError.value ?? (state === undefined ? copy.automaticLoading : undefined)
	const origin = snapshot?.branches.find(branch => branch.universeId === snapshot.originUniverseId)
	const mintQuestion = usePortfolioMintQuestion(snapshot, questionId.value)
	const mintFee = usePortfolioMintFee(snapshot, mintQuestion.position, questionId.value, mintAmount.value, contributors.value)
	useEffect(() => {
		if (!maximumReservationFeeEdited.value && mintFee.fee !== undefined) maximumReservationFee.value = formatEther(mintFee.fee)
	}, [mintFee.fee, maximumReservationFeeEdited.value])
	let inputReason: string | undefined
	try {
		parsePortfolioAmount(reserve.value)
		if (BigInt(health.value) < 10_000n) inputReason = copy.healthInvalid
		if (BigInt(reservationFee.value) < 1n || BigInt(reservationFee.value) > 10_000n) inputReason = copy.reservationFeeInvalid
		parsePortfolioAmount(minimumAllocationFee.value)
	} catch (failure) {
		inputReason = failure instanceof SyntaxError ? copy.automaticInvalid : getErrorMessage(failure, copy.automaticInvalid)
	}
	const loadCurrent = async () => {
		if (snapshot === undefined) throw new Error(copy.enterPortfolio)
		const client = createConnectedReadClient()
		const block = await client.getBlock()
		if (block.number === undefined) throw new Error(copy.snapshotFailed)
		return await loadPortfolioAutomaticState({ client: portfolioReadClient(client), portfolio: snapshot.portfolio, vault: snapshot.vault, blockNumber: block.number })
	}
	const reviewedState = async () => {
		if (state === undefined) throw new Error(stateReason)
		const latest = await loadCurrent()
		if (
			state.version !== latest.version ||
			state.nonce !== latest.nonce ||
			state.withdrawalRequested !== latest.withdrawalRequested ||
			state.withdrawalRequestId !== latest.withdrawalRequestId ||
			state.withdrawalResidualForfeitureAllowed !== latest.withdrawalResidualForfeitureAllowed ||
			state.reservationFeeBps !== latest.reservationFeeBps ||
			state.minimumAllocationFeeAttoEth !== latest.minimumAllocationFeeAttoEth
		)
			throw new Error(copy.authorityChanged)
		return latest
	}
	const requireSelection = () => {
		if (snapshot === undefined) throw new Error(copy.noVault)
		return snapshot
	}
	const run = (action: string, label: string, build: () => Promise<PortfolioTransaction> | PortfolioTransaction) => actions.runPortfolioAction(action, label, build)
	const enable = () =>
		run('enablePortfolioAutomatic', copy.enableAutomatic, () => {
			const selected = requireSelection()
			if (state === undefined || !acknowledged.value) throw new Error(copy.acknowledgeRequired)
			if (state.withdrawalRequested) throw new Error(copy.cancelBeforeAutomatic)
			const minimumIdleAttoRep = parsePortfolioAmount(reserve.value)
			const minimumHealthFactorBps = BigInt(health.value)
			const reservationFeeBps = BigInt(reservationFee.value)
			const minimumAllocationFeeAttoEth = parsePortfolioAmount(minimumAllocationFee.value)
			return {
				...buildPortfolioAutomaticUnderwritingRequest({ owner: selected.owner, vault: selected.vault, expectedVersion: state.version, expectedNonce: state.nonce, minimumIdleAttoRep, minimumHealthFactorBps, reservationFeeBps, minimumAllocationFeeAttoEth }),
				reviewDescription: `Authorize eligible mint demand to allocate origin-universe REP while preserving ${formatEther(minimumIdleAttoRep)} REP idle and at least ${minimumHealthFactorBps} bps health. Charge ${reservationFeeBps} bps on the ETH value of additional REP encumbered, with at least ${formatEther(minimumAllocationFeeAttoEth)} ETH for each nonzero allocation, paid to your vault. Native minimum backing can exceed the requested commitment. Question horizon: ${state.maximumQuestionHorizonSeconds} seconds. This replaces earlier allocation authority. Question maturity does not guarantee REP release; reporting, losses and forks may delay or reduce recovery.`,
				validateBeforeSubmit: async () => {
					await reviewedState()
				},
			}
		})
	const withdrawEth = () =>
		run('withdrawPortfolioEth', copy.withdrawVaultEth, () => {
			const selected = requireSelection()
			if (state === undefined) throw new Error(stateReason)
			if (state.ethBalanceAttoEth === 0n) throw new Error(copy.noVaultEth)
			return {
				...buildPortfolioWithdrawEthRequest({ owner: selected.owner, vault: selected.vault }),
				reviewDescription: `Withdraw ${formatEther(state.ethBalanceAttoEth)} ETH from the portfolio vault to its immutable owner ${selected.owner}. Automatic and delegated REP allocation authority remain unchanged.`,
				validateBeforeSubmit: async () => {
					const latest = await reviewedState()
					if (latest.ethBalanceAttoEth !== state.ethBalanceAttoEth) throw new Error(copy.vaultEthChanged)
				},
			}
		})
	const requestWithdrawal = () =>
		run('requestPortfolioWithdrawal', copy.requestWithdrawal, () => {
			const selected = requireSelection()
			return {
				...buildPortfolioWithdrawalRequest({ owner: selected.owner, vault: selected.vault }),
				reviewDescription: copy.withdrawalReview,
				validateBeforeSubmit: async () => {
					const latest = await reviewedState()
					if (latest.withdrawalRequested) throw new Error(copy.withdrawalActive)
				},
			}
		})
	const cancelWithdrawal = () =>
		run('cancelPortfolioWithdrawal', copy.cancelWithdrawal, () => {
			const selected = requireSelection()
			return {
				...buildPortfolioCancelWithdrawalRequest({ owner: selected.owner, vault: selected.vault }),
				reviewDescription: copy.cancelWithdrawalHint,
				validateBeforeSubmit: async () => {
					const latest = await reviewedState()
					if (!latest.withdrawalRequested) throw new Error(copy.noWithdrawal)
				},
			}
		})
	const setResidualForfeiture = (allowed: boolean) =>
		run(allowed ? 'allowPortfolioResidualForfeiture' : 'revokePortfolioResidualForfeiture', allowed ? copy.allowResidualForfeiture : copy.revokeResidualForfeiture, () => {
			const selected = requireSelection()
			if (!state?.withdrawalRequested) throw new Error(copy.noWithdrawal)
			return {
				...buildPortfolioWithdrawalResidualForfeitureRequest({ owner: selected.owner, vault: selected.vault, allowed }),
				reviewDescription: allowed ? copy.residualForfeitureReview : copy.residualProtectionReview,
				validateBeforeSubmit: async () => {
					const latest = await reviewedState()
					if (!latest.withdrawalRequested) throw new Error(copy.noWithdrawal)
				},
			}
		})
	const positions = snapshot?.branches.flatMap(branch => branch.positions.filter(position => position.backingUnits > 0n || position.commitmentAttoEth > 0n || position.disputeStakeAttoRep > 0n)) ?? []
	const processingReason = (position: (typeof positions)[number]) => {
		if (model.loading) return copy.loading
		if (account === undefined) return copy.connect
		if (stateReason !== undefined) return stateReason
		if (!state?.withdrawalRequested) return copy.requestFirst
		return portfolioRunoffAvailability(position, state?.withdrawalResidualForfeitureAllowed).reason
	}
	const process = (position: (typeof positions)[number]) =>
		run(`processPortfolioWithdrawal:${position.pool}`, copy.processWithdrawal, () => {
			const selected = requireSelection()
			const reason = processingReason(position)
			if (reason !== undefined || account === undefined) throw new Error(reason ?? copy.connect)
			return {
				...buildPortfolioProcessWithdrawalRequest({ processor: account, vault: selected.vault, questionId: position.questionId, universeId: position.universeId }),
				reviewDescription: `Process question 0x${position.questionId.toString(16)} in universe ${position.universeId}. Recovered REP goes only to ${selected.owner}. Existing share collateral remains in the native pool. ${state?.withdrawalResidualForfeitureAllowed ? copy.residualForfeitureReview : copy.residualProtectionReview}`,
				validateBeforeSubmit: async () => {
					const latest = await reviewedState()
					if (!latest.withdrawalRequested) throw new Error(copy.noWithdrawal)
				},
			}
		})
	const mintRequest = () => {
		const selected = requireSelection()
		if (account === undefined) throw new Error(copy.connect)
		const mintAttoEth = parsePortfolioAmount(mintAmount.value)
		const supplied = contributors.value
			.split(/[\s,]+/)
			.filter(Boolean)
			.map(vault => ({ vault: getAddress(vault), maximumCommitmentIncreaseAttoEth: mintAttoEth }))
		return buildPortfolioMintRequest({
			trader: account,
			portfolio: selected.portfolio,
			questionId: BigInt(questionId.value),
			contributions: supplied,
			recipient: account,
			minimumShares: parsePortfolioAmount(minimumShares.value),
			mintAttoEth,
			maximumReservationFeeAttoEth: parsePortfolioAmount(maximumReservationFee.value),
		})
	}
	let mintReason = mintQuestion.reason
	const mintPool = mintQuestion.position?.pool
	if (mintReason === undefined) {
		try {
			mintRequest()
			const position = mintQuestion.position
			if (position === undefined) mintReason = copy.registerMintFirst
			else if (snapshot !== undefined && position.questionEndTime <= snapshot.timestamp) mintReason = copy.questionMatured
			else if (position.resolved || position.systemState !== 0n) mintReason = copy.mintInactive
			else if (snapshot !== undefined && state !== undefined && position.questionEndTime - snapshot.timestamp > state.maximumQuestionHorizonSeconds) mintReason = copy.mintHorizon
			else if (position.settlementCollateralAttoEth + parsePortfolioAmount(mintAmount.value) > position.poolCommitmentAttoEth) {
				if (!position.priceValid || position.pendingReportId > 0n) mintReason = copy.mintPriceNeeded
				else if (contributors.value.trim() === '') mintReason = copy.contributorNeeded
				else mintReason = contributorState.value?.key === contributorKey ? contributorState.value.reason : copy.contributorLoading
			}
		} catch (failure) {
			mintReason = getErrorMessage(failure, copy.mintInvalid)
		}
	}
	if (mintReason === undefined) {
		if (mintFee.error !== undefined) mintReason = mintFee.error
		else if (mintFee.fee === undefined) mintReason = copy.reservationFeeLoading
		else if (parsePortfolioAmount(maximumReservationFee.value) < mintFee.fee) mintReason = copy.reservationFeeBudgetLow
	}
	const residualPermissionReason = ownerReason ?? stateReason ?? (!state?.withdrawalRequested ? copy.noWithdrawal : undefined)
	return {
		state,
		readError: readError.value,
		reserve: reserve.value,
		health: health.value,
		reservationFee: reservationFee.value,
		minimumAllocationFee: minimumAllocationFee.value,
		acknowledged: acknowledged.value,
		retry: () => model.refresh(),
		setReserve: (value: string) => {
			reserve.value = value
			acknowledged.value = false
		},
		setHealth: (value: string) => {
			health.value = value
			acknowledged.value = false
		},
		setReservationFee: (value: string) => {
			reservationFee.value = value
			acknowledged.value = false
		},
		setMinimumAllocationFee: (value: string) => {
			minimumAllocationFee.value = value
			acknowledged.value = false
		},
		setAcknowledged: (value: boolean) => {
			acknowledged.value = value
		},
		enableReason: ownerReason ?? stateReason ?? (state?.withdrawalRequested ? copy.cancelBeforeAutomatic : undefined) ?? (origin?.forkTime !== 0n ? copy.forkAutomatic : undefined) ?? inputReason ?? (!acknowledged.value ? copy.acknowledgeRequired : undefined),
		requestReason: ownerReason ?? stateReason ?? (state?.withdrawalRequested ? copy.withdrawalActive : undefined),
		cancelReason: ownerReason ?? stateReason ?? (!state?.withdrawalRequested ? copy.noWithdrawal : undefined),
		enable,
		requestWithdrawal,
		withdrawEth,
		withdrawEthReason: ownerReason ?? stateReason ?? (state?.ethBalanceAttoEth === 0n ? copy.noVaultEth : undefined),
		cancelWithdrawal,
		allowResidualForfeiture: () => setResidualForfeiture(true),
		revokeResidualForfeiture: () => setResidualForfeiture(false),
		allowResidualForfeitureReason: residualPermissionReason ?? (state?.withdrawalResidualForfeitureAllowed ? copy.residualForfeitureAllowed : undefined),
		revokeResidualForfeitureReason: residualPermissionReason ?? (!state?.withdrawalResidualForfeitureAllowed ? copy.residualsProtected : undefined),
		positions: positions.map(position => ({ ...position, partial: portfolioRunoffAvailability(position, state?.withdrawalResidualForfeitureAllowed).partial, processReason: processingReason(position), process: () => process(position) })),
		queue: queue.value,
		queueError: queueError.value,
		queueOffset: queueOffset.value,
		openVault: async (vault: string) => {
			try {
				const owner = await backend.createReadClient().readContract({ address: getAddress(vault), abi: vaultArtifact.abi, functionName: 'owner' })
				await model.load(selection?.portfolio, owner)
			} catch (failure) {
				queueError.value = getErrorMessage(failure, copy.snapshotFailed)
			}
		},
		previousQueue: () => {
			if (queueOffset.value >= 16n) queueOffset.value -= 16n
		},
		nextQueue: () => {
			queueOffset.value += 16n
		},
		questionId: questionId.value,
		setQuestionId: (value: string) => {
			questionId.value = value
		},
		mintAmount: mintAmount.value,
		setMintAmount: (value: string) => {
			mintAmount.value = value
		},
		maximumReservationFee: maximumReservationFee.value,
		setMaximumReservationFee: (value: string) => {
			maximumReservationFeeEdited.value = true
			maximumReservationFee.value = value
		},
		estimatedReservationFee: mintFee.fee,
		reservationFeeLoading: mintFee.loading,
		reservationFeeError: mintFee.error,
		retryReservationFee: mintFee.retry,
		useEstimatedReservationFee: () => {
			if (mintFee.fee !== undefined) {
				maximumReservationFeeEdited.value = true
				maximumReservationFee.value = formatEther(mintFee.fee)
			}
		},
		minimumShares: minimumShares.value,
		setMinimumShares: (value: string) => {
			minimumShares.value = value
		},
		contributors: contributors.value,
		setContributors: (value: string) => {
			contributors.value = value
		},
		mintPool,
		mintQuestionLoading: mintQuestion.loading,
		mintQuestionError: mintQuestion.error,
		retryMintQuestion: mintQuestion.retry,
		mintReason: stateReason ?? (origin?.forkTime !== 0n ? copy.forkAutomatic : undefined) ?? mintReason,
		mint: () =>
			run('mintPortfolioCompleteSet', copy.mint, () => {
				if (stateReason !== undefined || mintReason !== undefined || origin?.forkTime !== 0n) throw new Error(stateReason ?? mintReason ?? copy.forkAutomatic)
				const reviewedContributors = contributorState.value?.key === contributorKey ? contributorState.value.authorities : undefined
				const selected = requireSelection()
				const quotedFee = mintFee.fee
				const capturedQuestionId = BigInt(questionId.value)
				const mintAttoEth = parsePortfolioAmount(mintAmount.value)
				const supplied = contributors.value
					.split(/[\s,]+/)
					.filter(Boolean)
					.map(vault => ({ vault: getAddress(vault), maximumCommitmentIncreaseAttoEth: mintAttoEth }))
				return {
					...mintRequest(),
					validateBeforeSubmit: async () => {
						const client = createConnectedReadClient()
						const block = await client.getBlock()
						if (block.number === undefined || block.hash === undefined) throw new Error(copy.snapshotFailed)
						for (const authority of reviewedContributors ?? []) {
							const latest = await readContributorAuthority(client, authority.vault, selected.portfolio, block.number)
							if (latest.fingerprint !== authority.fingerprint) throw new Error(copy.authorityChanged)
						}
						const latestSnapshot = { ...selected, blockNumber: block.number, blockHash: block.hash, timestamp: block.timestamp }
						const latestPosition = await loadPortfolioMintQuestion(client, latestSnapshot, capturedQuestionId)
						if (latestPosition === undefined) throw new Error(copy.registerMintFirst)
						const latestFee = await loadPortfolioMintReservationFee(client, latestSnapshot, latestPosition, capturedQuestionId, mintAttoEth, supplied)
						if (latestFee !== quotedFee) throw new Error(copy.reservationFeeChanged)
					},
					reviewDescription: `${copy.mintReview} Collateral: ${mintAmount.value} ETH. Estimated reservation fee: ${formatEther(quotedFee ?? 0n)} ETH. Maximum total reservation fee: ${maximumReservationFee.value} ETH, additional to collateral. Each used vault may charge its own minimum allocation fee. Only actual fees are retained; unused fee budget is refunded.`,
				}
			}),
	}
}
