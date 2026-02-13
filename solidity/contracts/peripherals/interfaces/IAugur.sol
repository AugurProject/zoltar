// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

enum TokenType {
	ReputationToken,
	DisputeCrowdsourcer,
	ParticipationToken
}

enum MarketType {
	YES_NO,
	CATEGORICAL,
	SCALAR
}

interface IAugur {
	function createChildUniverse(bytes32 _parentPayoutDistributionHash, uint256[] memory _parentPayoutNumerators) external returns (address);
	function isKnownUniverse(address _universe) external view returns (bool);
	function trustedCashTransfer(address _from, address _to, uint256 _amount) external returns (bool);
	function isTrustedSender(address _address) external view returns (bool);
	function onCategoricalMarketCreated(uint256 _endTime, string memory _extraInfo, address _market, address _marketCreator, address _designatedReporter, uint256 _feePerCashInAttoCash, bytes32[] memory _outcomes) external returns (bool);
	function onYesNoMarketCreated(uint256 _endTime, string memory _extraInfo, address _market, address _marketCreator, address _designatedReporter, uint256 _feePerCashInAttoCash) external returns (bool);
	function onScalarMarketCreated(uint256 _endTime, string memory _extraInfo, address _market, address _marketCreator, address _designatedReporter, uint256 _feePerCashInAttoCash, int256[] memory _prices, uint256 _numTicks)  external returns (bool);
	function logInitialReportSubmitted(address _universe, address _reporter, address _market, address _initialReporter, uint256 _amountStaked, bool _isDesignatedReporter, uint256[] memory _payoutNumerators, string memory _description, uint256 _nextWindowStartTime, uint256 _nextWindowEndTime) external returns (bool);
	function disputeCrowdsourcerCreated(address _universe, address _market, address _disputeCrowdsourcer, uint256[] memory _payoutNumerators, uint256 _size, uint256 _disputeRound) external returns (bool);
	function logDisputeCrowdsourcerContribution(address _universe, address _reporter, address _market, address _disputeCrowdsourcer, uint256 _amountStaked, string memory description, uint256[] memory _payoutNumerators, uint256 _currentStake, uint256 _stakeRemaining, uint256 _disputeRound) external returns (bool);
	function logDisputeCrowdsourcerCompleted(address _universe, address _market, address _disputeCrowdsourcer, uint256[] memory _payoutNumerators, uint256 _nextWindowStartTime, uint256 _nextWindowEndTime, bool _pacingOn, uint256 _totalRepStakedInPayout, uint256 _totalRepStakedInMarket, uint256 _disputeRound) external returns (bool);
	function logInitialReporterRedeemed(address _universe, address _reporter, address _market, uint256 _amountRedeemed, uint256 _repReceived, uint256[] memory _payoutNumerators) external returns (bool);
	function logDisputeCrowdsourcerRedeemed(address _universe, address _reporter, address _market, uint256 _amountRedeemed, uint256 _repReceived, uint256[] memory _payoutNumerators) external returns (bool);
	function logMarketFinalized(address _universe, uint256[] memory _winningPayoutNumerators) external returns (bool);
	function logMarketMigrated(address _market, address _originalUniverse) external returns (bool);
	function logReportingParticipantDisavowed(address _universe, address _market) external returns (bool);
	function logMarketParticipantsDisavowed(address _universe) external returns (bool);
	function logCompleteSetsPurchased(address _universe, address _market, address _account, uint256 _numCompleteSets) external returns (bool);
	function logCompleteSetsSold(address _universe, address _market, address _account, uint256 _numCompleteSets, uint256 _fees) external returns (bool);
	function logMarketOIChanged(address _universe, address _market) external returns (bool);
	function logTradingProceedsClaimed(address _universe, address _sender, address _market, uint256 _outcome, uint256 _numShares, uint256 _numPayoutTokens, uint256 _fees) external returns (bool);
	function logUniverseForked(address _forkingMarket) external returns (bool);
	function logReputationTokensTransferred(address _universe, address _from, address _to, uint256 _value, uint256 _fromBalance, uint256 _toBalance) external returns (bool);
	function logReputationTokensBurned(address _universe, address _target, uint256 _amount, uint256 _totalSupply, uint256 _balance) external returns (bool);
	function logReputationTokensMinted(address _universe, address _target, uint256 _amount, uint256 _totalSupply, uint256 _balance) external returns (bool);
	function logShareTokensBalanceChanged(address _account, address _market, uint256 _outcome, uint256 _balance) external returns (bool);
	function logDisputeCrowdsourcerTokensTransferred(address _universe, address _from, address _to, uint256 _value, uint256 _fromBalance, uint256 _toBalance) external returns (bool);
	function logDisputeCrowdsourcerTokensBurned(address _universe, address _target, uint256 _amount, uint256 _totalSupply, uint256 _balance) external returns (bool);
	function logDisputeCrowdsourcerTokensMinted(address _universe, address _target, uint256 _amount, uint256 _totalSupply, uint256 _balance) external returns (bool);
	function logDisputeWindowCreated(address _disputeWindow, uint256 _id, bool _initial) external returns (bool);
	function logParticipationTokensRedeemed(address universe, address _sender, uint256 _attoParticipationTokens, uint256 _feePayoutShare) external returns (bool);
	function logTimestampSet(uint256 _newTimestamp) external returns (bool);
	function logInitialReporterTransferred(address _universe, address _market, address _from, address _to) external returns (bool);
	function logMarketTransferred(address _universe, address _from, address _to) external returns (bool);
	function logParticipationTokensTransferred(address _universe, address _from, address _to, uint256 _value, uint256 _fromBalance, uint256 _toBalance) external returns (bool);
	function logParticipationTokensBurned(address _universe, address _target, uint256 _amount, uint256 _totalSupply, uint256 _balance) external returns (bool);
	function logParticipationTokensMinted(address _universe, address _target, uint256 _amount, uint256 _totalSupply, uint256 _balance) external returns (bool);
	function logMarketRepBondTransferred(address _universe, address _from, address _to) external returns (bool);
	function logWarpSyncDataUpdated(address _universe, uint256 _warpSyncHash, uint256 _marketEndTime) external returns (bool);
	function isKnownFeeSender(address _feeSender) external view returns (bool);
	function lookup(bytes32 _key) external view returns (address);
	function getTimestamp() external view returns (uint256);
	function getMaximumMarketEndDate() external view returns (uint256);
	function isKnownMarket(address _market) external view returns (bool);
	function derivePayoutDistributionHash(uint256[] memory _payoutNumerators, uint256 _numTicks, uint256 numOutcomes) external view returns (bytes32);
	function logValidityBondChanged(uint256 _validityBond) external returns (bool);
	function logDesignatedReportStakeChanged(uint256 _designatedReportStake) external returns (bool);
	function logNoShowBondChanged(uint256 _noShowBond) external returns (bool);
	function logReportingFeeChanged(uint256 _reportingFee) external returns (bool);
	function getUniverseForkIndex(address _universe) external view returns (uint256);

