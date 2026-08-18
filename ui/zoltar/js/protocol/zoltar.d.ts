import type { MarketDetails, MarketDetailsPage, MarketType, QuestionData, ReadClient, WriteClient, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js';
export declare function loadMarketDetails(client: ReadClient, questionId: bigint): Promise<MarketDetails>;
export declare function loadAllZoltarQuestions(client: ReadClient): Promise<MarketDetails[]>;
export declare function loadZoltarQuestionCount(client: ReadClient): Promise<bigint>;
export declare function loadZoltarQuestionPage(client: ReadClient, pageIndex: number, pageSize: number): Promise<MarketDetailsPage>;
export declare function loadZoltarUniverseSummary(client: ReadClient, universeId: bigint): Promise<ZoltarUniverseSummary | undefined>;
export declare function createMarket(client: WriteClient, parameters: {
    marketType: MarketType;
    outcomeLabels: string[];
    questionData: QuestionData;
}): Promise<{
    questionId: string;
    createQuestionHash: `0x${string}`;
    marketType: MarketType;
}>;
//# sourceMappingURL=zoltar.d.ts.map