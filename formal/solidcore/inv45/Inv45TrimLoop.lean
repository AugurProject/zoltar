import Inv45TrimTest
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Trim
open Bytes
theorem lastNotZero (xs : List Nat) {b : Nat} (h : (Text.strip xs).getLast?=some b) : b≠48 := by
  have z := List.head?_dropWhile_not (·==(48:Nat)) xs.reverse
  simp only [Text.strip,List.getLast?_reverse] at h
  simpa [h] using z
def atCount (r : Runtime) (i : Nat) := r.declareLocal "trimIndex" (.word i)
private theorem named (r : Runtime) (i : Nat) :
    (atCount r i).lookupLocal? "trimIndex"=some (.word i) := by
  cases h : r.locals <;> simp [atCount,Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,h]
private theorem inputRef {r src xs} (input : Ref r "fractionalBytes" src xs) (i : Nat) :
    Ref (atCount r i) "fractionalBytes" src xs := by
  refine ⟨?_,input.cell⟩
  have h := input.pointer
  cases H : r.locals <;> simpa [atCount,Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,H] using h
theorem loopRun (fuel : Nat) (c : Context) (r : Runtime) (src : Nat) (xs : List Nat)
    (len : xs.length≤18) (input : Ref r "fractionalBytes" src xs) (sane : ∀v∈xs,v<256) :
    Stmt.eval (fuel+23) model.core.table c (atCount r xs.length) loop.value=
      pure (.normal (atCount r (Text.strip xs).length)) := by
  let t := model.core.table
  let pre := Text.strip xs
  have form : pre++List.replicate (xs.length-pre.length) 48=xs := Text.restore xs
  have bounds := congrArg List.length form
  simp only [List.length_append,List.length_replicate] at bounds
  have word : 18<R := by decide
  have scan (k n : Nat) (left : k≤xs.length-pre.length) :
      Stmt.evalWhile (n+k+3) t c (atCount r (pre.length+k)) test.value work.value=
        pure (.normal (atCount r pre.length)) := by
    induction k generalizing n with
    | zero =>
      simp only [Nat.add_zero]
      apply Decimal.stopLoop
      cases h : pre.length with
      | zero => exact finished (by simpa [h] using named r 0)
      | succ k =>
        have inside : k<pre.length := by omega
        have here : xs[k]?=some pre[k] := by
          rw [←form,List.getElem?_append_left inside,List.getElem?_eq_getElem inside]
        have last : pre.getLast?=some pre[k] := by
          rw [List.getLast?_eq_getElem?,h,Nat.add_sub_cancel,List.getElem?_eq_getElem inside]
        have nonzero := lastNotZero xs last
        have cond := testAt (c:=c) (named r (k+1)) (by omega) (inputRef input _) sane here
        simpa [nonzero] using cond
    | succ k ih =>
      let i := pre.length+k
      have inside : i<xs.length := by dsimp [i];omega
      have here : xs[i]?=some 48 := by
        rw [←form,List.getElem?_append_right (by dsimp [i];omega),List.getElem?_replicate_of_lt (by dsimp [i];omega)]
      have cond := testAt (c:=c) (named r (i+1)) (by omega) (inputRef input _) sane here
      simp only [if_pos rfl] at cond
      let a := atCount r (i+1)
      let b := atCount r i
      have put : a.pushScope.assignLocal? "trimIndex" (.word i)=some b.pushScope := by
        cases H : r.locals <;> simp [a,b,atCount,Runtime.declareLocal,Runtime.pushScope,Runtime.assignLocal?,Runtime.lookupLocal?,
          LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?,H]
      have dec := Decimal.update (n+k+1) t c a.pushScope b.pushScope false "trimIndex" (i+1) i
        (named r _) (by omega) (by simpa using Inv32QuoteExpr.subWord c.checked (i+1) 1 (by omega) (by decide) (by omega)) put
      have body := Inv32Blocks.one _ t c a b.pushScope _ dec
      exact (Decimal.stepLoop (n+k+3) _ _ _ _ _ _ cond body).trans (ih n (by omega))
  have run := scan (xs.length-pre.length) (fuel+19-(xs.length-pre.length)) (le_refl _)
  rw [bounds,show fuel+19-(xs.length-pre.length)+(xs.length-pre.length)+3=fuel+22 by omega] at run
  change Stmt.eval _ _ _ _ (.whileLoop _ _)=_
  rw [Stmt.eval];exact run
end Inv45.Trim
