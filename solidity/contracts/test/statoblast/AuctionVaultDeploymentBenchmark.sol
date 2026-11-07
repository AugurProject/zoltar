// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import {
	SecurityPoolAuctionVault,
	SecurityPoolAuctionVaultClones,
	IAuctionVaultCapital
} from '../../statoblast/SecurityPoolAuctionVault.sol';
import { ISecurityPoolAuctionCapital } from '../../statoblast/interfaces/ISecurityPoolAuctionCapital.sol';
import { IERC20 } from '../../IERC20.sol';
import { SafeERC20Ops } from '../../SafeERC20Ops.sol';

/// @dev Benchmark reference: the former constructor-bound vault with the same
/// materialization flag, kept only to measure the clone tradeoff over time.
contract AuctionVaultReference {
	using SafeERC20Ops for IERC20;
	address public immutable owner;
	IAuctionVaultCapital public immutable initialCapital;
	ISecurityPoolAuctionCapital public immutable auction;
	uint256 public immutable bidId;
	bool private entered;
	bool public initialPositionMaterialized;

	constructor(address owner_, address capital_, address auction_, uint256 bidId_) {
		require(owner_ != address(0) && capital_ != address(0), 'Auction vault dependencies missing');
		owner = owner_;
		initialCapital = IAuctionVaultCapital(capital_);
		auction = ISecurityPoolAuctionCapital(auction_);
		bidId = bidId_;
	}

	receive() external payable {}

	modifier onlyOwner() {
		require(msg.sender == owner, 'Only the auction vault owner');
		require(!entered, 'Auction vault operation active');
		entered = true;
		if (!initialPositionMaterialized) _materializeInitialPosition();
		_;
		entered = false;
	}
	function _materializeInitialPosition() private {
		if (auction.bidPosition(bidId).filledLots == 0) return;
		(address vault, uint96 positionId) = initialCapital.materializeAuctionBid(bidId);
		require(vault == address(this) && positionId != 0, 'Auction vault materialization failed');
		initialPositionMaterialized = true;
	}
	function depositPrincipal(IAuctionVaultCapital capital, uint256 amount, uint256 targetHealthFactorBps) external onlyOwner {
		IERC20 token = capital.repToken();
		token.safeTransferFrom(msg.sender, address(this), amount);
		token.safeApprove(address(capital), amount);
		capital.depositAndSetHealthTarget(amount, targetHealthFactorBps);
	}
	function execute(address target, uint256 value, bytes calldata data) external payable onlyOwner returns (bytes memory result) {
		return _execute(target, value, data);
	}
	function executeAndSweep(address target, uint256 value, bytes calldata data, IERC20 token, address payable recipient) external payable onlyOwner returns (bytes memory result) {
		require(recipient != address(0) && recipient != address(this), 'Auction vault recipient invalid');
		result = _execute(target, value, data);
		uint256 rep = token.balanceOf(address(this));
		if (rep != 0) token.safeTransfer(recipient, rep);
		uint256 eth = address(this).balance;
		if (eth != 0) {
			(bool sent, ) = recipient.call{value: eth}('');
			require(sent, 'Auction vault ETH transfer failed');
		}
	}
	function _execute(address target, uint256 value, bytes calldata data) private returns (bytes memory result) {
		require(target != address(0), 'Auction vault target missing');
		bool success;
		(success, result) = target.call{value: value}(data);
		if (!success) {
			assembly ('memory-safe') {
				revert(add(result, 32), mload(result))
			}
		}
	}
	function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
		return this.onERC1155Received.selector;
	}
	function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
		return this.onERC1155BatchReceived.selector;
	}
}

/// @dev Deploys production clones and reference vaults from one factory so
/// their creation and operation gas are directly comparable.
contract AuctionVaultDeploymentBenchmark {
	address public immutable implementation;
	constructor() {
		implementation = address(new SecurityPoolAuctionVault());
	}
	function createClone(address owner, address capital, address auction, uint256 bidId) external returns (address) {
		return SecurityPoolAuctionVaultClones.create(implementation, owner, capital, auction, bidId);
	}
	function createReference(address owner, address capital, address auction, uint256 bidId) external returns (address) {
		return address(new AuctionVaultReference{salt: bytes32(bidId)}(owner, capital, auction, bidId));
	}
	function predictClone(address owner, address capital, address auction, uint256 bidId) external view returns (address) {
		return SecurityPoolAuctionVaultClones.predict(address(this), implementation, owner, capital, auction, bidId);
	}
	function expectedRuntime(address owner, address capital, address auction, uint256 bidId) external view returns (bytes memory) {
		return SecurityPoolAuctionVaultClones.runtimeCode(implementation, owner, capital, auction, bidId);
	}
	function expectedCreationCode(address owner, address capital, address auction, uint256 bidId) external view returns (bytes memory) {
		return SecurityPoolAuctionVaultClones.creationCode(implementation, owner, capital, auction, bidId);
	}
}

/// @dev Controls the fill each vault sees and serves as a cheap execution
/// target. Counters start nonzero so the first measured call pays no fresh slot.
contract AuctionVaultBenchmarkAuctionMock is ISecurityPoolAuctionCapital {
	mapping(uint256 => BidPosition) private positions;
	uint256 public pings = 1;
	function setFill(uint256 id, address vault, uint256 filledLots) external {
		positions[id] = BidPosition(vault, 10_000, filledLots);
	}
	function bidPosition(uint256 id) external view returns (BidPosition memory) {
		return positions[id];
	}
	function bidIdForVault(address) external pure returns (uint256) {
		return 0;
	}
	function previewBidFees(uint256, uint256, uint256) external pure returns (uint256, uint256) {
		return (0, 0);
	}
	function claimAndRemoveFees(uint256, uint256, uint256) external pure returns (uint256, uint256) {
		return (0, 0);
	}
	function ping() external {
		pings += 1;
	}
}

contract AuctionVaultBenchmarkCapitalMock {
	mapping(address => uint96) public positionIds;
	uint96 private next = 1;
	function materializeAuctionBid(uint256) external returns (address vault, uint96 positionId) {
		vault = msg.sender;
		positionId = positionIds[vault];
		if (positionId == 0) {
			positionId = ++next;
			positionIds[vault] = positionId;
		}
	}
}
