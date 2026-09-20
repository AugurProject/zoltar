import { executorArtifact } from '#contracts/artifacts.generated'
import { getCreate2Address } from '@zoltar/bot-shared/ethereum'

export const canonicalExecutorSalt = '0x0000000000000000000000000000000000000000000000000000000000000000'
export const deterministicDeploymentProxy = '0x4e59b44847b379578588920cA78FbF26c0B4956C'

export function canonicalExecutorIdentity() {
	return { address: getCreate2Address({ from: deterministicDeploymentProxy, salt: canonicalExecutorSalt, bytecode: `0x${executorArtifact.evm.bytecode.object}` }) }
}
