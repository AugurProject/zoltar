import { expect, test } from 'bun:test'
import { getDeploymentStepAddresses, getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { PROXY_DEPLOYER_ADDRESS } from '../../testSupport/simulator/utils/constants'

test('Statoblast status oracle starts with the production Zoltar deployment steps', () => {
	const addresses = getInfraContractAddresses()
	expect(getDeploymentStepAddresses().slice(0, 4)).toEqual([addressString(PROXY_DEPLOYER_ADDRESS), addresses.multicall3, addresses.zoltarQuestionData, addresses.zoltar])
})
