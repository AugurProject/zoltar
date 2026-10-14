import { createZoltarChildUniverse } from '../../../protocol/zoltarForks.js'
import { loadAllZoltarQuestions, loadMarketDetails, loadZoltarQuestionCount, loadZoltarQuestionPage, loadZoltarUniverseSummary } from '../../../protocol/zoltar.js'

import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'

export type UseZoltarUniverseDependencies = {
	createConnectedReadClient: typeof createConnectedReadClient
	createWalletWriteClient: typeof createWalletWriteClient
	createZoltarChildUniverse: typeof createZoltarChildUniverse
	loadAllZoltarQuestions: typeof loadAllZoltarQuestions
	loadMarketDetails: typeof loadMarketDetails
	loadZoltarQuestionCount: typeof loadZoltarQuestionCount
	loadZoltarQuestionPage: typeof loadZoltarQuestionPage
	loadZoltarUniverseSummary: typeof loadZoltarUniverseSummary
}

export const defaultUseZoltarUniverseDependencies: UseZoltarUniverseDependencies = {
	createConnectedReadClient,
	createWalletWriteClient,
	createZoltarChildUniverse,
	loadAllZoltarQuestions,
	loadMarketDetails,
	loadZoltarQuestionCount,
	loadZoltarQuestionPage,
	loadZoltarUniverseSummary,
}
