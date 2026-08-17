export function deriveHasForkActivity(source) {
    return source.systemState !== 'operational' || source.truthAuctionStartedAt > 0n || source.migratedAttoRep > 0n || source.forkOutcome !== 'none';
}
//# sourceMappingURL=forkActivity.js.map