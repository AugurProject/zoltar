import { parseAbi, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { readRequiredMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { statoblast_QuestionLedger_QuestionLedger } from '../contractArtifact.js'
import { requireBigintValue } from './decoders.js'

export async function loadCompleteSetRedemptionQuote(client: Pick<ReadClient, 'multicall'>, pool: Address, shares: bigint, blockNumber: bigint | undefined) {
	const recoveryAbi = parseAbi(['function attoSharesToAttoRep(uint256 amountAttoShares) view returns (uint256)'])
	const [, cash, rep] = await readRequiredMulticall(
		client,
		[
			{ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: pool, functionName: 'refreshSecurityPoolFees', args: [] },
			{ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: pool, functionName: 'attoSharesToAttoEth', args: [shares] },
			{ abi: recoveryAbi, address: pool, functionName: 'attoSharesToAttoRep', args: [shares] },
		],
		blockNumber,
	)
	return { cash: requireBigintValue(cash, 'redemption collateral quote'), rep: requireBigintValue(rep, 'recovery REP quote') }
}
