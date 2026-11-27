import Inv48EscrowJoinCore
import SolidCore.Solidity.AdoptionLaws
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowJoin
open Inv48.EscrowPrefix Inv48.EscrowTrace
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

theorem transferEncodingTree (c : Context) (r : Runtime) (payer escrow amount : Nat)
    (P : r.lookupLocal? "payer" = some (.word payer))
    (E : r.lookupLocal? "escrow" = some (.word escrow))
    (A : r.lookupLocal? "repAmount" = some (.word amount))
    (ha : amount < 2^256) :
    Expr.eval c r calldataExpr =
      (match abiEncodeValues? [.address,.address,.uint256] [.word payer,.word escrow,.word amount] with
       | some bytes => pure (.bytes (wordToBytesBE selectorBytes 599290589 ++ bytes),r)
       | none => throw (SolidityFailure.revert RevertData.typeMismatch)) := by
  have ha' : amount < 115792089237316195423570985008687907853269984665640564039457584007913129639936 := ha
  have cast : uintCast? 256 (.word amount) = .ok (.word amount) := by
    simp [uintCast?,Value.forceAbiLazy,Value.asStorageWord?,Nat.mod_eq_of_lt ha',
      SolidCore.Solidity.Shared.norm,SolidCore.Solidity.Shared.wordModulus,EvmYul.UInt256.size,Bind.bind,Except.bind]
  have a (n : Nat) : Expr.evalFuel (n+2) c r (.castOp .uintCast 256 (.var "repAmount")) =
      pure (.word amount,r) := by
    rw [Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ A]
    simp only [pb,cast]
    rfl
  have args (n : Nat) : Expr.evalListFuel (n+6) c r
      [.word 599290589,.var "payer",.var "escrow",.castOp .uintCast 256 (.var "repAmount")] =
      pure ([.word 599290589,.word payer,.word escrow,.word amount],r) := by
    rw [Expr.evalListFuel,Expr.evalFuel]
    simp only [pb]
    rw [Expr.evalListFuel,Inv32Guards.readWord _ _ _ _ _ P]
    simp only [pb]
    rw [Expr.evalListFuel,Inv32Guards.readWord _ _ _ _ _ E]
    simp only [pb]
    rw [Expr.evalListFuel,a]
    simp only [pb]
    rw [Expr.evalListFuel]
    rfl
  unfold Expr.eval calldataExpr
  simp only [Expr.orderFuel,Expr.listEvalFuel]
  rw [Expr.evalFuel,args]
  simp only [pb]
  have material : r.materializeForValueUseList c [.word payer,.word escrow,.word amount] =
      .ok [.word payer,.word escrow,.word amount] := by
    simp [Runtime.materializeForValueUseList,Runtime.materializeForValueUse,
      Runtime.materializeForValueUseFuel,Bind.bind,Except.bind]
  simp only [Value.expectWord]
  have sel : SolidCore.Solidity.Shared.norm 599290589 = 599290589 := by decide
  rw [sel]
  rw [material]
  rfl

theorem transferEncodedAddresses (payer escrow amount : Nat) (bytes : List Byte)
    (encoded : abiEncodeValues? [.address,.address,.uint256]
      [.word payer,.word escrow,.word amount] = some bytes) :
    SolidCore.Solidity.Shared.norm payer < 2^160 ∧
      SolidCore.Solidity.Shared.norm escrow < 2^160 := by
  have fits : abiAddressFits payer = true ∧ abiAddressFits escrow = true := by
    by_cases p : abiAddressFits payer = true
    · by_cases e : abiAddressFits escrow = true
      · exact ⟨p,e⟩
      · simp [abiEncodeValues?,abiEncodeValuesAux?,Ty.listAbiHeadWords?,Ty.abiHeadWords?,Ty.isDynamicAbi,
          Ty.staticAbiHeadWords?,abiEncodeStaticValue?,abiStaticBytes?,p,e,Bind.bind,Option.bind] at encoded
    · simp [abiEncodeValues?,abiEncodeValuesAux?,Ty.listAbiHeadWords?,Ty.abiHeadWords?,Ty.isDynamicAbi,
        Ty.staticAbiHeadWords?,abiEncodeStaticValue?,abiStaticBytes?,p,Bind.bind,Option.bind] at encoded
  exact ⟨of_decide_eq_true fits.1,of_decide_eq_true fits.2⟩

theorem transferEncodingSuccessful (c : Context) (r : Runtime) (payer escrow amount : Nat)
    (P : r.lookupLocal? "payer" = some (.word payer))
    (E : r.lookupLocal? "escrow" = some (.word escrow))
    (A : r.lookupLocal? "repAmount" = some (.word amount))
    (ha : amount < 2^256) (canonical : SolidCore.Solidity.Shared.norm escrow = escrow)
    (hp : payer < 2^160) (value : Value) (final : Runtime) (trace : Interaction.Transcript)
    (run : ExecutesOK (Expr.eval c r calldataExpr) trace (value,final)) :
    escrow < 2^160 := by
  rw [transferEncodingTree c r payer escrow amount P E A ha] at run
  split at run
  next bytes encoded =>
    have bounds := transferEncodedAddresses payer escrow amount bytes encoded
    simpa only [canonical] using bounds.2
  next failed => cases run

/-- Normal completion of the actual REP statement forces its address encoding
    to succeed. No global 160-bit restriction on creation responses is used. -/
theorem normalTransferAddress (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (rep payer escrow amount : Nat)
    (P : r.lookupLocal? "payer" = some (.word payer))
    (E : r.lookupLocal? "escrow" = some (.word escrow))
    (A : r.lookupLocal? "repAmount" = some (.word amount))
    (R : r.lookupLocal? "rep" = some (.word rep))
    (ha : amount < 2^256) (canonical : SolidCore.Solidity.Shared.norm escrow = escrow)
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval (n+2) t c r transferStmt) trace (.normal final)) :
    escrow < 2^160 := by
  cases encoded : abiEncodeValues? [.address,.address,.uint256]
      [.word payer,.word escrow,.word amount] with
  | some bytes =>
    simpa only [canonical] using (transferEncodedAddresses payer escrow amount bytes encoded).2
  | none =>
    have enc : calldataExpr.evalWithRuntimeByContext c r = .error RevertData.typeMismatch := by
      unfold Expr.evalWithRuntimeByContext
      rw [transferEncodingTree c r payer escrow amount P E A ha,encoded]
      rfl
    have read : (.var "rep" : Expr).evalWithRuntimeByContext c r = .ok (.word rep,r) := by
      unfold Expr.evalWithRuntimeByContext Expr.eval
      rw [Inv32Guards.readWord _ _ _ _ _ R]
      rfl
    have zero : (.word 0 : Expr).evalWithRuntimeByContext c r = .ok (.word 0,r) := rfl
    unfold transferStmt at run
    rw [Stmt.eval] at run
    simp only [read,Value.expectWord,zero,enc] at run
    have h := pureResult _ _ _ run
    cases h.2

#print axioms normalTransferAddress
#print axioms transferEncodingTree
#print axioms transferEncodedAddresses
#print axioms transferEncodingSuccessful
end Inv48.EscrowJoin
