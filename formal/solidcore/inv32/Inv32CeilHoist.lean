import Inv32QuoteGuard
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32Hoist Inv32FloorStart Inv32CeilFlags
namespace Inv32CeilHoist
abbrev a3 := "_ic_arg_3"
abbrev dest := "_ret___library_Math_mulDiv_overload_1_0"
def one : Expr := .enumFromUInt 3 (.castOp .uintCleanup 256 (.word 1))
def inputs (ex ey ed : Expr) : List Stmt := [.varDecl .uint256 a0 (some ex),.varDecl .uint256 a1 (some ey),
   .varDecl .uint256 a2 (some ed),.varDecl .uint256 a3 (some one),.varDecl .uint256 dest none]
def cap := Stmt.captureReturn [dest] (.internalCall [dest] Inv32Bodies.Ceil.key [.var a0,.var a1,.var a2,.var a3])
def code (ex ey ed : Expr) := Stmt.block (inputs ex ey ed ++ [cap,.assign (.var h0) (.var dest)])
def stateC (r : Runtime) (v x y d tmp : Nat) :=
  ((st3 r h0 v x y d).declareLocal a3 (.word 1)).declareLocal dest (.word tmp)
def changes (r : Runtime) (dst : String) (result : Option Nat) (program : SolI Result) : Prop :=
  match result with
  | none => ∃ next err, program = pure (.reverted next err)
  | some v => program = pure (.normal (Inv32OneArg.store r dst v))
theorem args (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (ex ey ed : Expr) (x y d : Nat) (ss : List Stmt) (h : Inputs c r h0 ex ey ed x y d) :
    Stmt.evalList (n+1) t c (start r h0 0) (inputs ex ey ed ++ ss) = Stmt.evalList (n+1) t c (stateC r 0 x y d 0) ss := by
  have literal (rt : Runtime) : Expr.eval c rt one = pure (.word 1,rt) := by
    have lit : Expr.evalFuel 2 c rt (.word 1) = pure (.word 1,rt) := by rw [Expr.evalFuel]; rfl
    have clean := Inv32Guards.clean 2 c rt (.word 1) 1 (by decide) lit
    change Expr.evalFuel 4 c rt (.enumFromUInt 3 (.castOp .uintCleanup 256 (.word 1))) = _
    rw [Expr.evalFuel,clean]; rfl
  refine (seqStep _ _ _ _ _ _ _ (declEval n t c _ _ _ _ _ h.1 (by rw [Ty.coerceValue?]))).trans ?_
  refine (seqStep _ _ _ _ _ _ _ (declEval n t c _ _ _ _ _ h.2.1 (by rw [Ty.coerceValue?]))).trans ?_
  refine (seqStep _ _ _ _ _ _ _ (declEval n t c _ _ _ _ _ h.2.2 (by rw [Ty.coerceValue?]))).trans ?_
  refine (seqStep _ _ _ _ _ _ _ (declEval n t c _ _ _ _ _ (literal _) (by rw [Ty.coerceValue?]))).trans ?_
  exact seqStep _ _ _ _ _ _ _ (zero _ _ _ _ _)

theorem run (n : Nat) (c : Context) (r : Runtime) (ex ey ed : Expr) (x y d : Nat)
    (hx : x<R) (hy : y<R) (hd : d<R) (pos : 0<d) (h : Inputs c r h0 ex ey ed x y d) :
    changes r h0 (Inv32CeilBody.ceilResult x y d) (Stmt.eval (n+30) Inv32Dispatch.model.core.table c
      (Inv32OneArg.store r h0 0) (code ex ey ed)) := by
  let t := Inv32Dispatch.model.core.table
  let st := fun o v => stateC r o x y d v
  have call := Inv32CeilCall.call n c (st 0 0) a0 a1 a2 a3 [dest] x y d hx hy hd pos rfl rfl rfl rfl
  have prefix' := args (n+28) t c r _ _ _ _ _ _ [cap,.assign (.var h0) (.var dest)] h
  cases res : Inv32CeilBody.ceilResult x y d with
  | none =>
    rw [res] at call; obtain ⟨next,err,ev⟩ := call
    have captured := Inv32Revert.capture _ _ _ _ _ _ [dest] _ ev
    exact ⟨next.popScope,err,Inv32Revert.blockRevert _ _ _ _ _ _ _ (prefix'.trans (Inv32Revert.stop _ _ _ _ _ _ _ _ captured))⟩
  | some v =>
    rw [res] at call
    have up : (st 0 0).assignLocal? dest (.word v) = some (st 0 v) := by
      cases H : r.locals <;> dsimp [st,stateC,dest,a3,h0] <;> write_temps
    have captured := takeReturn _ _ _ _ _ _ _ _ _ call up
    have cp : Stmt.evalList (n+29) t c (st 0 v) [.assign (.var h0) (.var dest)] = pure (.normal (st v v)) := by
      apply lastCopy _ _ _ _ _ _ _ 0 v
      all_goals cases H : r.locals <;> dsimp [st,stateC,dest,a3,h0] <;> write_temps
    exact block _ _ _ _ _ _ (prefix'.trans ((seqStep _ _ _ _ _ _ _ captured).trans cp))
end Inv32CeilHoist
