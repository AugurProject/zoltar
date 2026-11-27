import Inv08SearchLower
open SolidCore.Solidity.Source Inv32Division Inv03.Bodies
namespace Inv08.Expiry
def selected (ends : Nat → Nat) (tm settled last : Nat) :=
  if last=0 ∨ ends last≤tm then last
  else if tm<ends (settled+1) then settled
  else search ends tm 48 (settled+1) last

set_option maxHeartbeats 1200000 in
theorem execute (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (tm settled last : Nat)
    (ch : c.checked=true) (tf : tm<2^48) (fields : c.storageFields=model.core.context.storageFields)
    (old : stored r.state .settled=settled) (high : stored r.state .latest=last) (ordered : settled≤last)
    (paid : settled=0 ∨ endsAt r.state settled≤tm) (hf : last<2^48) :
    let q := selected (endsAt r.state) tm settled last
    body.value.eval (n+57) t c (entry r tm) = pure (.returned (entry r tm) [.word q]) := by
  let s := entry r tm
  let ho := withHigh r tm last
  let lo := range r tm (settled+1) last
  let ends := endsAt r.state
  let q := selected ends tm settled last
  have P := Inv32Assign.scalarCast (n+55) t c s.pushScope s.pushScope "timestamp" tm tm _ _ _
    (by rfl) (local48 c s.pushScope "timestamp" tm tf rfl _ (Nat.le_succ _)) (by dsimp [s,entry]; write_expiry)
  have S : Stmt.eval (n+56) t c s.pushScope .skip = pure (.normal s.pushScope) := by rw [Stmt.eval]
  have H := Inv32Hoist.declEval (n+54) t c (start r tm) "high" .uint256 _ last
    (scalarField c (start r tm) .latest last fields high hf _ (Nat.le_succ _)) (by rfl)
  have map := records c r.state last hf fields
  have U := upper (n+49) t c r tm last ends tf hf (endFits _ _) map
  let inside := block [typed "high" (clean48 (refField "lastExpiryId")),upperTest,lowerInit,lowerTest,whileLoop,ret (w48 "low")]
  have main : inside.value.eval (n+56) t c s.pushScope = pure (.returned s.pushScope [.word q]) := by
    by_cases top : last=0 ∨ ends last≤tm
    · rw [if_pos top] at U
      have eq : q=last := if_pos top
      rw [eq]
      exact Inv32FloorFastPath.blockReturned _ _ _ _ _ _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ H).trans
        (Inv32FloorFastPath.stop _ _ _ _ _ _ _ _ U))
    · rw [if_neg top] at U
      have before : settled<last := by
        by_contra h
        have eq : settled=last := by omega
        rw [←eq] at top; exact top paid
      have I := lowerStart (n+54) t c r tm settled last fields old before hf
      have L := lower (n+51) t c r tm settled last ends fields old before hf tf (endFits _ _) map
      dsimp only at L
      by_cases noMore : tm<ends (settled+1)
      · rw [if_pos noMore] at L
        have eq : q=settled := by simp [q,selected,top,noMore]
        rw [eq]
        exact Inv32FloorFastPath.blockReturned _ _ _ _ _ _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ H).trans
          ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ U).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ I).trans
          (Inv32FloorFastPath.stop _ _ _ _ _ _ _ _ L))))
      · rw [if_neg noMore] at L
        have eq : q=search ends tm 48 (settled+1) last := by simp [q,selected,top,noMore]
        have run := loop n 48 t c r tm (settled+1) last last ends ch tf (by omega) before hf (by omega) (by omega)
          (fun i _ => endFits _ _) map
        dsimp only at run
        rw [←eq] at run
        have W : whileLoop.value.eval (n+55) t c lo = pure (.normal (range r tm q q)) := by
          change Stmt.eval _ _ _ _ (.whileLoop _ _) = _
          rw [Stmt.eval]; exact run
        have qfit : q<2^48 := by
          have searchLe (k a b : Nat) (h : a≤b) : search ends tm k a b≤b := by
            induction k generalizing a b with
            | zero => exact h
            | succ k ih =>
              simp only [search]
              split
              · split
                · apply ih; dsimp [middle]; omega
                · exact le_trans (ih _ _ (by dsimp [middle]; omega)) (by dsimp [middle]; omega)
              · exact h
          exact lt_of_le_of_lt (eq ▸ searchLe 48 _ _ before) hf
        have R' := retLocal (n+54) t c (range r tm q q) "low" q qfit rfl
        exact Inv32FloorFastPath.blockReturned _ _ _ _ _ _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ H).trans
          ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ U).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ I).trans
          ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ L).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ W).trans
          (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ R'))))))
  exact Inv32FloorFastPath.blockReturned _ _ _ _ _ _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ P).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ S).trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ main)))
end Inv08.Expiry
