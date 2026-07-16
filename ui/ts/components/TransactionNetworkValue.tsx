import { getActiveNetworkProfile } from '../lib/activeEnvironment.js'
import { formatTransactionNetworkLabel } from '../lib/networkProfile.js'

export function TransactionNetworkValue() {
	return <>{formatTransactionNetworkLabel(getActiveNetworkProfile())}</>
}
