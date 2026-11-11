import { useEffect, useRef, useState } from 'preact/hooks'
import { useChainBlockNumber } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { getOpenOracleAddress } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { getWethAddress } from '@zoltar/ui-zoltar-shared/protocol/uniswapQuoter.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { parseOpenOracleCreateFormSubmission } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/openOracle.js'
import * as copy from '../copy/funding.js'

type FundingParameters = ReturnType<typeof parseOpenOracleCreateFormSubmission>
export type CreateFundingAccess = { balance: bigint; allowance: bigint }
export async function loadCreateFunding(token: Address, owner: Address): Promise<CreateFundingAccess> {
	const client = createConnectedReadClient()
	const [balance, allowance] = await Promise.all([client.readContract({ address: token, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [owner] }), client.readContract({ address: token, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [owner, getOpenOracleAddress()] })])
	return { balance, allowance }
}

export function useCreateFunding({ owner, parameters, enabled, revision, load = loadCreateFunding }: { owner: Address | undefined; parameters: FundingParameters | undefined; enabled: boolean; revision: string | undefined; load?: typeof loadCreateFunding }) {
	const blockNumber = useChainBlockNumber()
	const [attempt, setAttempt] = useState(0)
	const refreshOnBlock = useRef<() => void>()
	const lastBlock = useRef(blockNumber)
	const backend = getActiveBackend()
	const key = `${backend.id}:${owner}:${parameters?.token1Address}:${parameters?.token2Address}:${parameters?.exactToken1Report}:${parameters?.initialToken2Amount}:${revision}:${attempt}`
	const [loaded, setLoaded] = useState<{ key: string; backend: typeof backend; first?: CreateFundingAccess; second?: CreateFundingAccess; error?: string }>()
	useEffect(() => {
		let current = true
		let running = false
		let queued = false
		const refresh = async () => {
			if (!enabled || owner === undefined || parameters === undefined) return
			if (running) {
				queued = true
				return
			}
			running = true
			do {
				queued = false
				try {
					const [first, second] = await Promise.all([load(parameters.token1Address, owner), load(parameters.token2Address, owner)])
					if (current && getActiveBackend() === backend) setLoaded({ key, backend, first, second })
				} catch (error) {
					if (current && getActiveBackend() === backend) setLoaded({ key, backend, error: getErrorMessage(error, copy.unavailable) })
				}
			} while (current && queued)
			running = false
		}
		refreshOnBlock.current = () => {
			void refresh()
		}
		void refresh()
		return () => {
			current = false
			refreshOnBlock.current = undefined
		}
	}, [backend, key, enabled, load])
	useEffect(() => {
		if (lastBlock.current === blockNumber) return
		lastBlock.current = blockNumber
		refreshOnBlock.current?.()
	}, [blockNumber])
	const state = loaded?.key === key && loaded.backend === backend ? loaded : undefined
	const tokens =
		parameters === undefined
			? []
			: [
					{ key: 'token1' as const, token: parameters.token1Address, required: parameters.exactToken1Report, access: state?.first },
					{ key: 'token2' as const, token: parameters.token2Address, required: parameters.initialToken2Amount, access: state?.second },
				]
	let wrap = 0n
	let reason = state?.error
	if (enabled && parameters !== undefined && reason === undefined) {
		if (state?.first === undefined || state.second === undefined) reason = copy.loading
		else
			for (const token of tokens) {
				if (token.access === undefined) continue
				if (token.access.balance < token.required) {
					if (token.token === getWethAddress()) {
						wrap = token.required - token.access.balance
						reason ??= copy.wrapRequired
					} else reason ??= copy.insufficient
				}
				if (token.access.allowance < token.required) reason ??= copy.approvalRequired
			}
	}
	return { tokens, wrap, reason, loading: state === undefined, error: state?.error, retry: () => setAttempt(value => value + 1) }
}
