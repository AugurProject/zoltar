import Inv36Arithmetic
open SolidCore.Solidity.Source Inv32Division Inv32QuoteExpr Inv32Actions Inv32Scalar Inv32FloorStart
namespace Inv36Source
abbrev cn := "completeSets"
abbrev pn := "conditionalYesBpsValue"
abbrev yn := "yesAmount"
abbrev nn := "noAmount"
abbrev flag := "_sol_hoist_0"
def frm (c p y n : Nat) : Frame := [(cn,.word c),(pn,.word p),(yn,.word y),(nn,.word n)]
def base (r : Runtime) (c p y n : Nat) := (r.withFrame (frm c p y n)).pushScope.pushScope
def diff := nonnegativeSub bps (w pn)
def branch (high : Bool) : Stmt := .block [
  .assign (.var (if high then nn else yn)) (w cn).core,.varDecl .uint256 flag none,
  Inv32FloorHoist.code flag (w cn).core (if high then diff else w pn).core (if high then w pn else diff).core,
  .assign (.var (if high then yn else nn)) (castCopy flag).core]
macro "write_initial" : tactic => `(tactic|
  simp [base,frm,cn,pn,yn,nn,flag,Inv32OneArg.store,Runtime.declareLocal,Runtime.withFrame,
    Runtime.pushScope,Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,LocalEnv.declare,
    LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
private theorem readDiff (c : Context) (r : Runtime) (p : Nat) (hp : p<10000)
    (P : locals r pn = some p) : diff.core.eval c r = pure (.word (10000-p),r) := by
  have pr : p<R := lt_trans hp (by decide : 10000<R)
  exact evalFormula diff c r _ (by decide) (subValue _ _ _ _ _ _ (by decide) pr (by omega)
    (bpsValue _ _) (Inv32ProductValues.cleanup (localWord pn) _ _ _ pr P))

theorem upperBranch (n : Nat) (ctx : Context) (r : Runtime) (amount p : Nat)
    (ha : amount<R) (hp : 0<p ∧ p<10000) (side : 5000≤p) :
    let q := amount*(10000-p)/(p)
    Stmt.eval (n+16) Inv32Dispatch.model.core.table ctx (base r amount p 0 0) (branch true) =
      pure (.normal (base r amount p q amount)) := by
  let t := Inv32Dispatch.model.core.table
  let root := (base r amount p 0 0).pushScope
  let filled := (base r amount p 0 amount).pushScope
  let q := amount*(10000-p)/(p)
  let dest := Inv32OneArg.store (base r amount p q amount).pushScope flag q
  have pr : p<R := lt_trans hp.2 (by decide : 10000<R)
  have dr : 10000-p<R := lt_of_le_of_lt (Nat.sub_le _ _) (by decide)
  have fits : q<R := by
    apply lt_of_le_of_lt _ ha
    unfold q
    exact le_trans (Nat.div_le_div_right (Nat.mul_le_mul_left amount (show 10000-p ≤ p by omega)))
      (le_of_eq (Nat.mul_div_cancel _ (by omega)))
  have A := Inv32Assign.scalarCast (n+14) t ctx root filled nn 0 amount _ _ _ rfl
    (Inv32Guards.clean _ _ _ _ _ ha (Inv32Guards.readWord _ _ _ cn amount rfl))
    (by dsimp [root,filled]; write_initial)
  have Z := zero (n+14) t ctx filled flag
  have args : Inv32FloorHoist.Inputs ctx filled flag (w cn).core (diff).core (w pn).core amount (10000-p) (p) :=
    ⟨Inv32Guards.clean _ _ _ _ _ ha (Inv32Guards.readWord _ _ _ _ _ rfl),
     readDiff _ _ p hp.2 rfl, Inv32Guards.clean _ _ _ _ _ pr (Inv32Guards.readWord _ _ _ _ _ rfl)⟩
  have F := Inv32FloorHoist.success n ctx filled flag _ _ _ amount (10000-p) (p) ha dr pr
    (by omega) fits args (by decide) (by decide) (by decide) (by decide)
  let next := Inv32OneArg.store filled flag q
  have S := Inv32Assign.scalarCast (n+14) t ctx next dest yn 0 q _ _ _ rfl
    (evalFormula (castCopy flag) ctx next q (by decide) (castValue _ _ _ _ fits rfl))
    (by dsimp [next,filled,dest]; write_initial)
  exact Inv32Hoist.block _ t ctx _ dest _ ((seqStep _ _ _ _ _ _ _ A).trans
    ((seqStep _ _ _ _ _ _ _ Z).trans ((seqStep _ _ _ _ _ _ _ F).trans
    ((seqStep _ _ _ _ _ _ _ S).trans (by rw [Stmt.evalList])))))

theorem lowerBranch (n : Nat) (ctx : Context) (r : Runtime) (amount p : Nat)
    (ha : amount<R) (hp : 0<p ∧ p<10000) (side : p<5000) :
    let q := amount*(p)/(10000-p)
    Stmt.eval (n+16) Inv32Dispatch.model.core.table ctx (base r amount p 0 0) (branch false) =
      pure (.normal (base r amount p amount q)) := by
  let t := Inv32Dispatch.model.core.table
  let root := (base r amount p 0 0).pushScope
  let filled := (base r amount p amount 0).pushScope
  let q := amount*(p)/(10000-p)
  let dest := Inv32OneArg.store (base r amount p amount q).pushScope flag q
  have pr : p<R := lt_trans hp.2 (by decide : 10000<R)
  have dr : 10000-p<R := lt_of_le_of_lt (Nat.sub_le _ _) (by decide)
  have fits : q<R := by
    apply lt_of_le_of_lt _ ha
    unfold q
    exact le_trans (Nat.div_le_div_right (Nat.mul_le_mul_left amount (show p ≤ 10000-p by omega)))
      (le_of_eq (Nat.mul_div_cancel _ (by omega)))
  have A := Inv32Assign.scalarCast (n+14) t ctx root filled yn 0 amount _ _ _ rfl
    (Inv32Guards.clean _ _ _ _ _ ha (Inv32Guards.readWord _ _ _ cn amount rfl))
    (by dsimp [root,filled]; write_initial)
  have Z := zero (n+14) t ctx filled flag
  have args : Inv32FloorHoist.Inputs ctx filled flag (w cn).core (w pn).core (diff).core amount (p) (10000-p) :=
    ⟨Inv32Guards.clean _ _ _ _ _ ha (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ pr (Inv32Guards.readWord _ _ _ _ _ rfl), readDiff _ _ p hp.2 rfl⟩
  have F := Inv32FloorHoist.success n ctx filled flag _ _ _ amount (p) (10000-p) ha pr dr
    (by omega) fits args (by decide) (by decide) (by decide) (by decide)
  let next := Inv32OneArg.store filled flag q
  have S := Inv32Assign.scalarCast (n+14) t ctx next dest nn 0 q _ _ _ rfl
    (evalFormula (castCopy flag) ctx next q (by decide) (castValue _ _ _ _ fits rfl))
    (by dsimp [next,filled,dest]; write_initial)
  exact Inv32Hoist.block _ t ctx _ dest _ ((seqStep _ _ _ _ _ _ _ A).trans
    ((seqStep _ _ _ _ _ _ _ Z).trans ((seqStep _ _ _ _ _ _ _ F).trans
    ((seqStep _ _ _ _ _ _ _ S).trans (by rw [Stmt.evalList])))))
end Inv36Source
