import { AnvilWindowEthereum } from './AnvilWindowEthereum'
export declare const TEST_TIMEOUT_MS = 300000
type AnvilConnectionMode =
	| {
			readonly type: 'spawn-isolated'
			readonly rpcUrl: string
			readonly port: number
	  }
	| {
			readonly type: 'use-existing'
			readonly rpcUrl: string
	  }
export declare const getAnvilConnectionMode: () => AnvilConnectionMode
export declare const useIsolatedAnvilNode: () => {
	getAnvilWindowEthereum: () => AnvilWindowEthereum
}
export {}
//# sourceMappingURL=useIsolatedAnvilNode.d.ts.map
