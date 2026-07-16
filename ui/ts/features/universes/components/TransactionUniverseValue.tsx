import * as commonCopy from '../../../copy/common.js'
import { formatUniverseLabel } from '../lib/universe.js'

type TransactionUniverseValueProps = {
	universeId: bigint | undefined
}

export function TransactionUniverseValue({ universeId }: TransactionUniverseValueProps) {
	return <>{universeId === undefined ? commonCopy.unavailable : formatUniverseLabel(universeId)}</>
}
