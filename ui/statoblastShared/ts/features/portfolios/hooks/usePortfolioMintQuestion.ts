import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { PortfolioSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { createActiveEnvironmentGuard, getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { loadPortfolioMintQuestion } from '../../../protocol/securityPoolPortfolioMint.js'
import * as copy from '../../../copy/portfolio.js'

function parsedQuestionId(value: string) {
	if (value.trim() === '') return undefined
	try {
		const id = BigInt(value)
		return id >= 0n && id < 1n << 256n ? id : undefined
	} catch (failure) {
		if (!(failure instanceof SyntaxError)) throw failure
		return undefined
	}
}

export function usePortfolioMintQuestion(snapshot: PortfolioSnapshot | undefined, input: string) {
	const backend = getActiveBackend()
	const result = useSignal<{ key: string; snapshot: PortfolioSnapshot; backend: typeof backend; position?: Awaited<ReturnType<typeof loadPortfolioMintQuestion>>; error?: string } | undefined>(undefined)
	const retryVersion = useSignal(0)
	const questionId = parsedQuestionId(input)
	const known = snapshot?.branches.find(branch => branch.universeId === snapshot.originUniverseId)?.positions.find(position => position.questionId === questionId)
	const key = `${snapshot?.chainId}:${snapshot?.portfolio}:${snapshot?.vault}:${snapshot?.originUniverseId}:${snapshot?.blockHash}:${questionId}:${retryVersion.value}`
	const currentResult = known === undefined && result.value?.key === key && result.value.backend === backend && result.value.snapshot === snapshot ? result.value : undefined
	useEffect(() => {
		let current = true
		const environment = createActiveEnvironmentGuard()
		if (snapshot === undefined || questionId === undefined || known !== undefined) return
		const timer = setTimeout(() => {
			void loadPortfolioMintQuestion(backend.createReadClient(), snapshot, questionId)
				.then(position => {
					if (current && environment.isCurrent()) result.value = { key, snapshot, backend, position }
				})
				.catch(failure => {
					if (current && environment.isCurrent()) result.value = { key, snapshot, backend, error: getErrorMessage(failure, copy.mintQuestionFailed) }
				})
		}, 250)
		return () => {
			current = false
			clearTimeout(timer)
		}
	}, [backend, snapshot, key, known !== undefined])
	const loading = snapshot !== undefined && questionId !== undefined && known === undefined && currentResult === undefined
	const position = known ?? currentResult?.position
	let reason: string | undefined
	if (questionId === undefined) reason = input.trim() === '' ? copy.registerDisabled : copy.mintQuestionInvalid
	else if (loading) reason = copy.mintQuestionLoading
	else if (currentResult?.error !== undefined) reason = currentResult.error
	else if (position === undefined) reason = copy.registerMintFirst
	return {
		position,
		reason,
		loading,
		error: currentResult?.error,
		retry: () => {
			retryVersion.value += 1
		},
	}
}
