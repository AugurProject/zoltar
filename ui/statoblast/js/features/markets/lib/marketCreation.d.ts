import type { MarketFormState, SecurityPoolFormState } from '../../../types/app.js';
import type { QuestionData } from '@zoltar/ui-core-shared/types/contracts.js';
type MarketFormField = keyof Pick<MarketFormState, 'categoricalOutcomes' | 'endTime' | 'scalarIncrement' | 'scalarMax' | 'scalarMin' | 'startTime' | 'title'>;
type MarketFormValidation = {
    fieldErrors: Partial<Record<MarketFormField, string>>;
    isValid: boolean;
    notice: string | undefined;
};
export declare function getMarketCreationOutcomeLabels(form: MarketFormState): string[];
export declare function hasMarketEndTimePassed(form: MarketFormState, currentTimestamp: bigint | undefined): boolean;
export declare function validateMarketForm(form: MarketFormState): MarketFormValidation;
export declare function createMarketParameters(form: MarketFormState): {
    marketType: import("@zoltar/ui-core-shared/types/contracts.js").MarketType;
    outcomeLabels: string[];
    questionData: QuestionData;
};
export declare function createSecurityPoolParameters(form: SecurityPoolFormState): {
    initialReportPriorityFeeAttoEthPerGas: bigint;
    questionId: bigint;
    statoblastSecurityMultiplierBps: bigint;
};
export {};
//# sourceMappingURL=marketCreation.d.ts.map