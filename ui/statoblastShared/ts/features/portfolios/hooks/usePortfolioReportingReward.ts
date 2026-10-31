import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { formatEther, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioReportingRewardRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { loadPortfolioReportingReward } from '../../../protocol/securityPoolPortfolioReporting.js'
import { portfolioUnsignedId } from '../lib/draft.js'
import { getPortfolioClaimReadiness, type PortfolioClaimModel } from '../lib/claimReadiness.js'
import type { usePortfolioActions } from './usePortfolioActions.js'
import * as copy from '../../../copy/portfolioReporting.js'

type Reward = Awaited<ReturnType<typeof loadPortfolioReportingReward>>
function rewardReason(reward: Reward) {
	if (reward.sourceOnly) return copy.source
	if (!reward.final) return copy.notFinal
	if (reward.rewardShares === 0n) return copy.empty
	if (reward.beneficiary === undefined) return copy.noRecipient
	if (reward.cashAttoEth === 0n && reward.recoveryAttoRep === 0n) return copy.empty
	return undefined
}

export function usePortfolioReportingReward({ model, actions, accountAddress, questionInput }: { model: PortfolioClaimModel; actions: Pick<ReturnType<typeof usePortfolioActions>, 'runPortfolioAction'>; accountAddress: Address | undefined; questionInput: string }) {
	const loaded = useSignal<{ key: string; reward?: Reward; error?: string } | undefined>(undefined)
	const snapshot = model.snapshot
	const questionId = portfolioUnsignedId(questionInput)
	const key = `${snapshot?.portfolio}:${snapshot?.universeId}:${snapshot?.blockHash}:${questionId}`
	useEffect(() => {
		let current = true
		loaded.value = undefined
		if (snapshot !== undefined && questionId !== undefined) {
			void loadPortfolioReportingReward(createConnectedReadClient(), snapshot, questionId)
				.then(reward => {
					if (current) loaded.value = { key, reward }
				})
				.catch(failure => {
					if (current) loaded.value = { key, error: getErrorMessage(failure, copy.failed) }
				})
		}
		return () => {
			current = false
		}
	}, [key])
	const current = loaded.value?.key === key ? loaded.value : undefined
	const reward = current?.reward
	const portfolioReadiness = getPortfolioClaimReadiness(model)
	const loading = portfolioReadiness.loading || (portfolioReadiness.reason === undefined && snapshot !== undefined && questionId !== undefined && current === undefined)
	let reason: string | undefined
	if (accountAddress === undefined) reason = copy.connect
	else if (portfolioReadiness.reason !== undefined) reason = portfolioReadiness.reason
	else if (questionId === undefined) reason = copy.select
	else if (current?.error !== undefined) reason = current.error
	else if (reward === undefined) reason = copy.loading
	else reason = rewardReason(reward)
	return {
		reward,
		loading,
		reason,
		claim: () =>
			actions.runPortfolioAction('claimPortfolioReportingReward', copy.claim, () => {
				if (reason !== undefined || snapshot === undefined || questionId === undefined || accountAddress === undefined || reward?.beneficiary === undefined) throw new Error(reason ?? copy.failed)
				const selected = snapshot
				return {
					...buildPortfolioReportingRewardRequest({ caller: accountAddress, portfolio: selected.portfolio, pool: reward.pool }),
					reviewDescription: `Release ${formatEther(reward.cashAttoEth)} ETH for question 0x${questionId.toString(16)} to the fixed recipient ${reward.beneficiary}. ${formatEther(reward.recoveryAttoRep)} REP will be burned. ${reward.maintenance ? copy.maintenance : copy.rewardSurplus} Your wallet pays only gas.`,
					validateBeforeSubmit: async () => {
						const client = createConnectedReadClient()
						const [block, chainId] = await Promise.all([client.getBlock(), client.getChainId()])
						if (chainId !== selected.chainId || typeof block.number !== 'bigint' || typeof block.hash !== 'string') throw new Error(copy.changed)
						const fresh = await loadPortfolioReportingReward(client, { ...selected, blockNumber: block.number, blockHash: block.hash }, questionId)
						if (rewardReason(fresh) !== undefined || fresh.pool !== reward.pool || fresh.outcome !== reward.outcome || fresh.beneficiary !== reward.beneficiary || fresh.cashAttoEth !== reward.cashAttoEth || fresh.recoveryAttoRep !== reward.recoveryAttoRep) throw new Error(copy.changed)
					},
				}
			}),
	}
}
