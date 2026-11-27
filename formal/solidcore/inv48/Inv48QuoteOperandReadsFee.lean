import Inv48QuoteOperandReadsCore
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.QuoteOperandReads
open Inv48.QuoteMemory Inv48.FundingMathTail
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

theorem basefeeWord (c : Context) : EnvWord.blockBasefee.eval c<R := by
  change (if c.evmVersion.londonOrLater then
    SolidCore.Solidity.Shared.norm c.blockEnv.basefee else 0)<R
  split
  · exact Nat.mod_lt _ (by decide : 0<R)
  · exact (by decide : 0<R)

theorem addBounds (x y z : Nat) (hx : x<R) (hy : y<R)
    (success : checkedAdd true x y = .ok z) : x+y<R ∧ z=x+y := by
  simp only [checkedAdd,show SolidCore.Solidity.Shared.norm x=x from Nat.mod_eq_of_lt hx,
    show SolidCore.Solidity.Shared.norm y=y from Nat.mod_eq_of_lt hy] at success
  split at success
  next bad => contradiction
  next good =>
    have fit : x+y<R := by simpa [R,wordModulus] using Nat.lt_of_not_ge (by simpa using good)
    have plain := Inv32CompareValues.addWord x y hx hy
    have add : SolidCore.Solidity.Shared.addWord x y=x+y := by
      simpa [BinaryOp.apply,BinaryOp.applyWord,BinaryOp.preservesFixedBytesWidth,
        Value.forceAbiLazy,Bind.bind,Except.bind,checkedAdd,Nat.mod_eq_of_lt fit] using plain
    have eq : z=x+y := by simpa [add] using success.symm
    exact ⟨fit,eq⟩

theorem feeInputs (c : Context) (r : Runtime) (priority feeMul base : Nat)
    (hp : priority<R) (hf : feeMul<R) (he : EnvWord.blockBasefee.eval c<R)
    (success : checkedAdd true (EnvWord.blockBasefee.eval c) priority = .ok base)
    (priorityRead : r.loadImmutableField c "initialReportPriorityFeeAttoEthPerGas" = .ok (.word priority))
    (feeRead : r.loadImmutableField c "maxSettlementBaseFeeMultiplierBps" = .ok (.word feeMul)) :
    Inputs c r h0 feeX feeY denom base feeMul 10000 := by
  obtain ⟨fit,eq⟩ := addBounds _ _ _ he hp success
  subst base
  have envRead : Reads c (Inv32FloorHoist.start r h0 0) (.env .blockBasefee)
      (EnvWord.blockBasefee.eval c) := by
    intro fuel enough
    change 2≤fuel at enough
    cases fuel with
    | zero => omega
    | succ n => simp [Expr.evalFuel]
  have pri := immutableReads (r := Inv32FloorHoist.start r h0 0) priorityRead
  have sum := binaryRead (Inv08.MemoryMember.clean envRead he)
    (Inv08.MemoryMember.clean pri hp) .add (by intro h; cases h) (by intro h; cases h)
    (Inv40.addWords c.checked _ _ fit)
  refine ⟨?_,?_,denominator c _⟩
  · change Expr.evalFuel _ c _ feeX = _
    exact (Inv08.MemoryMember.clean (Inv08.MemoryMember.clean sum fit) fit) _ (by decide)
  · change Expr.evalFuel _ c _ feeY = _
    exact (Inv08.MemoryMember.clean (immutableReads (r := st1 r h0 0 _) feeRead) hf) _ (by decide)

theorem quotientBound (x y : Nat) (budget : x*y ≤ (R-1)*10000) : x*y/10000<R := by
  have h := Nat.div_le_div_right budget (c := 10000)
  have d : (R-1)*10000/10000=R-1 := by omega
  rw [d] at h
  unfold R at h ⊢
  omega
end Inv48.QuoteOperandReads
