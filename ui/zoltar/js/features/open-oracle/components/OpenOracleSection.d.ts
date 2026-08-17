import { type OpenOracleDisputeSubmissionDetails, type OpenOracleSelectedReportActionMode } from '../lib/openOracle.js';
import type { OpenOracleFormState } from '../../../types/app.js';
import type { OpenOracleReportDetails } from '@zoltar/ui-core-shared/types/contracts.js';
import type { OpenOracleSectionProps } from '../../types.js';
export declare function renderSelectedReportActionSection({ actionMode, disputeSubmission, isConnected, isOnActiveAppChain, onApproveToken1, onApproveToken2, onDisputeReport, onOpenOracleFormChange, onSettleReport, openOracleActiveAction, openOracleForm, openOracleTokenAccessState, openOracleReportDetails, token1Symbol, token2Symbol, }: {
    actionMode: Exclude<OpenOracleSelectedReportActionMode, 'read-only'>;
    disputeSubmission: OpenOracleDisputeSubmissionDetails | undefined;
    isConnected: boolean;
    isOnActiveAppChain: boolean;
    onApproveToken1: (amount?: bigint) => void;
    onApproveToken2: (amount?: bigint) => void;
    onDisputeReport: () => void;
    onOpenOracleFormChange: (update: Partial<OpenOracleFormState>) => void;
    onSettleReport: () => void;
    openOracleActiveAction: OpenOracleSectionProps['openOracleActiveAction'];
    openOracleForm: OpenOracleFormState;
    openOracleTokenAccessState: OpenOracleSectionProps['openOracleTokenAccessState'];
    openOracleReportDetails?: OpenOracleReportDetails;
    token1Symbol: string;
    token2Symbol: string;
}): import("preact").JSX.Element;
export declare function OpenOracleSection({ activeView, accountState, environmentReady, environmentRefreshKey, loadBrowseReports, onApproveToken1, onApproveToken2, onCancelOpenOracleWithdrawalBalanceCheck, onCreateOpenOracleGame, onDisputeReport, onLoadOracleReport, onOpenOracleCreateFormChange, onOpenOracleFormChange, onSettleReport, onWithdrawOpenOracleBalance, loadingOpenOracleCreate, openOracleActiveAction, openOracleActiveWithdrawalBalance, openOracleCreateForm, openOracleCreateFieldErrors, openOracleDisputeSubmission, openOracleError, openOracleForm, openOracleReportLookupState, openOracleWithdrawalBalanceChecking, openOracleWithdrawalReviewMessage, openOracleTokenAccessState, openOracleReportDetails, openOracleResult, openOracleWithdrawableBalances, openOracleWithdrawableBalancesError, openOracleWithdrawableBalancesLoading, onActiveViewChange, }: OpenOracleSectionProps): import("preact").JSX.Element;
//# sourceMappingURL=OpenOracleSection.d.ts.map