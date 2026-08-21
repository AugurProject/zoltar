import { createContext } from 'preact'
import { useContext } from 'preact/hooks'

export const ChainTimestampContext = createContext<bigint | undefined>(undefined)
export const ChainBlockNumberContext = createContext<bigint | undefined>(undefined)

export function useChainTimestamp() {
	return useContext(ChainTimestampContext)
}

export function useChainBlockNumber() {
	return useContext(ChainBlockNumberContext)
}
