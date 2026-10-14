import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { createActiveEnvironmentGuard, getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { loadPortfolioMintReservationFee, type loadPortfolioMintQuestion } from '../../../protocol/securityPoolPortfolioMint.js'
import { parsePortfolioAmount } from '../lib/draft.js'
import * as copy from '../../../copy/portfolio.js'

export function usePortfolioMintFee(snapshot: PortfolioSnapshot | undefined, position: Awaited<ReturnType<typeof loadPortfolioMintQuestion>>, question: string, amount: string, vaults: string) {
	const backend = getActiveBackend()
	const retryVersion = useSignal(0)
	const result = useSignal<{ key: string; backend: typeof backend; snapshot: PortfolioSnapshot; position: Awaited<ReturnType<typeof loadPortfolioMintQuestion>>; fee?: bigint; error?: string } | undefined>(undefined)
	let inputError: string | undefined
	let input: { questionId: bigint; mintAttoEth: bigint; contributions: { vault: ReturnType<typeof getAddress>; maximumCommitmentIncreaseAttoEth: bigint }[] } | undefined
	try {
		const mintAttoEth = parsePortfolioAmount(amount)
		const questionId = BigInt(question)
		if (mintAttoEth > 0n && question.trim() !== '' && questionId >= 0n && questionId < 1n << 256n)
			input = {
				questionId,
				mintAttoEth,
				contributions: vaults
					.split(/[\s,]+/)
					.filter(Boolean)
					.map(vault => ({ vault: getAddress(vault), maximumCommitmentIncreaseAttoEth: mintAttoEth })),
			}
	} catch (failure) {
		inputError = getErrorMessage(failure, copy.mintInvalid)
	}
	const key = `${snapshot?.blockHash}:${question}:${amount}:${vaults}:${retryVersion.value}`
	const currentResult = result.value?.key === key && result.value.backend === backend && result.value.snapshot === snapshot && result.value.position === position ? result.value : undefined
	const ready = snapshot !== undefined && position !== undefined && input !== undefined && !position.resolved && position.systemState === 0n && position.questionEndTime > snapshot.timestamp
	useEffect(() => {
		let current = true
		const environment = createActiveEnvironmentGuard()
		if (!ready || snapshot === undefined || position === undefined || input === undefined) return
		const { questionId, mintAttoEth, contributions } = input
		void loadPortfolioMintReservationFee(backend.createReadClient(), snapshot, position, questionId, mintAttoEth, contributions)
			.then(fee => {
				if (current && environment.isCurrent()) result.value = { key, backend, snapshot, position, fee }
			})
			.catch(failure => {
				if (current && environment.isCurrent()) result.value = { key, backend, snapshot, position, error: getErrorMessage(failure, copy.reservationFeeFailed) }
			})
		return () => {
			current = false
		}
	}, [backend, snapshot, position, key, ready])
	return {
		fee: ready ? currentResult?.fee : undefined,
		loading: ready && currentResult === undefined,
		error: ready ? currentResult?.error : inputError,
		retry: () => {
			retryVersion.value += 1
		},
	}
}
