import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { formatEther, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioServiceCreditRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { loadPortfolioServiceCredit } from '../../../protocol/securityPoolPortfolioReporting.js'
import { getPortfolioClaimReadiness, type PortfolioClaimModel } from '../lib/claimReadiness.js'
import type { usePortfolioActions } from './usePortfolioActions.js'
import * as copy from '../../../copy/portfolioReporting.js'

type Credit = Awaited<ReturnType<typeof loadPortfolioServiceCredit>>
export function usePortfolioServiceCredit({ model, actions, accountAddress }: { model: PortfolioClaimModel; actions: Pick<ReturnType<typeof usePortfolioActions>, 'runPortfolioAction'>; accountAddress: Address | undefined }) {
	const loaded = useSignal<{ key: string; credit?: Credit; error?: string } | undefined>(undefined)
	const snapshot = model.snapshot
	const key = `${snapshot?.portfolio}:${snapshot?.chainId}:${snapshot?.blockHash}:${accountAddress}`
	useEffect(() => {
		let current = true
		loaded.value = undefined
		if (snapshot !== undefined && accountAddress !== undefined) {
			void loadPortfolioServiceCredit(createConnectedReadClient(), snapshot, accountAddress)
				.then(credit => {
					if (current) loaded.value = { key, credit }
				})
				.catch(failure => {
					if (current) loaded.value = { key, error: getErrorMessage(failure, copy.serviceFailed) }
				})
		}
		return () => {
			current = false
		}
	}, [key])
	const current = loaded.value?.key === key ? loaded.value : undefined
	const credit = current?.credit
	const portfolioReadiness = getPortfolioClaimReadiness(model)
	const loading = portfolioReadiness.loading || (portfolioReadiness.reason === undefined && snapshot !== undefined && accountAddress !== undefined && current === undefined)
	let reason: string | undefined
	if (accountAddress === undefined) reason = copy.connect
	else if (portfolioReadiness.reason !== undefined) reason = portfolioReadiness.reason
	else if (current?.error !== undefined) reason = current.error
	else if (credit === undefined) reason = copy.serviceLoading
	else if (credit.amount === 0n) reason = copy.serviceEmpty
	return {
		amount: credit?.amount,
		recipient: accountAddress,
		loading,
		reason,
		claim: () =>
			actions.runPortfolioAction('claimPortfolioServiceCredit', copy.serviceClaim, () => {
				if (reason !== undefined || snapshot === undefined || credit === undefined || accountAddress === undefined) throw new Error(reason ?? copy.serviceFailed)
				const selected = snapshot
				return {
					...buildPortfolioServiceCreditRequest({ caller: accountAddress, services: credit.services, recipient: accountAddress }),
					reviewDescription: `Withdraw ${formatEther(credit.amount)} ETH of service reimbursements to your wallet ${accountAddress}. Gas is additional.`,
					validateBeforeSubmit: async () => {
						const client = createConnectedReadClient()
						const [block, chainId] = await Promise.all([client.getBlock(), client.getChainId()])
						if (chainId !== selected.chainId || typeof block.number !== 'bigint' || typeof block.hash !== 'string') throw new Error(copy.serviceChanged)
						const fresh = await loadPortfolioServiceCredit(client, { ...selected, blockNumber: block.number, blockHash: block.hash }, accountAddress)
						if (fresh.amount === 0n || fresh.amount !== credit.amount || fresh.services !== credit.services) throw new Error(copy.serviceChanged)
					},
				}
			}),
	}
}
