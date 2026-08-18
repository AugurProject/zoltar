import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/lib/actionGuards.js';
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js';
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js';
import { tryParseBigIntListInput } from '@zoltar/ui-core-shared/lib/inputs.js';
import { tryParseTradingAmountInput } from '@zoltar/ui-core-shared/lib/formInputs.js';
import { getReportingOutcomeLabel } from '@zoltar/ui-zoltar/features/reporting/lib/reporting.js';
import { isValidScalarOutcomeIndex } from '@zoltar/ui-core-shared/lib/scalarOutcome.js';
const PRICE_PRECISION = 10n ** 18n;
const PERCENT_MULTIPLIER = 100n;
const BPS_DENOMINATOR = 10000n;
export const MARKET_NOT_FINALIZED_MESSAGE = 'This market has not finalized.';
export const SHARE_MIGRATION_AFTER_FORK_MESSAGE = 'Share migration is only available after this universe has forked.';
export const NO_MINT_CAPACITY_NO_ACTIVE_CAPACITY_OWNERSHIP_MESSAGE = 'No mint capacity. No active capacity ownership.';
export const NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE = 'Need matching Invalid, Yes, and No shares to redeem complete sets.';
export const UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE = 'Minting is unavailable because this pool has complete-set shares but no collateral.';
const HIDDEN_TRADING_GUARD_MESSAGES = [NO_MINT_CAPACITY_NO_ACTIVE_CAPACITY_OWNERSHIP_MESSAGE, NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE];
export function hasUndefinedCompleteSetExchangeRate(settlementCollateralAttoEth, shareTokenSupplyAttoShares) {
    if (settlementCollateralAttoEth === undefined || shareTokenSupplyAttoShares === undefined)
        return undefined;
    return settlementCollateralAttoEth === 0n && shareTokenSupplyAttoShares !== 0n;
}
export function calculateMintingCapacityAttoEth(capacityOwnershipAttoRep, repPerEthPrice, statoblastSecurityMultiplierBps) {
    if (capacityOwnershipAttoRep === undefined || repPerEthPrice === undefined || statoblastSecurityMultiplierBps === undefined || repPerEthPrice === 0n || statoblastSecurityMultiplierBps === 0n)
        return undefined;
    if (capacityOwnershipAttoRep === 0n)
        return 0n;
    const capacityValueAttoEth = (capacityOwnershipAttoRep * PRICE_PRECISION) / repPerEthPrice;
    return (capacityValueAttoEth * BPS_DENOMINATOR) / statoblastSecurityMultiplierBps;
}
export function getRemainingMintCapacity(mintingCapacityAttoEth, settlementCollateralAttoEth, shareTokenSupplyAttoShares) {
    if (mintingCapacityAttoEth === undefined || settlementCollateralAttoEth === undefined)
        return undefined;
    if (hasUndefinedCompleteSetExchangeRate(settlementCollateralAttoEth, shareTokenSupplyAttoShares) === true)
        return 0n;
    return mintingCapacityAttoEth > settlementCollateralAttoEth ? mintingCapacityAttoEth - settlementCollateralAttoEth : 0n;
}
export function getMaximumMintAmount(walletEthBalanceAttoEth, remainingMintCapacityAttoEth) {
    if (walletEthBalanceAttoEth === undefined || remainingMintCapacityAttoEth === undefined)
        return undefined;
    return walletEthBalanceAttoEth < remainingMintCapacityAttoEth ? walletEthBalanceAttoEth : remainingMintCapacityAttoEth;
}
function rpow(value, exponent, baseUnit) {
    let result = exponent % 2n !== 0n ? value : baseUnit;
    let squaredValue = value;
    for (let remainingExponent = exponent / 2n; remainingExponent !== 0n; remainingExponent /= 2n) {
        squaredValue = (squaredValue * squaredValue) / baseUnit;
        if (remainingExponent % 2n !== 0n)
            result = (result * squaredValue) / baseUnit;
    }
    return result;
}
export function estimateMintCheckpoint({ currentRetentionRate, currentTimestamp, feeEligibleCapacityOwnershipAttoRep, feeEndTimestamp, feeIndexRemainder, lastUpdatedFeeAccumulator, settlementCollateralAttoEth, totalFeesOwedRemainder, }) {
    if (currentRetentionRate === undefined ||
        currentTimestamp === undefined ||
        feeEligibleCapacityOwnershipAttoRep === undefined ||
        feeEndTimestamp === undefined ||
        feeIndexRemainder === undefined ||
        lastUpdatedFeeAccumulator === undefined ||
        settlementCollateralAttoEth === undefined ||
        totalFeesOwedRemainder === undefined)
        return undefined;
    const checkpointTimestamp = currentTimestamp < feeEndTimestamp ? currentTimestamp : feeEndTimestamp;
    if (lastUpdatedFeeAccumulator >= checkpointTimestamp || feeEligibleCapacityOwnershipAttoRep === 0n)
        return { estimatedRetentionFeeAttoEth: 0n, settlementCollateralAfterFeesAttoEth: settlementCollateralAttoEth };
    const timeDelta = checkpointTimestamp - lastUpdatedFeeAccumulator;
    const retainedCollateralAttoEth = (settlementCollateralAttoEth * rpow(currentRetentionRate, timeDelta, PRICE_PRECISION)) / PRICE_PRECISION;
    const scaledFeeDelta = (settlementCollateralAttoEth - retainedCollateralAttoEth) * PRICE_PRECISION + feeIndexRemainder;
    const feeIndexDelta = scaledFeeDelta / feeEligibleCapacityOwnershipAttoRep;
    const feesOwedDelta = feeIndexDelta * feeEligibleCapacityOwnershipAttoRep + totalFeesOwedRemainder;
    const estimatedRetentionFeeAttoEth = feesOwedDelta / PRICE_PRECISION;
    return {
        estimatedRetentionFeeAttoEth,
        settlementCollateralAfterFeesAttoEth: settlementCollateralAttoEth - estimatedRetentionFeeAttoEth,
    };
}
function getCollateralizationPercent(qualifyingRepBackingAttoRep, capacityOwnershipAttoRep, repPerEthPrice) {
    if (qualifyingRepBackingAttoRep === undefined || capacityOwnershipAttoRep === undefined || repPerEthPrice === undefined || repPerEthPrice === 0n || capacityOwnershipAttoRep === 0n)
        return undefined;
    return (qualifyingRepBackingAttoRep * PERCENT_MULTIPLIER * PRICE_PRECISION * PRICE_PRECISION) / (capacityOwnershipAttoRep * repPerEthPrice);
}
export function getPoolCollateralizationPercent(totalPoolHeldAttoRep, totalCapacityOwnershipAttoRep, repPerEthPrice) {
    return getCollateralizationPercent(totalPoolHeldAttoRep, totalCapacityOwnershipAttoRep, repPerEthPrice);
}
export function getVaultCollateralizationPercent(vaultAttoRepBacking, capacityOwnershipAttoRep, repPerEthPrice) {
    return getCollateralizationPercent(vaultAttoRepBacking, capacityOwnershipAttoRep, repPerEthPrice);
}
export function getCollateralizationTone(collateralizationPercent, statoblastSecurityMultiplierBps) {
    if (collateralizationPercent === undefined || statoblastSecurityMultiplierBps === undefined)
        return undefined;
    return collateralizationPercent < getStatoblastCollateralizationTargetPercent(statoblastSecurityMultiplierBps) ? 'danger' : 'success';
}
function getStatoblastCollateralizationTargetPercent(statoblastSecurityMultiplierBps) {
    return (statoblastSecurityMultiplierBps * PERCENT_MULTIPLIER * PRICE_PRECISION) / BPS_DENOMINATOR;
}
export function formatStatoblastSecurityMultiplier(statoblastSecurityMultiplierBps) {
    const whole = statoblastSecurityMultiplierBps / BPS_DENOMINATOR;
    const fractional = (statoblastSecurityMultiplierBps % BPS_DENOMINATOR).toString().padStart(4, '0').replace(/0+$/, '');
    return fractional === '' ? whole.toString() : `${whole}.${fractional}`;
}
export function getCollateralizationDisplayState(capacityOwnershipAttoRep, collateralizationPercent) {
    if (capacityOwnershipAttoRep === 0n)
        return 'noActiveCapacityOwnership';
    return collateralizationPercent === undefined ? 'unavailable' : 'value';
}
export function hasRepBackedPoolWithNoActiveCapacityOwnership(totalPoolHeldAttoRep, feeEligibleCapacityOwnershipAttoRep) {
    return (totalPoolHeldAttoRep ?? 0n) > 0n && (feeEligibleCapacityOwnershipAttoRep ?? 0n) === 0n;
}
export function getMaxRedeemableCompleteSets(shareBalances) {
    if (shareBalances === undefined)
        return undefined;
    if (shareBalances.invalidAttoShares <= shareBalances.yesAttoShares && shareBalances.invalidAttoShares <= shareBalances.noAttoShares)
        return shareBalances.invalidAttoShares;
    if (shareBalances.yesAttoShares <= shareBalances.invalidAttoShares && shareBalances.yesAttoShares <= shareBalances.noAttoShares)
        return shareBalances.yesAttoShares;
    return shareBalances.noAttoShares;
}
function formatCompleteSetAmount(value) {
    const formattedValue = formatCurrencyBalance(value);
    return `${formattedValue} complete ${formattedValue === '1' ? 'set' : 'sets'}`;
}
function divideRoundedUp(numerator, denominator) {
    if (denominator <= 0n)
        throw new RangeError('Denominator must be greater than zero');
    return (numerator + denominator - 1n) / denominator;
}
export function convertAttoSharesToSettlementCollateralAttoEth(amountAttoShares, settlementCollateralAttoEth, shareTokenSupplyAttoShares) {
    if (amountAttoShares === undefined)
        return undefined;
    if (settlementCollateralAttoEth === undefined || shareTokenSupplyAttoShares === undefined)
        return amountAttoShares;
    if (shareTokenSupplyAttoShares === 0n)
        return amountAttoShares;
    return (amountAttoShares * settlementCollateralAttoEth) / shareTokenSupplyAttoShares;
}
export function convertSettlementCollateralAttoEthToAttoShares(amountAttoEth, settlementCollateralAttoEth, shareTokenSupplyAttoShares) {
    if (settlementCollateralAttoEth === undefined || shareTokenSupplyAttoShares === undefined)
        return amountAttoEth;
    if (settlementCollateralAttoEth === 0n) {
        if (shareTokenSupplyAttoShares !== 0n)
            return undefined;
        return amountAttoEth;
    }
    return divideRoundedUp(amountAttoEth * shareTokenSupplyAttoShares, settlementCollateralAttoEth);
}
export function convertMintSettlementCollateralAttoEthToAttoShares(amountAttoEth, settlementCollateralAttoEth, shareTokenSupplyAttoShares) {
    if (settlementCollateralAttoEth === undefined || shareTokenSupplyAttoShares === undefined)
        return amountAttoEth;
    if (shareTokenSupplyAttoShares === 0n)
        return settlementCollateralAttoEth === 0n ? amountAttoEth * PRICE_PRECISION : undefined;
    if (settlementCollateralAttoEth === 0n)
        return undefined;
    return (amountAttoEth * shareTokenSupplyAttoShares) / settlementCollateralAttoEth;
}
export function getSelectedOutcomeShareBalance(shareBalances, outcome) {
    if (shareBalances === undefined)
        return undefined;
    switch (outcome) {
        case 'invalid':
            return shareBalances.invalidAttoShares;
        case 'yes':
            return shareBalances.yesAttoShares;
        case 'no':
            return shareBalances.noAttoShares;
        default:
            return assertNever(outcome);
    }
}
export function getTradingGuardDisplayMessage(message) {
    if (message === undefined)
        return undefined;
    for (const hiddenMessage of HIDDEN_TRADING_GUARD_MESSAGES) {
        if (message === hiddenMessage)
            return undefined;
    }
    return message;
}
function areShareMigrationTargetOutcomeIndexesValid(tradingForkUniverse, targetOutcomeIndexes) {
    const forkQuestionDetails = tradingForkUniverse.forkQuestionDetails;
    if (forkQuestionDetails === undefined)
        return false;
    if (forkQuestionDetails.marketType === 'scalar') {
        const scalarQuestion = forkQuestionDetails;
        return targetOutcomeIndexes.every(outcomeIndex => isValidScalarOutcomeIndex(scalarQuestion, outcomeIndex));
    }
    const availableOutcomeIndexSet = new Set(tradingForkUniverse.childUniverses.map(child => child.outcomeIndex.toString()));
    return targetOutcomeIndexes.every(outcomeIndex => availableOutcomeIndexSet.has(outcomeIndex.toString()));
}
export function getDefaultShareMigrationTargetOutcomeIndexes(tradingForkUniverse) {
    if (tradingForkUniverse === undefined || !tradingForkUniverse.hasForked)
        return '';
    if (tradingForkUniverse.forkQuestionDetails?.marketType === 'scalar')
        return '';
    return tradingForkUniverse.childUniverses.map(child => child.outcomeIndex.toString()).join(', ');
}
export function isTradingSystemDeployed(deploymentStatuses) {
    return deploymentStatuses.length > 0 && deploymentStatuses.every(step => step.deployed);
}
export function getTradingMintGuardMessage({ accountAddress, settlementCollateralAttoEth, ethBalanceAttoEth, mintingCapacityAttoEth, hasSelectedPool, isOnActiveAppChain, isPriceValid, mintAmountInput, shareTokenSupplyAttoShares, totalPoolHeldAttoRep, }) {
    if (!hasSelectedPool)
        return 'Select a pool before minting.';
    const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: 'Connect a wallet before minting complete sets.' });
    if (walletGuardState.blocked)
        return walletGuardState.reason;
    if (isPriceValid === false)
        return 'Refresh the REP price before minting.';
    const undefinedExchangeRate = hasUndefinedCompleteSetExchangeRate(settlementCollateralAttoEth, shareTokenSupplyAttoShares);
    if (undefinedExchangeRate === undefined)
        return 'Loading mint capacity.';
    if (undefinedExchangeRate)
        return UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE;
    const remainingCapacity = getRemainingMintCapacity(mintingCapacityAttoEth, settlementCollateralAttoEth, shareTokenSupplyAttoShares);
    if (remainingCapacity === undefined)
        return 'Loading mint capacity.';
    if (remainingCapacity === 0n) {
        if ((totalPoolHeldAttoRep ?? 0n) > 0n && mintingCapacityAttoEth === 0n)
            return NO_MINT_CAPACITY_NO_ACTIVE_CAPACITY_OWNERSHIP_MESSAGE;
        return 'No mint capacity remaining.';
    }
    const trimmedAmount = mintAmountInput.trim();
    if (trimmedAmount === '')
        return 'Enter a mint amount greater than zero.';
    const mintAmount = tryParseTradingAmountInput(trimmedAmount);
    if (mintAmount === undefined)
        return 'Enter a valid mint amount.';
    if (mintAmount <= 0n)
        return 'Enter a mint amount greater than zero.';
    if (mintAmount > remainingCapacity)
        return `Max mint capacity is ${formatCurrencyBalance(remainingCapacity)} ETH.`;
    if (ethBalanceAttoEth === undefined)
        return 'Loading wallet ETH balance.';
    if (mintAmount > ethBalanceAttoEth)
        return `Need ${formatCurrencyBalance(mintAmount - ethBalanceAttoEth)} more ETH in this wallet to mint the selected amount.`;
    return undefined;
}
export function getTradingRedeemCompleteSetGuardMessage({ accountAddress, settlementCollateralAttoEth, hasSelectedPool, isOnActiveAppChain, loadingTradingDetails, redeemAmountInput, shareBalances, shareTokenSupplyAttoShares, }) {
    if (!hasSelectedPool)
        return 'Select a pool before redeeming complete sets.';
    const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: 'Connect a wallet before redeeming complete sets.' });
    if (walletGuardState.blocked)
        return walletGuardState.reason;
    if (loadingTradingDetails)
        return 'Loading wallet share balances.';
    const maxRedeemableCompleteSetsAttoShares = getMaxRedeemableCompleteSets(shareBalances);
    if (maxRedeemableCompleteSetsAttoShares === undefined)
        return 'Loading wallet share balances.';
    if (maxRedeemableCompleteSetsAttoShares === 0n)
        return NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE;
    const trimmedAmount = redeemAmountInput.trim();
    if (trimmedAmount === '')
        return 'Enter a redeem amount greater than zero.';
    const redeemAmount = tryParseTradingAmountInput(trimmedAmount);
    if (redeemAmount === undefined)
        return 'Enter a valid redeem amount.';
    if (redeemAmount <= 0n)
        return 'Enter a redeem amount greater than zero.';
    const redeemAmountAttoShares = convertSettlementCollateralAttoEthToAttoShares(redeemAmount, settlementCollateralAttoEth, shareTokenSupplyAttoShares);
    if (redeemAmountAttoShares === undefined)
        return 'Redeeming is unavailable because this pool has complete-set shares but no collateral.';
    if (redeemAmountAttoShares > maxRedeemableCompleteSetsAttoShares) {
        const maximumRedeemableAmountAttoEth = convertAttoSharesToSettlementCollateralAttoEth(maxRedeemableCompleteSetsAttoShares, settlementCollateralAttoEth, shareTokenSupplyAttoShares);
        return `Max redeemable amount is ${formatCompleteSetAmount(maximumRedeemableAmountAttoEth)}.`;
    }
    return undefined;
}
export function getTradingMigrateSharesGuardMessage({ accountAddress, hasSelectedPool, isOnActiveAppChain, loadingTradingForkUniverse, loadingTradingDetails, selectedShareOutcome, shareBalances, targetOutcomeIndexesInput, tradingForkUniverse, }) {
    if (!hasSelectedPool)
        return 'Select a pool before migrating shares.';
    const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: 'Connect a wallet before migrating shares.' });
    if (walletGuardState.blocked)
        return walletGuardState.reason;
    if (loadingTradingForkUniverse)
        return 'Loading fork target universes.';
    if (tradingForkUniverse === undefined || !tradingForkUniverse.hasForked)
        return 'Refresh the fork target universes.';
    const targetOutcomeIndexes = tryParseBigIntListInput(targetOutcomeIndexesInput);
    if (targetOutcomeIndexes === undefined)
        return targetOutcomeIndexesInput.trim() === '' ? 'Select at least one target child universe.' : 'Select valid target child universes.';
    if (new Set(targetOutcomeIndexes.map(outcomeIndex => outcomeIndex.toString())).size !== targetOutcomeIndexes.length)
        return 'Select each target child universe only once.';
    if (!areShareMigrationTargetOutcomeIndexesValid(tradingForkUniverse, targetOutcomeIndexes))
        return 'Select valid target child universes.';
    if (loadingTradingDetails)
        return 'Loading wallet share balances.';
    const selectedOutcomeBalance = getSelectedOutcomeShareBalance(shareBalances, selectedShareOutcome);
    if (selectedOutcomeBalance === undefined)
        return 'Loading wallet share balances.';
    if (selectedOutcomeBalance === 0n)
        return `No ${getReportingOutcomeLabel(selectedShareOutcome)} shares available to migrate.`;
    return undefined;
}
export function getTradingRedeemSharesGuardMessage({ accountAddress, hasSelectedPool, isOnActiveAppChain }) {
    if (!hasSelectedPool)
        return 'Select a pool before redeeming shares.';
    const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: 'Connect a wallet before redeeming shares.' });
    if (walletGuardState.blocked)
        return walletGuardState.reason;
    return undefined;
}
//# sourceMappingURL=trading.js.map