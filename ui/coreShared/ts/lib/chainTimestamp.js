import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
export const ChainTimestampContext = createContext(undefined);
export const ChainBlockNumberContext = createContext(undefined);
export function useChainTimestamp() {
    return useContext(ChainTimestampContext);
}
export function useChainBlockNumber() {
    return useContext(ChainBlockNumberContext);
}
//# sourceMappingURL=chainTimestamp.js.map