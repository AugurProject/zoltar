import * as funtypes from 'funtypes'
import { EthereumQuantity } from './wire-types.js'

export type RpcEntry = funtypes.Static<typeof RpcEntry>
export const RpcEntry = funtypes.ReadonlyObject({
	name: funtypes.String,
	chainId: EthereumQuantity,
	httpsRpc: funtypes.String,
})

export const CodeMessageError = funtypes.Intersect(
	funtypes.ReadonlyObject({
		code: funtypes.Number,
		message: funtypes.String,
	}),
	funtypes.ReadonlyPartial({
		data: funtypes.String
	})
)
