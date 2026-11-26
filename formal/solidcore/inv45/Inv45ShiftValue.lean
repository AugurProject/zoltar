import Inv45PublicHelpers
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Public
theorem shrValue (check : Bool) (x b : Nat) (X : x<R) (B : b<R) (short : b<256) :
    BinaryOp.apply check .shr (.word x) (.word b)=.ok (.word (x >>> b)) := by
  have small : x >>> b < R := lt_of_le_of_lt (Nat.shiftRight_le x b) X
  have h : Shared.shrWord b x=x >>> b := by
    unfold Shared.shrWord Shared.ofEvmWord EvmYul.UInt256.shiftRight
    rw [Signed.evm x X,Signed.evm b B]
    have test : ¬ (⟨b,B⟩ : Fin (2^256))≥256 := by change ¬ b≥256;omega
    rw [if_neg test]
    change ((x >>> b)%R)%R=x >>> b
    simp [Nat.mod_eq_of_lt small]
  cases check <;> simp [BinaryOp.apply,BinaryOp.applyWord,Value.forceAbiLazy,h,Bind.bind,Except.bind]
end Inv45.Public
