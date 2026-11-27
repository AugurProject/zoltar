import Inv48ObservedTailBoundsHalt
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace Inv48.ObservedTailBounds
open Inv48.QuoteMemory Inv48.WholeQuote Inv48.FundingMathTail Inv48.QuoteOperandReads
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
private theorem pb {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl

theorem exposureUnderflow (c : Context) (r : Runtime) (id a b h e s minimum : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (imm : r.loadImmutableField c "minimumReportCollateral" = .ok (.word minimum))
    (ha : a<R) (hm : minimum<R) (checked : c.checked=true) (bad : a<minimum) :
    Expr.eval c r exposureExpr = throw (SolidityFailure.revert .overflow) := by
  have coll : Reads c r (clean (field 0)) a := Inv08.MemoryMember.clean
    (Inv08.MemoryMember.fromMemory c r "quote" id 0 a [.word a,.word b,.word h,.word e,.word s]
      ref mem (by decide) rfl) ha
  have pri := Inv08.MemoryMember.clean (immutableReads imm) hm
  have raw : checkedSub true a minimum = .error .overflow := by
    simp [checkedSub,show SolidCore.Solidity.Shared.norm a=a from Nat.mod_eq_of_lt ha,show SolidCore.Solidity.Shared.norm minimum=minimum from Nat.mod_eq_of_lt hm,bad]
  have op : BinaryOp.apply c.checked .sub (.word a) (.word minimum) = .error .overflow := by
    simp [checked,BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,BinaryOp.applyWord,raw,Bind.bind,Except.bind]
  have subThrows (k : Nat) : Expr.evalFuel (k+6) c r
      (.binary .sub (clean (field 0)) (clean (.immutable "minimumReportCollateral"))) =
      throw (SolidityFailure.revert .overflow) := by
    rw [Expr.evalFuel]
    have x := coll (k+5) (by change 5≤k+5; omega)
    have y := pri (k+5) (by change 3≤k+5; omega)
    change Expr.evalFuel (k+5) c r (clean (.immutable "minimumReportCollateral")) = _ at y
    rw [y]
    change (Expr.evalFuel (k+5) c r (clean (field 0)) >>= _) = _
    rw [x]
    simp only [pb,op]
    rfl
    all_goals intro h; cases h
  change Expr.evalFuel 17 c r exposureExpr = _
  have hundred : Expr.evalFuel 14 c r (.ternary (.word 1) (.word 100) (.word 100)) = pure (.word 100,r) := rfl
  have sub : Expr.evalFuel 14 c r (clean (clean (.binary .sub (clean (field 0)) (clean (.immutable "minimumReportCollateral"))))) = throw (SolidityFailure.revert .overflow) := by
    unfold clean
    rw [Expr.evalFuel,Expr.evalFuel]
    have fail := subThrows 6
    dsimp only [clean] at fail
    rw [fail]
    rfl
  unfold exposureExpr clean
  rw [Expr.evalFuel,Expr.evalFuel,Expr.evalFuel]
  · rw [hundred]
    simp only [pb]
    dsimp only [clean] at sub
    rw [sub]
    rfl
  all_goals intro h; cases h
#print axioms exposureUnderflow
end Inv48.ObservedTailBounds
