import Inv48Model
import Inv48Minimum
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv48.Escrow

def payload (payer escrow repAmount : Nat) :=
  [payer,escrow,repAmount].flatMap (wordToBytesBE wordBytes)

theorem transferArguments (payer escrow repAmount : Nat) (p : payer<2^160) (e : escrow<2^160) :
    abiEncodeValues? [.address,.address,.uint256] [.word payer,.word escrow,.word repAmount]=
      some (payload payer escrow repAmount) := by
  have addressOk (x : Nat) (bound : x<2^160) : abiAddressFits x=true := by
    exact decide_eq_true (lt_of_le_of_lt (Nat.mod_le _ _) bound)
  simp [abiEncodeValues?,abiEncodeValuesAux?,Ty.listAbiHeadWords?,Ty.abiHeadWords?,Ty.isDynamicAbi,
    Ty.staticAbiHeadWords?,abiEncodeStaticValue?,abiStaticBytes?,addressOk payer p,addressOk escrow e,
    payload,Bind.bind,Option.bind,List.append_assoc]

theorem fundedTransferArguments (payer escrow amount price : Nat) (p : payer<2^160) (e : escrow<2^160) :
    let rep := Inv03.ceilQuot (amount*price) (10^18)
    abiEncodeValues? [.address,.address,.uint256] [.word payer,.word escrow,.word rep]=some (payload payer escrow rep) ∧
      ∀ proposed, rep≤proposed ↔ amount*price≤proposed*10^18 := by
  exact ⟨transferArguments _ _ _ p e,fun proposed => initialRep amount price proposed⟩
#print axioms fundedTransferArguments
end Inv48.Escrow
