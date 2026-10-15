import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { getAddress, formatEther, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	buildPortfolioWithdrawalRequest,
	buildPortfolioWithdrawEthRequest,
	buildPortfolioCancelWithdrawalRequest,
	buildPortfolioWithdrawalResidualForfeitureRequest,
	buildPortfolioProcessWithdrawalRequest,
	loadPortfolioRecoveryState,
	loadPortfolioWithdrawalRequests,
	type PortfolioRecoveryState,
} from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { portfolioReadClient, vaultArtifact, type PortfolioTransaction } from '../../../protocol/securityPoolPortfolio.js'
import { portfolioRunoffAvailability } from '../lib/runoff.js'
import type { usePortfolio } from './usePortfolio.js'
import type { usePortfolioActions } from './usePortfolioActions.js'
import * as copy from '../../../copy/portfolio.js'

export function usePortfolioAutomatic(model: Pick<ReturnType<typeof usePortfolio>, 'snapshot' | 'selection' | 'refresh' | 'load' | 'loading'>, actions: Pick<ReturnType<typeof usePortfolioActions>, 'vaultReason' | 'runPortfolioAction'>, account: Address | undefined) {
	const loaded = useSignal<{ key: string; state: PortfolioRecoveryState } | undefined>(undefined)
	const readError = useSignal<string | undefined>(undefined)
	const queueOffset = useSignal(0n)
	const queue = useSignal<Awaited<ReturnType<typeof loadPortfolioWithdrawalRequests>> | undefined>(undefined)
	const queueError = useSignal<string | undefined>(undefined)
	const backend = getActiveBackend()
	const snapshot = model.snapshot
	const selection = model.selection
	const key = snapshot === undefined ? '' : `${snapshot.portfolio}:${snapshot.vault}:${snapshot.blockHash}`
	const state = loaded.value?.key === key ? loaded.value.state : undefined
	useEffect(() => {
		let current = true
		readError.value = undefined
		loaded.value = undefined
		if (snapshot !== undefined)
			void loadPortfolioRecoveryState({ client: portfolioReadClient(backend.createReadClient()), vault: snapshot.vault, blockNumber: snapshot.blockNumber })
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
		queueOffset.value = 0n
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
	const ownerReason = actions.vaultReason
	const stateReason = readError.value ?? (state === undefined ? copy.recoveryLoading : undefined)
	const loadCurrent = async () => {
		if (snapshot === undefined) throw new Error(copy.enterPortfolio)
		const client = createConnectedReadClient()
		const block = await client.getBlock()
		if (block.number === undefined) throw new Error(copy.snapshotFailed)
		return await loadPortfolioRecoveryState({ client: portfolioReadClient(client), vault: snapshot.vault, blockNumber: block.number })
	}
	const reviewedState = async () => {
		if (state === undefined) throw new Error(stateReason)
		const latest = await loadCurrent()
		if (state.version !== latest.version || state.nonce !== latest.nonce || state.withdrawalRequested !== latest.withdrawalRequested || state.withdrawalRequestId !== latest.withdrawalRequestId || state.withdrawalResidualForfeitureAllowed !== latest.withdrawalResidualForfeitureAllowed)
			throw new Error(copy.authorityChanged)
		return latest
	}
	const requireSelection = () => {
		if (snapshot === undefined) throw new Error(copy.noVault)
		return snapshot
	}
	const run = (action: string, label: string, build: () => Promise<PortfolioTransaction> | PortfolioTransaction) => actions.runPortfolioAction(action, label, build)
	const withdrawEth = () =>
		run('withdrawPortfolioEth', copy.withdrawVaultEth, () => {
			const selected = requireSelection()
			if (state === undefined) throw new Error(stateReason)
			if (state.ethBalanceAttoEth === 0n) throw new Error(copy.noVaultEth)
			return {
				...buildPortfolioWithdrawEthRequest({ owner: selected.owner, vault: selected.vault }),
				reviewDescription: `Withdraw ${formatEther(state.ethBalanceAttoEth)} ETH from the portfolio vault to its immutable owner ${selected.owner}. Native REP positions and delegated authority remain unchanged.`,
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
	const residualPermissionReason = ownerReason ?? stateReason ?? (!state?.withdrawalRequested ? copy.noWithdrawal : undefined)
	return {
		state,
		readError: readError.value,
		retry: () => model.refresh(),
		requestReason: ownerReason ?? stateReason ?? (state?.withdrawalRequested ? copy.withdrawalActive : undefined),
		cancelReason: ownerReason ?? stateReason ?? (!state?.withdrawalRequested ? copy.noWithdrawal : undefined),
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
	}
}
