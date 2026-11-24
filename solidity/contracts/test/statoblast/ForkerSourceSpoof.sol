// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @dev Test-only adversary. One contract answers as the source pool, its factory,
/// its security pool and its reporter ledger, and names a real pool as the "child".
contract ForkerSourceSpoof {
	uint248 public immutable universeId;
	address public immutable victim;

	struct ReporterQuestion {
		uint256 balanceAttoRep;
		address sourceGame;
		uint248 scheduledUniverseId;
		uint48 finalAfter;
		bool winnerHaircutPaidByFork;
	}

	constructor(uint248 forkedUniverseId, address victimPool) {
		universeId = forkedUniverseId;
		victim = victimPool;
	}

	// Source pool surface.
	function securityPoolFactory() external view returns (address) {
		return address(this);
	}
	function securityPoolCustody() external pure returns (address) {
		return address(1);
	}
	function questionId() external pure returns (uint256) {
		return 0;
	}
	function escalationGame() external pure returns (address) {
		return address(0);
	}
	function shareToken() external pure returns (address) {
		return address(0);
	}
	function statoblastSecurityMultiplierBps() external pure returns (uint256) {
		return 0;
	}
	function authorizeChildQuestionLedger(address) external {}

	// Factory surface.
	function getQuestionLedgerOriginId(address) external pure returns (bytes32) {
		return bytes32(uint256(1));
	}
	function getQuestionLedger(bytes32, uint248 requestedUniverseId) external view returns (address) {
		return requestedUniverseId == universeId ? address(this) : address(0);
	}
	function securityPoolOf(address) external view returns (address) {
		return address(this);
	}
	function prepareSecurityPoolPriceFeed(address, uint248) external pure returns (address) {
		return address(0);
	}
	function deployChildQuestionLedger(address, address, uint248, uint256, uint256) external view returns (address) {
		return victim;
	}

	// Security pool and reporter ledger surface.
	function prepareQuestionUniverse(uint248) external {}
	function registerChildQuestionLedger(address) external {}
	function reporterLedger(uint248) external view returns (address) {
		return address(this);
	}
	function checkpoint(uint248) external {}
	function question(uint248, uint256) external pure returns (ReporterQuestion memory state, bool finalClaim) {}
}
