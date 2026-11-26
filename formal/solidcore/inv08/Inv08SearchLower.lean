import Inv08SearchGuards
open SolidCore.Solidity.Source Inv32Division Inv03.Bodies
namespace Inv08.Expiry

theorem scalarField (c : Context) (r : Runtime) (f : Field) (n : Nat) (fields : c.storageFields=model.core.context.storageFields)
    (value : stored r.state f=n) (fit : n<2^48) :
    Inv40.Reads c r (clean48 (refField f.name)).value n := by
  subst n; exact cleaned (reads c r f fields) fit

theorem lowerStart (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (tm settled last : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (old : stored r.state .settled=settled)
    (before : settled<last) (hf : last<2^48) :
    lowerInit.value.eval (n+1) t c (withHigh r tm last) = pure (.normal (range r tm (settled+1) last)) := by
  let rt := withHigh r tm last
  have oldFit : settled<2^48 := by omega
  have nextFit : settled+1<2^48 := by omega
  have field := scalarField c rt .settled settled fields old oldFit
  have one : Inv40.Reads c rt (uint48 (num 1)).value 1 := by
    intro fuel enough
    change 2≤fuel at enough
    obtain ⟨k,rfl⟩ := Nat.exists_eq_add_of_le enough
    rw [Nat.add_comm]
    change Expr.evalFuel (k+2) c rt (.castOp .uintCast 48 (.word 1)) = _
    rw [Expr.evalFuel,Expr.evalFuel]; cases c.checked <;> rfl
  have add := ReleaseQuote.binary field one .add (by intro h; cases h) (by intro h; cases h)
    (Inv40.addWords _ _ _ (lt_trans nextFit (by decide)))
  have doubled := cleaned (cleaned add nextFit) nextFit
  exact Inv32Hoist.declEval n t c rt "low" .uint256 _ (settled+1) (doubled _ (Nat.le_succ _)) (by rfl)

theorem lower (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (tm settled last : Nat) (ends : Nat → Nat)
    (fields : c.storageFields=model.core.context.storageFields) (old : stored r.state .settled=settled)
    (before : settled<last) (hf : last<2^48) (tf : tm<2^48) (ef : ends (settled+1)<2^48)
    (table : EndTable c r.state ends last) :
    let src := range r tm (settled+1) last
    lowerTest.value.eval (n+4) t c src =
      pure (if tm<ends (settled+1) then .returned src [.word settled] else .normal src) := by
  let src := range r tm (settled+1) last
  let d := ends (settled+1)
  let rt := src.pushScope.declareLocal "#read749" (.word d)
  let test := Inv32Shapes.Expr_binary Inv32Shapes.BinaryOp_gt (w48 "#read749") (w48 "timestamp")
  let retOld := ret (clean48 (refField "releasedExpiryId"))
  let lastStep := Stmt.ifElse test.value retOld.value .skip
  have E := readEnd c src.pushScope "low" (settled+1) d rfl (table _ _ rfl before)
  have D := Inv32Hoist.declEval (n+2) t c src.pushScope "#read749" .uint256 _ _ (cleaned E ef _ (Nat.le_succ _)) (by rfl)
  have T : test.value.eval c rt = pure (.word (boolWord (decide (tm<d))),rt) := by
    simpa [boolWord] using ReleaseQuote.binary (local48 c rt "#read749" d ef rfl)
      (local48 c rt "timestamp" tm tf rfl) .gt (by intro h; cases h) (by intro h; cases h)
      (Inv32QuoteExpr.gt _ _ _ (lt_trans ef (by decide)) (lt_trans tf (by decide))) _ (Nat.le_succ _)
  have B := Inv32Blocks.branch (n+2) t c rt test.value retOld.value .skip _ T
  have V := scalarField c rt .settled settled fields old (lt_trans before hf)
  dsimp only
  by_cases early : tm<d
  · rw [if_pos early]
    simp only [decide_eq_true early,if_true] at B
    have L := B.trans (Inv32CompareValues.retOne _ _ _ _ _ settled (V _ (Nat.le_succ _)))
    exact Inv32FloorFastPath.blockReturned _ _ _ _ _ _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ D).trans
      (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ L))
  · rw [if_neg early]
    simp only [decide_eq_false early,Bool.false_eq_true,if_false] at B
    have S : Stmt.eval (n+2) t c rt .skip = pure (.normal rt) := by rw [Stmt.eval]
    exact Inv32Hoist.block _ _ _ _ _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ D).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] (B.trans S)).trans (by rw [Stmt.evalList])))
end Inv08.Expiry
