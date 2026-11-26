import Inv32RejectionLinks
import Inv32FlagCalls
import Inv32Revert
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions
namespace Inv32PanicChoice
abbrev target := "_ret___library_SafeCast_toUint_0"
abbrev temp := "_ic_arg_0"
abbrev outName := "_sol_hoist_0"
def frame (b : Bool) : Frame := [("condition",.word (boolWord b)),("a",.word 18),("b",.word 17),("_ret0",.word 0)]
def w (s : String) := clean (localWord s)
def answer := clean (Inv32NewtonSeed.xorF (w "b") (Inv32NewtonBody.twice (mulF
  (clean (Inv32NewtonSeed.xorF (w "a") (w "b"))) (clean (cast .uint 256 (localWord outName))))))
def value (b : Bool) := if b then 18 else 17
def env (b : Bool) : Env
  | "a" => some 18
  | "b" => some 17
  | "_sol_hoist_0" => some (boolWord b)
  | _ => none
theorem computes : ∀ b : Bool, answer.run false (env b) = some (value b) := by native_decide

private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
theorem leaf (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (b : Bool)
    (u : c.checked = false) (m : Models r (env b)) :
    Stmt.eval (n+1) t c r (.returnValues [answer.core]) = pure (.returned r [.word (value b)]) := by
  have val : Expr.eval c r answer.core = pure (.word (value b),r) :=
    answer.sound _ _ _ _ _ (by decide) m (u ▸ computes b)
  have single : Expr.evalReturnValue c r answer.core = pure (.word (value b),r) := val
  have vs : Expr.evalReturnList c r [answer.core] = pure ([.word (value b)],r) := by
    change Expr.evalReturnListFuel (_+1+1) c r [answer.core] = _
    simp only [Expr.evalReturnListFuel,single,pb]
  rw [Stmt.eval]; dsimp only; rw [vs]; rfl

def stage : Stmt := .block [.varDecl .bool temp (some (.var "condition")),.varDecl .uint256 target none,
  .captureReturn [target] (.internalCall [target] Inv32Bodies.ToUint.key [.var temp]),
  .assign (.var outName) (.var target)]

theorem declareFlag (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (dst src : String) (b : Bool)
    (h : r.lookupLocal? src = some (.word (boolWord b))) :
    Stmt.eval (n+1) t c r (.varDecl .bool dst (some (.var src))) = pure (.normal (r.declareLocal dst (.word (boolWord b)))) := by
  have e : Expr.eval c r (.var src) = pure (.word (boolWord b),r) := Inv32Guards.readWord _ _ _ _ _ h
  rw [Stmt.eval]; dsimp only; rw [e]; cases b <;> rfl

def saved (r : Runtime) (v : Nat) := r.declareLocal outName (.word v)
def bodyFrame (r : Runtime) (b : Bool) := (r.withFrame (frame b)).pushScope.pushScope.pushScope
set_option maxRecDepth 15000
macro "store_flag" : tactic => `(tactic|
  simp [saved,bodyFrame,frame,target,temp,outName,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,
    Runtime.pushScope,Runtime.declareLocal,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,
    LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
theorem stageExecAt (table : FunctionTable) (links : Inv32Rejection.Links table) (n : Nat) (c : Context) (r : Runtime) (b : Bool) :
    let m := bodyFrame r b
    Stmt.eval (n+9) table c (saved m 0) stage = pure (.normal (saved m (boolWord b))) := by
  let t := table
  let root := bodyFrame r b
  let m := saved root 0
  let st := fun o v => (((saved root o).pushScope.declareLocal temp (.word (boolWord b))).declareLocal target (.word v))
  have d := declareFlag (n+7) t c m.pushScope temp "condition" b rfl
  have z := Inv32FloorStart.zero (n+7) t c (m.pushScope.declareLocal temp (.word (boolWord b))) target
  have call := Inv32FlagCalls.toUintAt table links.uint n c (st 0 0) temp [target] b rfl
  have ass : internalCallAssign (st 0 0) [target] [.word (boolWord b)] = pure (.normal (st 0 (boolWord b))) := by
    unfold internalCallAssign; simp only [List.isEmpty_cons,Bool.false_eq_true,if_false]
    have upd : (st 0 0).assignNamedValuesRef? [target] [.word (boolWord b)] = some (st 0 (boolWord b)) := by
      dsimp [st,root]; store_flag
    rw [upd]
  have cap := Inv32Internal.capture _ _ _ _ _ [target] _ (call.trans ass)
  have cp := Inv32Temps.copy (n+7) t c (st 0 (boolWord b)) (st (boolWord b) (boolWord b))
    outName target 0 (boolWord b) rfl rfl (by dsimp [st,root]; store_flag)
  unfold stage; dsimp only
  rw [Stmt.eval]; dsimp only
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ d,Inv32FloorStart.seqStep _ _ _ _ _ _ _ z]
  have last := (Inv32FloorStart.seqStep _ _ _ _ _ _ _ cap).trans (Inv32FloorStart.seqStep _ _ _ _ _ _ [] cp)
  rw [last,Stmt.evalList]; rfl

abbrev stageExec := stageExecAt Inv32Dispatch.model.core.table Inv32Rejection.trading
end Inv32PanicChoice
