import { formatCurrencyBalance } from './formatters.js'
import { addOpenOracleBountyBuffer } from './openOracle.js'

function getBufferedOracleRequestEthValue(requestPriceEthCost: bigint | undefined) {
	if (requestPriceEthCost === undefined) return undefined
	return addOpenOracleBountyBuffer(requestPriceEthCost)
}

export function getOracleRequestEthGuardMessage({ actionLabel, requestPriceEthCost, walletEthBalance }: { actionLabel: string; requestPriceEthCost: bigint | undefined; walletEthBalance: bigint | undefined }) {
	const requiredEthValue = getBufferedOracleRequestEthValue(requestPriceEthCost)
	if (requiredEthValue === undefined) return undefined
	if (walletEthBalance === undefined) return 'Loading wallet ETH balance.'
	if (walletEthBalance >= requiredEthValue) return undefined
	return `Need ${formatCurrencyBalance(requiredEthValue - walletEthBalance)} more ETH in this wallet to ${actionLabel}.`
}
