// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ExecutionBlockHeaderProof } from './ExecutionBlockHeaderProof.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

contract OpenOraclePriceCandidateVerifier {
	uint256 private constant BPS_DENOMINATOR = 10_000;

	struct Candidate {
		uint128 amount1;
		uint128 amount2;
		uint48 reportTimestamp;
		uint48 settlementTimestamp;
		uint48 lastReportBlock;
		uint48 settlementTime;
	}

	struct Configuration {
		uint256 disputeDelay;
		uint256 opportunityBlockCount;
		uint256 gasUnitsForOneDispute;
		uint256 targetPriceError;
		uint256 protocolFee;
		uint256 reporterFee;
		uint256 percentagePrecision;
		uint256 securityMultiplierBps;
		uint256 minimumTotalGasPriceWei;
		uint256 minimumPriorityFeeWei;
		uint256 absoluteInclusionPremiumWei;
	}

	function verify(
		Candidate memory candidate,
		Configuration memory configuration,
		bytes[] calldata opportunityHeaders,
		bytes calldata firstClosedHeader
	)
		public
		view
		returns (uint256 availableWeth, uint256 availableRep, uint256 maximumRequiredProfit, bool sufficient)
	{
		require(
			opportunityHeaders.length == configuration.opportunityBlockCount,
			'Incorrect economic opportunity header count'
		);
		uint256 deadline = uint256(candidate.reportTimestamp) + uint256(candidate.settlementTime);
		uint256 earliestDisputeTime = uint256(candidate.reportTimestamp) + configuration.disputeDelay;
		uint256 previousBlockNumber;
		bool everyBlockHadDisputeCapacity = true;
		for (uint256 index = 0; index < opportunityHeaders.length; index++) {
			ExecutionBlockHeaderProof.Header memory header = ExecutionBlockHeaderProof.parseAndVerify(
				opportunityHeaders[index]
			);
			require(header.number >= candidate.lastReportBlock, 'Opportunity header predates the final report');
			require(
				header.timestamp >= earliestDisputeTime && header.timestamp < deadline,
				'Header is outside the dispute opportunity window'
			);
			if (index != 0)
				require(header.number == previousBlockNumber + 1, 'Opportunity headers are not consecutive');
			previousBlockNumber = header.number;
			require(header.gasUsed <= header.gasLimit, 'Opportunity header gas usage is invalid');
			if (header.gasLimit - header.gasUsed < configuration.gasUnitsForOneDispute) {
				everyBlockHadDisputeCapacity = false;
			}
			uint256 requiredProfit = _requiredCorrectionProfit(header.baseFee, configuration);
			if (requiredProfit > maximumRequiredProfit) maximumRequiredProfit = requiredProfit;
		}
		ExecutionBlockHeaderProof.Header memory closedHeader = ExecutionBlockHeaderProof.parseAndVerify(
			firstClosedHeader
		);
		require(closedHeader.number == previousBlockNumber + 1, 'Closed header does not follow opportunity headers');
		require(closedHeader.timestamp >= deadline, 'Closed header was still open to disputes');
		require(
			closedHeader.timestamp <= candidate.settlementTimestamp,
			'Closed header is after the settlement timestamp'
		);
		availableWeth = _availableCorrectionProfit(candidate.amount1, configuration);
		availableRep = _availableCorrectionProfit(candidate.amount2, configuration);
		sufficient = everyBlockHadDisputeCapacity && availableWeth >= maximumRequiredProfit;
	}

	function _requiredCorrectionProfit(
		uint256 baseFee,
		Configuration memory configuration
	) private pure returns (uint256) {
		uint256 baseFeePlusPriority = baseFee + configuration.minimumPriorityFeeWei;
		uint256 modeledGasPrice =
			baseFeePlusPriority > configuration.minimumTotalGasPriceWei
				? baseFeePlusPriority
				: configuration.minimumTotalGasPriceWei;
		uint256 inclusionCost =
			modeledGasPrice * configuration.gasUnitsForOneDispute + configuration.absoluteInclusionPremiumWei;
		return Math.mulDiv(inclusionCost, configuration.securityMultiplierBps, BPS_DENOMINATOR, Math.Rounding.Ceil);
	}

	function _availableCorrectionProfit(
		uint256 reportAmount,
		Configuration memory configuration
	) private pure returns (uint256) {
		return
			Math.mulDiv(
				reportAmount,
				configuration.targetPriceError - configuration.protocolFee - configuration.reporterFee,
				configuration.percentagePrecision + configuration.targetPriceError
			);
	}
}
