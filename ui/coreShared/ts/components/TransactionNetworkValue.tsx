import { getActiveNetworkProfile } from '../lib/activeEnvironment.js'
import { formatTransactionNetworkLabel } from '../wallet/networkProfile.js'

export function TransactionNetworkValue() {
	return <>{formatTransactionNetworkLabel(getActiveNetworkProfile())}</>
}
