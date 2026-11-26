import Inv32CeilHoist

open SolidCore.Solidity.Source Inv32FloorHoist Inv32Hoist Inv32FloorStart Inv32CeilFlags Inv32CeilHoist
namespace Inv03.Hoist

def arguments (ex ey ed em : Expr) (dest : String) : List Stmt := [
  .varDecl .uint256 a0 (some ex),.varDecl .uint256 a1 (some ey),
  .varDecl .uint256 a2 (some ed),.varDecl .uint256 a3 (some em),.varDecl .uint256 dest none]
def code (key dest : String) (ex ey ed em : Expr) := Stmt.block (arguments ex ey ed em dest ++ [
  .captureReturn [dest] (.internalCall [dest] key [.var a0,.var a1,.var a2,.var a3]),
  .assign (.var h0) (.var dest)])
def frame (r : Runtime) (dest : String) (out x y d m v : Nat) :=
  ((st3 r h0 out x y d).declareLocal a3 (.word m)).declareLocal dest (.word v)
theorem run (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (key dest : String)
    (ex ey ed em : Expr) (x y d m v : Nat) (args : Inputs c r h0 ex ey ed x y d)
    (M : em.eval c (st3 r h0 0 x y d) = pure (.word m,st3 r h0 0 x y d))
    (distinct : dest ≠ h0)
    (call : Stmt.eval (n+1) t c (frame r dest 0 x y d m 0)
      (.internalCall [dest] key [.var a0,.var a1,.var a2,.var a3]) =
      internalCallAssign (frame r dest 0 x y d m 0) [dest] [.word v]) :
    Stmt.eval (n+3) t c (Inv32OneArg.store r h0 0) (code key dest ex ey ed em) =
      pure (.normal (Inv32OneArg.store r h0 v)) := by
  let st := fun o v => frame r dest o x y d m v
  have put : (st 0 0).assignLocal? dest (.word v) = some (st 0 v) := by
    cases H : r.locals <;> dsimp [st,frame] <;> write_temps
  have picked := takeReturn _ _ _ _ _ _ _ _ _ call put
  have copy : Stmt.evalList (n+2) t c (st 0 v) [.assign (.var h0) (.var dest)] =
      pure (.normal (st v v)) := by
    apply lastCopy _ _ _ _ _ _ _ 0 v
    all_goals cases H : r.locals <;> dsimp [st,frame,a3,h0] <;> write_temps
  apply block _ _ _ _ (st v v)
  refine (seqStep _ _ _ _ _ _ _ (declEval (n+1) t c _ _ _ _ _ args.1 (by rw [Ty.coerceValue?]))).trans ?_
  refine (seqStep _ _ _ _ _ _ _ (declEval (n+1) t c _ _ _ _ _ args.2.1 (by rw [Ty.coerceValue?]))).trans ?_
  refine (seqStep _ _ _ _ _ _ _ (declEval (n+1) t c _ _ _ _ _ args.2.2 (by rw [Ty.coerceValue?]))).trans ?_
  refine (seqStep _ _ _ _ _ _ _ (declEval (n+1) t c _ _ _ _ _ M (by rw [Ty.coerceValue?]))).trans ?_
  exact (seqStep _ _ _ _ _ _ _ (zero (n+1) t c _ dest)).trans ((seqStep _ _ _ _ _ _ _ picked).trans copy)
end Inv03.Hoist