	event MarketCreated(address indexed universe, uint256 endTime, string extraInfo, address market, address indexed marketCreator, address designatedReporter, uint256 feePerCashInAttoCash, int256[] prices, MarketType marketType, uint256 numTicks, bytes32[] outcomes, uint256 noShowBond, uint256 timestamp);
	event InitialReportSubmitted(address indexed universe, address indexed reporter, address indexed market, address initialReporter, uint256 amountStaked, bool isDesignatedReporter, uint256[] payoutNumerators, string description, uint256 nextWindowStartTime, uint256 nextWindowEndTime, uint256 timestamp);
	event DisputeCrowdsourcerCreated(address indexed universe, address indexed market, address disputeCrowdsourcer, uint256[] payoutNumerators, uint256 size, uint256 disputeRound);
	event DisputeCrowdsourcerContribution(address indexed universe, address indexed reporter, address indexed market, address disputeCrowdsourcer, uint256 amountStaked, string description, uint256[] payoutNumerators, uint256 currentStake, uint256 stakeRemaining, uint256 disputeRound, uint256 timestamp);
	event DisputeCrowdsourcerCompleted(address indexed universe, address indexed market, address disputeCrowdsourcer, uint256[] payoutNumerators, uint256 nextWindowStartTime, uint256 nextWindowEndTime, bool pacingOn, uint256 totalRepStakedInPayout, uint256 totalRepStakedInMarket, uint256 disputeRound, uint256 timestamp);
	event InitialReporterRedeemed(address indexed universe, address indexed reporter, address indexed market, address initialReporter, uint256 amountRedeemed, uint256 repReceived, uint256[] payoutNumerators, uint256 timestamp);
	event DisputeCrowdsourcerRedeemed(address indexed universe, address indexed reporter, address indexed market, address disputeCrowdsourcer, uint256 amountRedeemed, uint256 repReceived, uint256[] payoutNumerators, uint256 timestamp);
	event ReportingParticipantDisavowed(address indexed universe, address indexed market, address reportingParticipant);
	event MarketParticipantsDisavowed(address indexed universe, address indexed market);
	event MarketFinalized(address indexed universe, address indexed market, uint256 timestamp, uint256[] winningPayoutNumerators);
	event MarketMigrated(address indexed market, address indexed originalUniverse, address indexed newUniverse);
	event UniverseForked(address indexed universe, address forkingMarket);
	event UniverseCreated(address indexed parentUniverse, address indexed childUniverse, uint256[] payoutNumerators, uint256 creationTimestamp);
	event CompleteSetsPurchased(address indexed universe, address indexed market, address indexed account, uint256 numCompleteSets, uint256 timestamp);
	event CompleteSetsSold(address indexed universe, address indexed market, address indexed account, uint256 numCompleteSets, uint256 fees, uint256 timestamp);
	event TradingProceedsClaimed(address indexed universe, address indexed sender, address market, uint256 outcome, uint256 numShares, uint256 numPayoutTokens, uint256 fees, uint256 timestamp);
	event TokensTransferred(address indexed universe, address token, address indexed from, address indexed to, uint256 value, TokenType tokenType, address market);
	event TokensMinted(address indexed universe, address indexed token, address indexed target, uint256 amount, TokenType tokenType, address market, uint256 totalSupply);
	event TokensBurned(address indexed universe, address indexed token, address indexed target, uint256 amount, TokenType tokenType, address market, uint256 totalSupply);
	event TokenBalanceChanged(address indexed universe, address indexed owner, address token, TokenType tokenType, address market, uint256 balance, uint256 outcome);
	event DisputeWindowCreated(address indexed universe, address disputeWindow, uint256 startTime, uint256 endTime, uint256 id, bool initial);
	event InitialReporterTransferred(address indexed universe, address indexed market, address from, address to);
	event MarketTransferred(address indexed universe, address indexed market, address from, address to);
	event MarketOIChanged(address indexed universe, address indexed market, uint256 marketOI);
	event ParticipationTokensRedeemed(address indexed universe, address indexed disputeWindow, address indexed account, uint256 attoParticipationTokens, uint256 feePayoutShare, uint256 timestamp);
	event TimestampSet(uint256 newTimestamp);
	event ValidityBondChanged(address indexed universe, uint256 validityBond);
	event DesignatedReportStakeChanged(address indexed universe, uint256 designatedReportStake);
	event NoShowBondChanged(address indexed universe, uint256 noShowBond);
	event ReportingFeeChanged(address indexed universe, uint256 reportingFee);
	event ShareTokenBalanceChanged(address indexed universe, address indexed account, address indexed market, uint256 outcome, uint256 balance);
	event MarketRepBondTransferred(address indexed universe, address market, address from, address to);
	event WarpSyncDataUpdated(address indexed universe, uint256 warpSyncHash, uint256 marketEndTime);

	event RegisterContract(address contractAddress, bytes32 key);
	event FinishDeployment();
}
