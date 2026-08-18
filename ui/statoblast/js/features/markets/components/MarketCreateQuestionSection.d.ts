import type { Address } from '@zoltar/shared/ethereum';
import type { MarketFormState } from '../../../types/app.js';
import type { MarketCreationResult, MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js';
type MarketCreateQuestionSectionProps = {
    accountAddress: Address | undefined;
    hasForked: boolean;
    isOnActiveAppChain: boolean;
    marketCreating: boolean;
    marketError: string | undefined;
    marketForm: MarketFormState;
    marketResult: MarketCreationResult | undefined;
    loadingZoltarQuestions: boolean;
    onCreateMarket: () => void;
    onMarketFormChange: (update: Partial<MarketFormState>) => void;
    onOpenForkTab: () => void;
    onResetMarket: () => void;
    onUseQuestionForFork: (questionId: string) => void;
    onUseQuestionForPool: (questionId: string) => void;
    zoltarQuestions: MarketDetails[];
};
export declare function MarketCreateQuestionSection({ accountAddress, hasForked, isOnActiveAppChain, loadingZoltarQuestions, marketCreating, marketError, marketForm, marketResult, onCreateMarket, onMarketFormChange, onOpenForkTab, onResetMarket, onUseQuestionForFork, onUseQuestionForPool, zoltarQuestions, }: MarketCreateQuestionSectionProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=MarketCreateQuestionSection.d.ts.map