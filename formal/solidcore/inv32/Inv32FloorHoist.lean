import Inv32CeilFlags
open SolidCore.Solidity.Source Inv32Division Inv32Hoist Inv32FloorStart Inv32OneArg
namespace Inv32FloorHoist
abbrev a0 := "_ic_arg_0"
abbrev a1 := "_ic_arg_1"
abbrev a2 := "_ic_arg_2"
abbrev ret := "_ret___library_Math_mulDiv_0"
def argv : List Expr := [.var a0,.var a1,.var a2]
def capture : Stmt := .captureReturn [ret] (.internalCall [ret] Inv32Bodies.Floor.key argv)
def code (dst : String) (x y d : Expr) : Stmt := .block [
  .varDecl .uint256 a0 (some x),.varDecl .uint256 a1 (some y),.varDecl .uint256 a2 (some d),
  .varDecl .uint256 ret none,capture,.assign (.var dst) (.var ret)]
def start (r : Runtime) (dst : String) (v : Nat) := (store r dst v).pushScope
def st1 (r : Runtime) (dst : String) (v x : Nat) := (start r dst v).declareLocal a0 (.word x)
def st2 (r : Runtime) (dst : String) (v x y : Nat) := (st1 r dst v x).declareLocal a1 (.word y)
def st3 (r : Runtime) (dst : String) (v x y d : Nat) := (st2 r dst v x y).declareLocal a2 (.word d)
def state (r : Runtime) (dst : String) (v x y d tmp : Nat) := (st3 r dst v x y d).declareLocal ret (.word tmp)
def Inputs (c : Context) (r : Runtime) (dst : String) (ex ey ed : Expr) (x y d : Nat) :=
  ex.eval c (start r dst 0) = pure (.word x,start r dst 0) ∧
  ey.eval c (st1 r dst 0 x) = pure (.word y,st1 r dst 0 x) ∧
  ed.eval c (st2 r dst 0 x y) = pure (.word d,st2 r dst 0 x y)
theorem bindArgs (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (dst : String)
    (ex ey ed : Expr) (x y d : Nat) (tail : List Stmt) (args : Inputs c r dst ex ey ed x y d) :
    Stmt.evalList (n+1) t c (start r dst 0) ([.varDecl .uint256 a0 (some ex),.varDecl .uint256 a1 (some ey),
       .varDecl .uint256 a2 (some ed),.varDecl .uint256 ret none] ++ tail) =
    Stmt.evalList (n+1) t c (state r dst 0 x y d 0) tail :=
  (seqStep _ _ _ _ _ _ _ (declEval n t c _ _ _ _ _ args.1 (by rw [Ty.coerceValue?]))).trans
    ((seqStep _ _ _ _ _ _ _ (declEval n t c _ _ _ _ _ args.2.1 (by rw [Ty.coerceValue?]))).trans
    ((seqStep _ _ _ _ _ _ _ (declEval n t c _ _ _ _ _ args.2.2 (by rw [Ty.coerceValue?]))).trans
    (seqStep _ _ _ _ _ _ _ (zero n t c _ _))))
macro "write_temps" : tactic => `(tactic|
  simp [state,st3,st2,st1,start,store,ret,a0,a1,a2,Runtime.assignLocal?,Runtime.lookupLocal?,
    Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,
    Frame.lookup?,Frame.assign?,Value.coerceLike?, *])
theorem success (n : Nat) (c : Context) (r : Runtime) (dst : String) (ex ey ed : Expr)
    (x y d : Nat) (hx : x<R) (hy : y<R) (hd : d<R) (hp : 0<d) (fits : x*y/d<R)
    (args : Inputs c r dst ex ey ed x y d) (n0 : a0 ≠ dst) (n1 : a1 ≠ dst) (n2 : a2 ≠ dst) (nr : ret ≠ dst) :
    Stmt.eval (n+15) Inv32Dispatch.model.core.table c (store r dst 0) (code dst ex ey ed) =
      pure (.normal (store r dst (x*y/d))) := by
  let t := Inv32Dispatch.model.core.table
  let st := state r dst
  let q := x*y/d
  have C := Inv32FloorCall.success (n+12) c (st 0 x y d 0) a0 a1 a2 [ret] x y d hx hy hd hp fits rfl rfl rfl (by omega)
  have U : (st 0 x y d 0).assignLocal? ret (.word q) = some (st 0 x y d q) := by
    cases eqn : r.locals <;> dsimp [st] <;> write_temps
  have cap := takeReturn _ _ _ _ _ _ _ _ _ C U
  have cp : Stmt.evalList (n+14) t c (st 0 x y d q) [.assign (.var dst) (.var ret)] =
      pure (.normal (st q x y d q)) := by
    apply lastCopy _ _ _ _ _ _ _ 0 q
    all_goals cases eqn : r.locals <;> dsimp [st] <;> write_temps
  exact block _ _ _ _ _ _ ((bindArgs (n+13) _ _ _ _ _ _ _ _ _ _ _ args).trans
    ((seqStep _ _ _ _ _ _ _ cap).trans cp))
theorem overflow (n : Nat) (c : Context) (r : Runtime) (dst : String) (ex ey ed : Expr)
    (x y d : Nat) (hx : x<R) (hy : y<R) (hd : d<R) (hp : 0<d) (large : R≤x*y/d)
    (args : Inputs c r dst ex ey ed x y d) :
    ∃ next err, Stmt.eval (n+25) Inv32Dispatch.model.core.table c (store r dst 0) (code dst ex ey ed) =
      pure (.reverted next err) := by
  obtain ⟨next,err,ev⟩ := Inv32FloorOverflow.call n c (state r dst 0 x y d 0) a0 a1 a2 [ret] x y d hx hy hd hp large rfl rfl rfl
  have cap := Inv32Revert.capture _ _ _ _ _ _ [ret] _ ev
  exact ⟨next.popScope,err,Inv32Revert.blockRevert _ _ _ _ _ _ _ ((bindArgs (n+23) _ _ _ _ _ _ _ _ _ _ _ args).trans
    (Inv32Revert.stop _ _ _ _ _ _ [.assign (.var dst) (.var ret)] _ cap))⟩
end Inv32FloorHoist
