import { encodeExecutionBlockHeaderRlp } from '@zoltar/shared/executionBlockHeader'
import type { Hex } from '@zoltar/shared/ethereum'
import type { AnvilWindowEthereum } from '../AnvilWindowEthereum'

export async function getExecutionBlockHeaderRlp(ethereum: AnvilWindowEthereum, blockNumber: bigint): Promise<Hex> {
	const rawBlock = await ethereum.requestRaw({ method: 'eth_getBlockByNumber', params: [`0x${blockNumber.toString(16)}`, false] })
	return encodeExecutionBlockHeaderRlp(rawBlock, blockNumber)
}
