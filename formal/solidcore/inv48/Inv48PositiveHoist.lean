import Inv32FloorOverflow
open SolidCore.Solidity.Source Inv32Division Inv32Actions
namespace Inv48.PositiveHoist
theorem block (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (ss : List Stmt)
    (run : Stmt.evalList n t c r.pushScope ss = pure (.normal next)) :
    Stmt.eval (n+1) t c r (.block ss) = pure (.normal next.popScope) := by
  rw [Stmt.eval]; dsimp only; rw [run]; rfl

theorem lastCopy (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (dst src : String) (old v : Nat)
    (D : r.lookupLocal? dst = some (.word old)) (S : r.lookupLocal? src = some (.word v))
    (up : r.assignLocal? dst (.word v) = some next) :
    Stmt.evalList (n+1) t c r [.assign (.var dst) (.var src)] = pure (.normal next) :=
  (Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32Temps.copy _ _ _ _ _ _ _ _ _ D S up)).trans (by rw [Stmt.evalList])

theorem takeReturn (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (tmp : String)
    (key : String) (args : List Expr) (v : Nat)
    (ev : Stmt.eval n t c r (.internalCall [tmp] key args) = internalCallAssign r [tmp] [.word v])
    (up : r.assignLocal? tmp (.word v) = some next) :
    Stmt.eval (n+1) t c r (.captureReturn [tmp] (.internalCall [tmp] key args)) = pure (.normal next) := by
  apply Inv32Internal.capture
  rw [ev]; simp [internalCallAssign,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,up]

theorem declEval (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (s : String)
    (ty : Ty) (e : Expr) (v : Nat) (read : Expr.eval c r e = pure (.word v,r))
    (valid : ty.coerceValue? (.word v) = some (.word v)) :
    Stmt.eval (n+1) t c r (.varDecl ty s (some e)) = pure (.normal (r.declareLocal s (.word v))) := by
  rw [Stmt.eval]; dsimp only; rw [read]
  change (match ty.coerceValue? (.word v) with
    | some k => (pure (.normal (r.declareLocal s k)) : SolI Result)
    | none => pure (.reverted r .typeMismatch)) = _
  rw [valid]
theorem boolCoerce (b : Bool) : Ty.bool.coerceValue? (.word (boolWord b)) = some (.word (boolWord b)) := by cases b <;> rfl
theorem zeroBool (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (s : String) :
    Stmt.eval (n+1) t c r (.varDecl .bool s none) = pure (.normal (r.declareLocal s (.word 0))) := by
  rw [Stmt.eval]; dsimp only; rw [Ty.defaultValue]
end Inv48.PositiveHoist
