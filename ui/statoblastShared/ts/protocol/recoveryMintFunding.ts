import { shareErrors } from '../copy/protocolErrors.js'
import { securityPoolRecoveryMintBudget } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { parseAbi, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { requireAddressValue } from './decoders.js'

const abi = parseAbi(['function settlement() view returns(address)', 'function recoveryTokens(uint248) view returns(address)'])

/** The proportional REP contribution belongs to the purchased claims, independently of collateral fees. */
export async function loadRecoveryMintFunding(client: Pick<ReadClient, 'readContract'>, securityPool: Address, universe: bigint, owner: Address, required: bigint, blockNumber?: bigint) {
	const maximum = securityPoolRecoveryMintBudget(required)
	if (required < 0n) throw new Error(shareErrors.invalidRecoveryAmount)
	if (required === 0n) return { required, maximum, balance: 0n, allowance: 0n, token: undefined, spender: undefined }
	const spender = requireAddressValue(await client.readContract({ abi, address: securityPool, functionName: 'settlement', blockNumber }), 'Recovery REP spender')
	const token = requireAddressValue(await client.readContract({ abi, address: spender, functionName: 'recoveryTokens', args: [universe], blockNumber }), 'Recovery REP token')
	if (token === zeroAddress || spender === zeroAddress) throw new Error(shareErrors.recoveryFundsUnavailable)
	const [balance, allowance] = await Promise.all([client.readContract({ abi: ABIS.mainnet.erc20, address: token, functionName: 'balanceOf', args: [owner], blockNumber }), client.readContract({ abi: ABIS.mainnet.erc20, address: token, functionName: 'allowance', args: [owner, spender], blockNumber })])
	return { required, maximum, balance, allowance, token, spender }
}
