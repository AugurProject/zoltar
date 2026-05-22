import { createContext } from 'preact'
import { useContext } from 'preact/hooks'

export const ChainTimestampContext = createContext<bigint | undefined>(undefined)

export function useChainTimestamp() {
	return useContext(ChainTimestampContext)
}
