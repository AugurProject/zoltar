import type { ComponentChildren } from 'preact';
import type { ActionAvailability } from '../../types.js';
import type { ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js';
type ChildUniverseAction = {
    availability?: ActionAvailability;
    label: string;
    onClick: () => void;
    pending?: boolean;
    pendingLabel?: string;
    showDisabledReason?: boolean;
    tone?: 'primary' | 'secondary';
};
type ChildUniversesSectionProps = {
    action?: (child: ZoltarChildUniverseSummary) => ChildUniverseAction;
    childUniverses: ZoltarChildUniverseSummary[];
    emptyMessage: string;
    headerSubtitle?: ComponentChildren;
    headerTitle: ComponentChildren;
    renderBody: (child: ZoltarChildUniverseSummary) => ComponentChildren;
    renderBadge?: (child: ZoltarChildUniverseSummary) => ComponentChildren;
    renderTitle?: (child: ZoltarChildUniverseSummary) => ComponentChildren;
    surface: 'card' | 'flat';
};
export declare function ChildUniverseStatusBadge({ child }: {
    child: ZoltarChildUniverseSummary;
}): import("preact").JSX.Element;
export declare function ChildUniversesSection({ action, childUniverses, emptyMessage, headerSubtitle, headerTitle, renderBody, renderBadge, renderTitle, surface }: ChildUniversesSectionProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=ChildUniversesSection.d.ts.map