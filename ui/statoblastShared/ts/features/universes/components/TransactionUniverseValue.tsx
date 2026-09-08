import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { formatUniverseLabel } from '@zoltar/ui-zoltar-shared/features/universes/lib/universe.js'

type TransactionUniverseValueProps = {
	universeId: bigint | undefined
}

export function TransactionUniverseValue({ universeId }: TransactionUniverseValueProps) {
	return <>{universeId === undefined ? commonCopy.unavailable : formatUniverseLabel(universeId)}</>
}
