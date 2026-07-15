import { formatCurrencyBalance } from '../../../lib/formatters.js'
import { addOpenOracleBountyBuffer } from '../../../protocol/openOracleMath.js'
import { resolveOracleOperationEthFunding } from '../../../protocol/oracleRequestFunding.js'

export { resolveOracleOperationEthFunding }

function getBufferedOracleRequestEthValue(requestPriceEthCost: bigint | undefined) {
	if (requestPriceEthCost === undefined) return undefined
	return addOpenOracleBountyBuffer(requestPriceEthCost)
}

export function getOracleRequestEthGuardMessage({ actionLabel, includeBuffer = false, requiredEthCost, walletEthBalance }: { actionLabel: string; includeBuffer?: boolean; requiredEthCost: bigint | undefined; walletEthBalance: bigint | undefined }) {
	const requiredEthValue = includeBuffer ? getBufferedOracleRequestEthValue(requiredEthCost) : requiredEthCost
	if (requiredEthValue === undefined) return undefined
	if (requiredEthValue === 0n) return undefined
	if (walletEthBalance === undefined) return 'Loading wallet ETH balance.'
	if (walletEthBalance >= requiredEthValue) return undefined
	return `Need ${formatCurrencyBalance(requiredEthValue - walletEthBalance)} more ETH in this wallet to ${actionLabel}.`
}
