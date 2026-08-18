import type { ListedSecurityPool, MarketDetailsPage } from '@zoltar/ui-core-shared/types/contracts.js';
type MarketQuestionsSectionProps = {
    environmentRefreshKey: number;
    hasForked: boolean;
    hasLoadedSecurityPools: boolean;
    loadingSecurityPools: boolean;
    loadingZoltarQuestionCount: boolean;
    loadingZoltarQuestions: boolean;
    onCreateQuestion: () => void;
    onLoadZoltarQuestions: () => Promise<void>;
    onLoadZoltarQuestionPage: (pageIndex: number, pageSize: number) => Promise<void>;
    onLoadSecurityPools: () => void;
    onOpenForkTab: () => void;
    onUseQuestionForFork: (questionId: string) => void;
    onUseQuestionForPool: (questionId: string) => void;
    securityPools: ListedSecurityPool[];
    securityPoolsLoadError: string | undefined;
    zoltarQuestionCount: bigint | undefined;
    zoltarQuestionPage: MarketDetailsPage | undefined;
    zoltarQuestionsError: string | undefined;
};
export declare function MarketQuestionsSection({ environmentRefreshKey, hasForked, hasLoadedSecurityPools, loadingSecurityPools, loadingZoltarQuestionCount, loadingZoltarQuestions, onCreateQuestion, onLoadSecurityPools, onLoadZoltarQuestions, onLoadZoltarQuestionPage, onOpenForkTab, onUseQuestionForFork, onUseQuestionForPool, securityPools, securityPoolsLoadError, zoltarQuestionCount, zoltarQuestionPage, zoltarQuestionsError, }: MarketQuestionsSectionProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=MarketQuestionsSection.d.ts.map