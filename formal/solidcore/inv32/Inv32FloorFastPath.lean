import Inv32FloorNarrow
open SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorNarrow
namespace Inv32FloorFastPath
def cleanParam (s : String) : Stmt := .assign (.var s) (.castOp .uintCleanup 256 (.var s))
def scope (r : Runtime) (x y d : Nat) : Runtime :=
  r.withFrame [("x",.word x),("y",.word y),("denominator",.word d),("result",.word 0)]
def rest := instructions.drop 10
theorem shape : Inv32Bodies.Floor.body = .block [cleanParam "x",cleanParam "y",cleanParam "denominator",.skip,
    .block [.unchecked (.block (start ++ firstBranch :: rest))]] := by rfl

private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
theorem cleanParamExec (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (s : String)
    (v : Nat) (hv : v < R) (look : r.lookupLocal? s = some (.word v))
    (write : r.assignLocal? s (.word v) = some r) :
    Stmt.eval (n+1) t c r (cleanParam s) = pure (.normal r) :=
  Inv32Assign.scalarCast _ _ _ _ _ _ _ _ _ _ _ look
    (Inv32Guards.clean _ _ _ _ _ hv (Inv32Guards.readWord _ _ _ _ _ look)) write

theorem blockReturned (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (xs : List Stmt)
    (vs : List Value) (h : Stmt.evalList n t c r.pushScope xs = pure (.returned next vs)) :
    Stmt.eval (n+1) t c r (.block xs) = pure (.returned next.popScope vs) := by
  rw [Stmt.eval]; dsimp only; rw [h]; rfl
theorem stop (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (s : Stmt)
    (ss : List Stmt) (vs : List Value) (h : Stmt.eval n t c r s = pure (.returned next vs)) :
    Stmt.evalList n t c r (s::ss) = pure (.returned next vs) := by rw [Stmt.evalList,h]; rfl

set_option maxRecDepth 12000
macro "write_param" : tactic => `(tactic|
 simp [scope,Runtime.withFrame,Runtime.pushScope,Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,
  LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?])

theorem execution (n : Nat) (c : Context) (r : Runtime) (x y d : Nat)
    (hx : x < R) (hy : y < R) (hd : d < R) (pos : 0 < d) (fits : x*y < R) :
    Stmt.eval (n+12) Inv32Dispatch.model.core.table c (scope r x y d) Inv32Bodies.Floor.body =
      pure (.returned (scope r x y d) [.word (x*y/d)]) := by
  let t := Inv32Dispatch.model.core.table
  let outside := (scope r x y d).pushScope
  let inner := outside.pushScope
  let uncheckedCtx := {c with checked := false}
  let finished := state inner x y (x*y/R) (x*y%R) (x*y/R) (x*y%R)
  let vs := [Value.word (x*y/d)]
  have hi : x*y/R = 0 := Nat.div_eq_of_lt fits
  have lo : x*y%R = x*y := Nat.mod_eq_of_lt fits
  have branch : Stmt.eval (n+8) t uncheckedCtx finished firstBranch = pure (.returned finished vs) := by
    apply Inv32FloorNarrow.run (n+5) t uncheckedCtx finished (x*y) d fits hd pos
    · change some (x*y%R) = some (x*y); rw [lo]
    · rfl
    · change some (x*y/R) = some 0; rw [hi]
  have ss : Stmt.evalList (n+8) t uncheckedCtx inner.pushScope (start ++ firstBranch :: rest) =
      pure (.returned finished vs) := by
    rw [runPrefix (n+6) uncheckedCtx inner x y hx hy rfl rfl _ (by omega)]
    exact stop _ _ _ _ _ _ _ _ branch
  have inside := blockReturned _ t uncheckedCtx inner finished _ vs ss
  have un : Stmt.eval (n+10) t c inner (.unchecked (.block (start ++ firstBranch :: rest))) =
      pure (.returned finished.popScope vs) := by rw [Stmt.eval]; exact inside
  have body := blockReturned _ t c outside _ _ vs (stop _ _ _ _ _ _ [] _ un)
  rw [shape]
  apply blockReturned (n+11) t c _ outside _ vs
  have A := cleanParamExec (n+10) t c outside "x" x hx rfl (by dsimp [outside]; write_param)
  have B := cleanParamExec (n+10) t c outside "y" y hy rfl (by dsimp [outside]; write_param)
  have D := cleanParamExec (n+10) t c outside "denominator" d hd rfl (by dsimp [outside]; write_param)
  have sk : Stmt.eval (n+11) t c outside .skip = pure (.normal outside) := by rw [Stmt.eval]
  rw [seqStep _ _ _ _ _ _ _ A,seqStep _ _ _ _ _ _ _ B,seqStep _ _ _ _ _ _ _ D,seqStep _ _ _ _ _ _ _ sk]
  exact stop _ _ _ _ _ _ [] _ body
end Inv32FloorFastPath
