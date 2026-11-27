import Inv32InverseSteps
open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32Normal Inv32InverseSteps
namespace Inv32InverseBody
def expected (r : Runtime) (x y a f : Nat) := (Inv32.quoteExactOutput x y a f).map fun q =>
  finalState r x y a f (Inv32.requiredNet x y a) q (q-Inv32.requiredNet x y a)
theorem valid (n : Nat) (c : Context) (r : Runtime) (x y a f : Nat)
    (hx : x<R) (hy : y<R) (ha : a<R) (hf : f<R) (xp : 0<x) (ap : 0<a) (ay : a<y) (fb : f<10000) :
    Ends (expected r x y a f) (Stmt.evalList (n+30) Inv32Dispatch.model.core.table c (base r x y a f 0 0) tail) := by
  let t := Inv32Dispatch.model.core.table
  let root := base r x y a f 0 0
  let net := Inv32.requiredNet x y a
  let q := Inv32.cost x y a f
  have smallD : y-a<R := lt_of_le_of_lt (Nat.sub_le _ _) hy
  have smallF : 10000-f<R := lt_of_le_of_lt (Nat.sub_le _ _) (by decide)
  have bb : f < Inv32.bps := fb
  have Z := Inv32FloorStart.zero (n+29) t c root Inv32CeilFlags.h0
  have C := Inv32CeilHoist.run n c root _ _ _ x a (y-a) hx ha smallD (by omega)
    (firstInputs c r x y a f hx hy ha (Nat.le_of_lt ay))
  change Inv32CeilHoist.changes root _ (if net<R then some net else none) (Stmt.eval _ _ _ _ firstCall) at C
  apply step _ _ _ _ _ _ _ _ Z
  by_cases hn : net<R
  · rw [if_pos hn] at C
    apply step _ _ _ _ _ _ _ _ C
    let newRoot := withNet root net
    let temp := Inv32OneArg.store root Inv32CeilFlags.h0 net
    have N := Inv32Hoist.declEval (n+29) t c temp "netInput" .uint256 castResult.core net
      (evalFormula castResult c temp _ (by decide) (Inv32QuoteExpr.castValue c.checked (locals temp) _ net hn rfl)) (by rw [Ty.coerceValue?])
    apply step _ _ _ _ _ _ _ _ N
    apply step _ _ _ _ _ _ _ _ (Inv32FloorStart.zero (n+29) t c newRoot Inv32CeilFlags.h0)
    have G := Inv32CeilHoist.run n c newRoot _ _ _ net 10000 (10000-f) hn (by decide) smallF (by omega)
      (secondInputs c r x y a f net hn hf (Nat.le_of_lt fb))
    change Inv32CeilHoist.changes newRoot _ (if q<R then some q else none) (Stmt.eval _ _ _ _ secondCall) at G
    by_cases hq : q<R
    · rw [if_pos hq] at G; apply step _ _ _ _ _ _ _ _ G
      have good : Inv32.quoteExactOutput x y a f = some q :=
        if_pos ⟨xp,ap,ay,bb,hn,hq⟩
      unfold expected; rw [good]
      exact finish _ _ _ _ _ _ _ _ _ _ hn hq (Inv32.inverseNetLeGross _ _ _ _ bb)
    · rw [if_neg hq] at G
      have bad : Inv32.quoteExactOutput x y a f = none := if_neg (fun p => hq p.2.2.2.2.2)
      unfold expected; rw [bad]
      exact reject _ _ _ _ _ _ G
  · rw [if_neg hn] at C
    have bad : Inv32.quoteExactOutput x y a f = none := if_neg (fun p => hn p.2.2.2.2.1)
    unfold expected; rw [bad]
    exact reject _ _ _ _ _ _ C
theorem guarded (n : Nat) (c : Context) (r : Runtime) (x y a f : Nat)
    (hx : x<R) (hy : y<R) (ha : a<R) (hf : f<R) :
    Ends (expected r x y a f) (Stmt.evalList (n+30) Inv32Dispatch.model.core.table c (base r x y a f 0 0) instr) := by
  let t := Inv32Dispatch.model.core.table
  let root := base r x y a f 0 0
  have A := Inv32Guards.guardResult (n+29) t c root x y hx hy rfl rfl
  have B := Inv32QuoteGuard.outputExec (n+29) t c root y a hy ha rfl rfl
  have C := Inv32QuoteGuard.feeExec (n+29) t c root f hf rfl
  rw [identity']
  by_cases res : 0<x ∧ 0<y
  · rw [if_pos res] at A; apply step _ _ _ _ _ _ _ _ A
    by_cases out : 0<a ∧ a<y
    · rw [if_pos out] at B; apply step _ _ _ _ _ _ _ _ B
      by_cases fee : f<10000
      · rw [if_pos fee] at C; exact step _ _ _ _ _ _ _ _ C (valid n c r x y a f hx hy ha hf res.1 out.1 out.2 fee)
      · rw [if_neg fee] at C
        have bad : Inv32.quoteExactOutput x y a f = none := if_neg (fun p => fee p.2.2.2.1)
        unfold expected; rw [bad]; exact reject _ _ _ _ _ _ ⟨_,_,C⟩
    · rw [if_neg out] at B
      have bad : Inv32.quoteExactOutput x y a f = none := if_neg (fun p => out ⟨p.2.1,p.2.2.1⟩)
      unfold expected; rw [bad]; exact reject _ _ _ _ _ _ ⟨_,_,B⟩
  · rw [if_neg res] at A
    have bad : Inv32.quoteExactOutput x y a f = none := if_neg (fun p => res ⟨p.1,lt_trans p.2.1 p.2.2.1⟩)
    unfold expected; rw [bad]; exact reject _ _ _ _ _ _ ⟨_,_,A⟩
end Inv32InverseBody
