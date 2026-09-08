import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { ZoltarQuestionData_ZoltarQuestionData, Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'

const CONTRACT_LABEL_BY_ABI = new Map<readonly unknown[], string>([
	[ABIS.mainnet.erc20, 'ERC-20 Token'],
	[ZoltarQuestionData_ZoltarQuestionData.abi, 'Zoltar Question Data'],
	[Zoltar_Zoltar.abi, 'Zoltar'],
])

export function getContractLabel(abi: readonly unknown[], functionName: string) {
	return CONTRACT_LABEL_BY_ABI.get(abi) ?? (functionName === 'deposit' ? 'WETH' : undefined)
}
