import * as deploymentCopy from '../copy/deployment.js'
import {
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed,
	statoblast_QuestionForker_QuestionForker,
	statoblast_QuestionLedger_QuestionLedger,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
	statoblast_openOracle_OpenOracle_OpenOracle,
	statoblast_tokens_ShareToken_ShareToken,
} from '../contractArtifact.js'
import { ZoltarQuestionData_ZoltarQuestionData, Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { installAppContractLabelResolver } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { questionDataContract, universeContract } from '../copy/app.js'

const CONTRACT_LABEL_BY_ABI = new Map<readonly unknown[], string>([
	[ZoltarQuestionData_ZoltarQuestionData.abi, questionDataContract],
	[Zoltar_Zoltar.abi, universeContract],
	[statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed.abi, deploymentCopy.priceFeed],
	[statoblast_QuestionForker_QuestionForker.abi, deploymentCopy.forkContract],
	[statoblast_QuestionLedger_QuestionLedger.abi, deploymentCopy.questionContract],
	[statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi, deploymentCopy.poolDeploymentContract],
	[statoblast_openOracle_OpenOracle_OpenOracle.abi, 'OpenOracle'],
	[statoblast_tokens_ShareToken_ShareToken.abi, deploymentCopy.shareToken],
])

export function installStatoblastContractLabels() {
	installAppContractLabelResolver(abi => CONTRACT_LABEL_BY_ABI.get(abi))
}
