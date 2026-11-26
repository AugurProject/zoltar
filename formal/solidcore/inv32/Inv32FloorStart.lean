import Inv32Temps
import Inv32ExactFloor
open SolidCore.Solidity.Source Inv32Division
namespace Inv32FloorStart
abbrev hi := "_ret___library_Math_mul512_0"
abbrev lo := "_ret___library_Math_mul512_1"
abbrev av := "_ic_arg_0"
abbrev bv' := "_ic_arg_1"
def temp (name source : String) : Stmt := .varDecl .uint256 name (some (.castOp .uintCleanup 256 (.var source)))
def start : List Stmt := [
  .varDecl .uint256 "high" none,.varDecl .uint256 "low" none,
  temp av "x",temp bv' "y",.varDecl .uint256 hi none,.varDecl .uint256 lo none,
  .captureReturn [hi,lo] (.internalCall [hi,lo] Inv32Bodies.Mul512.key [.var av,.var bv']),
  .assign (.var "high") (.var hi),.assign (.var "low") (.var lo)]
def instructions : List Stmt := match Inv32Bodies.Floor.body with
  | .block [_,_,_,_,.block [.unchecked (.block ss)]] => ss
  | _ => []
theorem exactPrefix : instructions.take 9 = start := by rfl

def state (r : Runtime) (a b : Nat) (hs ls th tl : Nat) : Runtime :=
  r.withFrame [(lo,.word tl),(hi,.word th),(bv',.word b),(av,.word a),("low",.word ls),("high",.word hs)]
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
theorem seqStep (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (s : Stmt)
    (rest : List Stmt) (run : Stmt.eval n t c r s = pure (.normal next)) :
    Stmt.evalList n t c r (s :: rest) = Stmt.evalList n t c next rest := by
  rw [Stmt.evalList,run,pb]
theorem zero (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name : String) :
    Stmt.eval (n+1) t c r (.varDecl .uint256 name none) = pure (.normal (r.declareLocal name (.word 0))) := by
  rw [Stmt.eval]; dsimp only; rw [Ty.defaultValue]
set_option maxRecDepth 12000
macro "store_temps" : tactic => `(tactic|
  simp [state,hi,lo,av,bv',Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.assignLocal?, Runtime.lookupLocal?,
    Runtime.withFrame,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,
    Frame.lookup?,Frame.assign?,LocalEnv.lookup?,LocalEnv.assign?,Value.coerceLike?])
theorem runPrefix (n : Nat) (c : Context) (r : Runtime) (a b : Nat)
    (ha : a < R) (hb : b < R) (x : r.lookupLocal? "x" = some (.word a))
    (y : r.lookupLocal? "y" = some (.word b)) (rest : List Stmt) (enough : 6 ≤ n) :
    Stmt.evalList (n+2) Inv32Dispatch.model.core.table c r.pushScope (start ++ rest) =
    Stmt.evalList (n+2) Inv32Dispatch.model.core.table c
      (state r a b (a*b/R) (a*b%R) (a*b/R) (a*b%R)) rest := by
  let t := Inv32Dispatch.model.core.table
  let r1 := r.pushScope.declareLocal "high" (.word 0)
  let r2 := r1.declareLocal "low" (.word 0)
  let r3 := r2.declareLocal av (.word a)
  let r4 := r3.declareLocal bv' (.word b)
  let r5 := r4.declareLocal hi (.word 0)
  let r6 := r5.declareLocal lo (.word 0)
  let h := a*b/R
  let l := a*b%R
  have X : r2.lookupLocal? "x" = some (.word a) := x
  have Y : r3.lookupLocal? "y" = some (.word b) := y
  have cap := Inv32Temps.captured n c r6 (state r a b 0 0 h l) av bv' hi lo a b ha hb rfl rfl
    (by dsimp [r6,r5,r4,r3,r2,r1,h,l]; store_temps) enough
  have H := Inv32Temps.copy (n+1) t c (state r a b 0 0 h l) (state r a b h 0 h l)
    "high" hi 0 h rfl rfl (by store_temps)
  have L := Inv32Temps.copy (n+1) t c (state r a b h 0 h l) (state r a b h l h l)
    "low" lo 0 l rfl rfl (by store_temps)
  simp only [start,List.cons_append,List.nil_append,temp]
  rw [seqStep _ _ _ _ _ _ _ (zero _ _ _ _ _),seqStep _ _ _ _ _ _ _ (zero _ _ _ _ _),
      seqStep _ _ _ _ _ _ _ (Inv32Temps.temp _ _ _ _ _ _ _ ha X),
      seqStep _ _ _ _ _ _ _ (Inv32Temps.temp _ _ _ _ _ _ _ hb Y),
      seqStep _ _ _ _ _ _ _ (zero _ _ _ _ _),seqStep _ _ _ _ _ _ _ (zero _ _ _ _ _),
      seqStep _ _ _ _ _ _ _ cap,seqStep _ _ _ _ _ _ _ H,seqStep _ _ _ _ _ _ _ L]
end Inv32FloorStart
