import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getTokenApprovalResetReason } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { getWethAddress } from '@zoltar/ui-zoltar-shared/protocol/uniswapQuoter.js'
import { getOpenOracleAddress } from '../../../protocol/deploymentHelpers.js'
import type { OpenOracleCreateFormState } from '../../../types/app.js'
import { parseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { parseOpenOracleCreateFormSubmission } from './openOracle.js'
import { type OpenOracleReadClient, readCreateTokenDecimals } from './openOracleTokenAccess.js'

export async function validateCreateReportApproval(client: OpenOracleReadClient, token: Address, owner: Address, amount: bigint) {
	const allowance = await client.readContract({ address: token, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [owner, getOpenOracleAddress()] })
	if (typeof allowance !== 'bigint') throw new Error('Token allowance unavailable.')
	const reason = getTokenApprovalResetReason(allowance, amount, 'USDT', token.toLowerCase() === getActiveNetworkProfile().usdtAddress?.toLowerCase())
	if (reason !== undefined) throw new Error(reason)
}

export async function createReportWrapShortfall(client: OpenOracleReadClient, owner: Address, form: OpenOracleCreateFormState) {
	const first = parseAddressInput(form.token1Address, 'Base token')
	const second = parseAddressInput(form.token2Address, 'Quote token')
	const [firstUnits, secondUnits] = await Promise.all([readCreateTokenDecimals(client, first, 'Base'), readCreateTokenDecimals(client, second, 'Quote')])
	if (firstUnits.status !== 'success' || secondUnits.status !== 'success') throw new Error('Token decimals unavailable.')
	const parameters = parseOpenOracleCreateFormSubmission({ form, token1Decimals: firstUnits.decimals, token2Decimals: secondUnits.decimals })
	let required = 0n
	if (first === getWethAddress()) required = parameters.exactToken1Report
	else if (second === getWethAddress()) required = parameters.initialToken2Amount
	const balance = await client.readContract({ address: getWethAddress(), abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [owner] })
	if (typeof balance !== 'bigint' || required <= balance) throw new Error('No ETH wrapping is required.')
	return required - balance
}
