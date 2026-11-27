import Inv32TernaryCall
import Inv48PositiveHoist
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions Inv32FloorFastPath
namespace Inv48.Positive
set_option maxRecDepth 65536

def declare (ty : Ty) (name : String) (e : Formula)
    (size : e.depth ≤ e.core.orderFuel+1) : Action where
  core := .varDecl ty name (some e.core)
  depth := 1
  run checked r := do
    let v ← e.run checked (locals r)
    let out ← ty.coerceValue? (.word v)
    some (r.declareLocal name out)
  sound n t c r next enough hit := by
    cases n with
    | zero => omega
    | succ n =>
      cases h : e.run c.checked (locals r) <;> simp only [h,Option.bind_none,Option.bind_some] at hit
      case none => contradiction
      rename_i v
      have read := evalFormula e c r v size h
      cases co : ty.coerceValue? (.word v) <;> simp [h,co] at hit
      cases hit
      rw [Stmt.eval]; dsimp only; rw [read]; change (match ty.coerceValue? (.word v) with
        | some value => (pure (.normal (r.declareLocal name value)) : SolI Result)
        | none => pure (.reverted r .typeMismatch)) = _
      rw [co]

theorem returnExpr (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (e : Expr) (v : Nat)
    (single : Expr.evalReturnValue c r e = pure (.word v,r)) :
    Stmt.eval (n+1) t c r (.returnValues [e]) = pure (.returned r [.word v]) := by
  have vs : Expr.evalReturnList c r [e] = pure ([.word v],r) := by
    change Expr.evalReturnListFuel (_+1+1) c r [e] = _
    simp only [Expr.evalReturnListFuel,single]
    rfl
  rw [Stmt.eval]; dsimp only; rw [vs]; rfl


theorem actionsThen (as : List Action) (n : Nat) (t : FunctionTable) (c : Context)
    (r next : Runtime) (tail : List Stmt) (enough : listDepth as ≤ n)
    (done : runList c.checked r as = some next) :
    Stmt.evalList n t c r (as.map Action.core ++ tail) = Stmt.evalList n t c next tail := by
  induction as generalizing r with
  | nil => cases done; rfl
  | cons a rest ih =>
    simp only [listDepth,max_le_iff] at enough
    cases h : a.run c.checked r <;> simp [runList,h] at done
    rw [List.map_cons,List.cons_append,
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ (a.sound _ _ _ _ _ enough.1 h)]
    exact ih _ enough.2 done

theorem hoist (n : Nat) (t : FunctionTable) (c : Context) (r staged called copied : Runtime)
    (dst ret key : String) (preludeActions : List Action) (args : List Expr) (v : Nat)
    (enough : listDepth preludeActions ≤ n+1)
    (pre : runList c.checked r.pushScope preludeActions = some staged)
    (call : Stmt.eval n t c staged (.internalCall [ret] key args) = internalCallAssign staged [ret] [.word v])
    (put : staged.assignLocal? ret (.word v) = some called)
    (D : called.lookupLocal? dst = some (.word 0))
    (S : called.lookupLocal? ret = some (.word v))
    (copy : called.assignLocal? dst (.word v) = some copied) :
    Stmt.eval (n+2) t c r
      (.block (preludeActions.map Action.core ++ [.captureReturn [ret] (.internalCall [ret] key args),.assign (.var dst) (.var ret)])) =
      pure (.normal copied.popScope) := by
  have cap : Stmt.eval (n+1) t c staged (.captureReturn [ret] (.internalCall [ret] key args)) =
      pure (.normal called) := by
    apply Inv32Internal.capture
    rw [call]
    simp [internalCallAssign,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,put]
  have cp := Inv48.PositiveHoist.lastCopy n t c called copied dst ret 0 v D S copy
  have tail : Stmt.evalList (n+1) t c staged
      [.captureReturn [ret] (.internalCall [ret] key args),.assign (.var dst) (.var ret)] =
      pure (.normal copied) :=
    (Inv32FloorStart.seqStep _ _ _ _ _ _ _ cap).trans cp
  exact Inv48.PositiveHoist.block (n+1) t c r copied _
    ((actionsThen preludeActions (n+1) t c r.pushScope staged _ enough pre).trans tail)

end Inv48.Positive
