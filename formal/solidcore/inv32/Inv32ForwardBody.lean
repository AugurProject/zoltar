import Inv32ForwardSteps
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Actions Inv32Normal Inv32ForwardSteps Inv32QuoteExpr
namespace Inv32ForwardBody
def next (r : Runtime) (x y g f : Nat) :=
  (Inv32.quoteExactInput x y g f).map fun q => after r x y g f (Inv32.netInput g f) q q (g-Inv32.netInput g f)
theorem positiveGuard (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (s msg : String)
    (v : Nat) (hv : v<R) (read : locals r s = some v) :
    Stmt.eval (n+1) t c r (requirePositive s msg) = pure (if 0<v then .normal r else .reverted r (.error msg)) := by
  have ev := evalFormula (positive s) c r _ (by change 3≤5; decide) (positiveValue _ _ _ _ hv read)
  simpa [requirePositive] using Inv32QuoteGuard.requireEval n t c r _ _ msg ev
theorem outputGuard (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (q y : Nat) (hq : q<R) (hy : y<R)
    (Q : locals r "amountOut"=some q) (Y : locals r "reserveOut"=some y) :
    Stmt.eval (n+1) t c r guardOut = pure (if 0<q ∧ q<y then .normal r else .reverted r (.error "Insufficient output")) := by
  let left := positive "amountOut"
  let right := smaller "amountOut" "reserveOut"
  let fuel := (Expr.binary .boolAnd left.core right.core).orderFuel
  have L := left.sound fuel c r (locals r) _ (by decide) (Inv32QuoteGuard.modeled _) (positiveValue _ _ _ _ hq Q)
  have R' := right.sound fuel c r (locals r) _ (by decide) (Inv32QuoteGuard.modeled _) (less _ _ _ _ q y hq hy Q Y)
  simpa [guardOut,left,right] using Inv32QuoteGuard.requireEval n t c r _ _ "Insufficient output" (Inv32QuoteGuard.both _ _ _ _ _ _ _ L R')
macro "write_forward" : tactic => `(tactic|
  simp [after,withNet,Inv32OneArg.store,base,frm,flag,Runtime.declareLocal,Runtime.withFrame,Runtime.pushScope,
    Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,LocalEnv.declare,LocalEnv.assign?,Frame.lookup?,Frame.assign?,
    Value.coerceLike?])
theorem exec (n : Nat) (c : Context) (r : Runtime) (x y g f : Nat) (hx : x<R) (hy : y<R) (hg : g<R) (hf : f<R) :
    Ends (next r x y g f) (Stmt.evalList (n+278) Inv32Dispatch.model.core.table c (base r x y g f 0 0) ss) := by
  let t := Inv32Dispatch.model.core.table
  let root := base r x y g f 0 0
  let net := Inv32.netInput g f
  let q := Inv32.ratio y net x
  have Nle := netBound g f
  have hn : net<R := lt_of_le_of_lt Nle hg
  have G0 := Inv32Guards.guardResult (n+277) t c root x y hx hy rfl rfl
  have G1 := positiveGuard (n+277) t c root "amountIn" "Input is zero" g hg rfl
  have G2 := Inv32QuoteGuard.feeExec (n+277) t c root f hf rfl
  rw [shape]
  by_cases res : 0<x ∧ 0<y
  case neg =>
    have bad : Inv32.quoteExactInput x y g f = none := if_neg (fun h => res ⟨h.1,h.2.1⟩)
    unfold next; rw [bad]; rw [if_neg res] at G0; exact reject _ _ _ _ _ _ ⟨_,_,G0⟩
  rw [if_pos res] at G0; apply step _ _ _ _ _ _ _ _ G0
  by_cases gross : 0<g
  case neg =>
    have bad : Inv32.quoteExactInput x y g f = none := if_neg (fun h => gross h.2.2.1)
    unfold next; rw [bad]; rw [if_neg gross] at G1; exact reject _ _ _ _ _ _ ⟨_,_,G1⟩
  rw [if_pos gross] at G1; apply step _ _ _ _ _ _ _ _ G1
  by_cases fee : f<10000
  case neg =>
    have bad : Inv32.quoteExactInput x y g f = none := if_neg (fun h => fee h.2.2.2.1)
    unfold next; rw [bad]; rw [if_neg fee] at G2; exact reject _ _ _ _ _ _ ⟨_,_,G2⟩
  rw [if_pos fee] at G2; apply step _ _ _ _ _ _ _ _ G2
  let tmp := Inv32OneArg.store root flag net
  let nr := withNet root net
  have N := Inv32Hoist.declEval (n+277) t c tmp "netInput" .uint256 (castCopy flag).core net
    (evalFormula (castCopy flag) c tmp _ (by decide) (castValue _ (locals tmp) flag net hn rfl)) (by rw [Ty.coerceValue?])
  apply step _ _ _ _ _ _ _ _ (Inv32FloorStart.zero (n+277) t c root flag)
  apply step _ _ _ _ _ _ _ _ (floorExec (n+263) c r x y g f hg hf fee)
  apply step _ _ _ _ _ _ _ _ N
  have G3 := positiveGuard (n+277) t c nr "netInput" "Net input is zero" net hn rfl
  by_cases np : 0<net
  case neg =>
    have bad : Inv32.quoteExactInput x y g f = none := if_neg (fun h => np h.2.2.2.2.1)
    unfold next; rw [bad]; rw [if_neg np] at G3; exact reject _ _ _ _ _ _ ⟨_,_,G3⟩
  rw [if_pos np] at G3; apply step _ _ _ _ _ _ _ _ G3
  have den := Nat.add_pos_left res.1 net
  have hq : q<R := by dsimp [q]; rw [Inv32.ratio_correct _ _ _ hy hn hx den]; exact lt_of_le_of_lt (Inv32RatioLoop.bound _ _ _ den) hy
  apply step _ _ _ _ _ _ _ _ (Inv32FloorStart.zero (n+277) t c nr flag)
  apply step _ _ _ _ _ _ _ _ (ratioExec n c r x y g f net hx hy hn den)
  let qstate := after r x y g f net q 0 0
  let mid := after r x y g f net q q 0
  have assign := Inv32Assign.scalarCast (n+277) t c qstate mid "amountOut" 0 q _ _ _ rfl
    (evalFormula (w flag) c qstate _ (by decide) (Inv32InverseSteps.capRead _ _ _ _ hq rfl)) (by dsimp [qstate,mid]; write_forward)
  apply step _ _ _ _ _ _ _ _ assign
  have G4 := outputGuard (n+277) t c mid q y hq hy rfl rfl
  by_cases output : 0<q ∧ q<y
  case neg =>
    have bad : Inv32.quoteExactInput x y g f = none := if_neg (fun h => output h.2.2.2.2.2)
    unfold next; rw [bad]; rw [if_neg output] at G4; exact reject _ _ _ _ _ _ ⟨_,_,G4⟩
  rw [if_pos output] at G4; apply step _ _ _ _ _ _ _ _ G4
  have good : Inv32.quoteExactInput x y g f = some q := if_pos ⟨res.1,res.2,gross,fee,np,output⟩
  unfold next; rw [good]
  let post := after r x y g f net q q (g-net)
  have paid := Inv32Assign.scalarCast (n+277) t c mid post "feeAmount" 0 (g-net) _ _ _ rfl
    (evalFormula (nonnegativeSub (w "amountIn") (w "netInput")) c mid _ (by decide) (subValue _ _ _ _ _ _ hg hn Nle
      (Inv32InverseSteps.capRead c mid "amountIn" g hg rfl) (Inv32InverseSteps.capRead c mid "netInput" net hn rfl)))
    (by dsimp [mid,post]; write_forward)
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] paid).trans (by rw [Stmt.evalList])
end Inv32ForwardBody
