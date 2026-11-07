// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPoolAuctionCapital } from './interfaces/ISecurityPoolAuctionCapital.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';

interface IAuctionVaultCapital {
	function materializeAuctionBid(uint256 bidId) external returns (address vault, uint96 positionId);
	function repToken() external view returns (IERC20);
	function depositAndSetHealthTarget(uint256 amount, uint256 targetHealthFactorBps) external;
}

/// @notice Creates and recognizes one bid's vault: EIP-1167 forwarding code to
/// the shared implementation, followed by the vault's four immutable bindings.
/// The forwarder only jumps to a fixed offset inside its own 45 bytes, so the
/// trailing bindings never affect it, and the implementation reads them from
/// the clone's own code. Nothing is initialized later: every binding is fixed by
/// the creation code, and the CREATE2 salt is the bid identifier.
library SecurityPoolAuctionVaultClones {
	uint256 internal constant BINDINGS_LENGTH = 92;
	uint256 internal constant RUNTIME_LENGTH = 45 + BINDINGS_LENGTH;

	function runtimeCode(address implementation, address owner, address capital, address auction, uint256 bidId) internal pure returns (bytes memory) {
		return
			abi.encodePacked(hex'363d3d373d3d3d363d73', implementation, hex'5af43d82803e903d91602b57fd5bf3', owner, capital, auction, bidId);
	}
	function creationCode(address implementation, address owner, address capital, address auction, uint256 bidId) internal pure returns (bytes memory) {
		bytes memory runtime = runtimeCode(implementation, owner, capital, auction, bidId);
		return abi.encodePacked(hex'3d61', uint16(runtime.length), hex'80600b3d3981f3', runtime);
	}
	function create(address implementation, address owner, address capital, address auction, uint256 bidId) internal returns (address vault) {
		require(owner != address(0) && capital != address(0) && auction != address(0), 'Auction vault dependencies missing');
		bytes memory code = creationCode(implementation, owner, capital, auction, bidId);
		bytes32 salt = bytes32(bidId);
		assembly ('memory-safe') {
			vault := create2(0, add(code, 32), mload(code), salt)
		}
		require(vault != address(0), 'Auction vault deployment failed');
	}
	function predict(address deployer, address implementation, address owner, address capital, address auction, uint256 bidId) internal pure returns (address) {
		bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), deployer, bytes32(bidId), keccak256(creationCode(implementation, owner, capital, auction, bidId))));
		return address(uint160(uint256(hash)));
	}
}

/// @notice One bid's independently collateralized vault, controlled by its bidder.
/// Every voluntary operation first realizes its funded share of the auction cohort.
/// The account remains usable for child-universe choices and later capital ledgers.
/// @dev Deployed only as a clone; the shared implementation holds no bindings and
/// refuses direct use. Each clone keeps its own guard and materialization flag.
contract SecurityPoolAuctionVault {
	using SafeERC20Ops for IERC20;
	bool private entered;
	/// @notice This bid's position in its initial capital ledger has been
	/// materialized. It says nothing about child-universe positions: fork
	/// choices, migration, child deposits and parent fee claims keep their checks.
	bool public initialPositionMaterialized;

	receive() external payable {}

	function owner() public view returns (address value) {
		(value, , , ) = _bindings();
	}
	function initialCapital() public view returns (IAuctionVaultCapital value) {
		(, address capital, , ) = _bindings();
		return IAuctionVaultCapital(capital);
	}
	function auction() public view returns (ISecurityPoolAuctionCapital value) {
		(, , address controller, ) = _bindings();
		return ISecurityPoolAuctionCapital(controller);
	}
	function bidId() public view returns (uint256 value) {
		(, , , value) = _bindings();
	}
	/// @dev Under delegatecall `address()` is the clone, whose code ends with the
	/// bindings. Any other code length is not a vault, including the implementation.
	function _bindings() private view returns (address owner_, address capital_, address auction_, uint256 bidId_) {
		uint256 size;
		assembly ('memory-safe') {
			size := extcodesize(address())
		}
		require(size == SecurityPoolAuctionVaultClones.RUNTIME_LENGTH, 'Auction vault is not a clone');
		assembly ('memory-safe') {
			let pointer := mload(0x40)
			extcodecopy(address(), pointer, 45, 92)
			owner_ := shr(96, mload(pointer))
			capital_ := shr(96, mload(add(pointer, 20)))
			auction_ := shr(96, mload(add(pointer, 40)))
			bidId_ := mload(add(pointer, 60))
		}
	}

	modifier onlyOwner() {
		require(msg.sender == owner(), 'Only the auction vault owner');
		require(!entered, 'Auction vault operation active');
		entered = true;
		if (!initialPositionMaterialized) _materializeInitialPosition();
		_;
		entered = false;
	}

	/// @dev The flag shares the reentrancy guard's slot, so skipping costs nothing
	/// extra and the first successful materialization pays one permanent write.
	/// A zero fill is rechecked every time: losing and cancelled bids keep this
	/// account for asset recovery, and a keeper's earlier materialization is
	/// recognized through the same call. The flag reverts with the operation.
	function _materializeInitialPosition() private {
		(, address capital, address controller, uint256 id) = _bindings();
		if (ISecurityPoolAuctionCapital(controller).bidPosition(id).filledLots == 0) return;
		(address vault, uint96 positionId) = IAuctionVaultCapital(capital).materializeAuctionBid(id);
		require(vault == address(this) && positionId != 0, 'Auction vault materialization failed');
		initialPositionMaterialized = true;
	}

	/// @notice Deposit directly from the controlling wallet in one operation;
	/// the wallet approves this vault and its chosen health target stays explicit.
	function depositPrincipal(IAuctionVaultCapital capital, uint256 amount, uint256 targetHealthFactorBps) external onlyOwner {
		IERC20 token = capital.repToken();
		token.safeTransferFrom(msg.sender, address(this), amount);
		token.safeApprove(address(capital), amount);
		capital.depositAndSetHealthTarget(amount, targetHealthFactorBps);
	}

	function execute(address target, uint256 value, bytes calldata data) external payable onlyOwner returns (bytes memory result) {
		return _execute(target, value, data);
	}

	/// @notice Ledger earnings and principal withdrawals pay this
	/// account. Forward those assets to the owner-selected recipient atomically.
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
