import type { TruthAuctionDepthPoint } from '../lib/truthAuctionBook.js';
type TruthAuctionDepthChartProps = {
    clearingTick?: bigint;
    onSelectTick: (tick: bigint) => void;
    points: TruthAuctionDepthPoint[];
};
export declare function TruthAuctionDepthChart({ clearingTick, onSelectTick, points }: TruthAuctionDepthChartProps): import("preact").JSX.Element | null;
export {};
//# sourceMappingURL=TruthAuctionDepthChart.d.ts.map