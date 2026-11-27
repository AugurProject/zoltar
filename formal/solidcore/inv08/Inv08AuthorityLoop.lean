import Inv08AuthorityExpressions
open SolidCore.Solidity.Source Inv32Division Inv03.Bodies
namespace Inv08.Authority
def boundEntry (r : Runtime) (v : Nat) := r.withFrame [("binding",.word v)]
def withOffset (r : Runtime) (v off : Nat) := ((boundEntry r v).pushScope.pushScope).declareLocal "offset" (.word off)
def withCode (c : Context) (r : Runtime) (v : Nat) :=
  ((withOffset (post c r) v 45).pushScope).declareLocal "#extcode" (.memoryRef r.nextMemory)
def counted (c : Context) (r : Runtime) (v i : Nat) := (withCode c r v).declareLocal "#extindex" (.word i)
def working (c : Context) (r : Runtime) (v i w : Nat) := (counted c r v i).declareLocal "#extword" (.word w)
macro "write_clone" : tactic => `(tactic|
  simp [working,counted,withCode,withOffset,boundEntry,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,
    Runtime.pushScope,Runtime.withFrame,LocalEnv.declare,LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,
    Frame.assign?,Value.coerceLike?])
theorem loaded (c : Context) (r : Runtime) (v i w : Nat) :
    MemoryCode (working c r v i w).pushScope (bytes c r) := by
  refine ⟨r.nextMemory,rfl,?_⟩
  change ((r.memory.insert r.nextMemory (.bytes (bytes c r)))[r.nextMemory]?)=_
  exact Std.HashMap.getElem?_insert_self

theorem loopTest (c : Context) (r : Runtime) (i : Nat) (fit : i<R) (ix : r.lookupLocal? "#extindex"=some (.word i)) :
    more.value.eval c r = pure (.word (if i<20 then 1 else 0),r) :=
  ReleaseQuote.binary (ReleaseQuote.readClean (localReads c r _ _ ix) fit) (literal c r 20 (by decide)) .lt
    (by intro h; cases h) (by intro h; cases h) (Inv32QuoteExpr.lt _ _ _ fit (by decide)) _ (Nat.le_succ _)

theorem loopStep (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (i : Nat) (hi : i<20)
    (size : (bytes c r).length=65) :
    let src := working c r 0 i (prefixWord (bytes c r) i)
    let next := working c r 0 (i+1) (prefixWord (bytes c r) (i+1))
    Stmt.eval (n+2) t c src iteration.value = pure (.normal next) := by
  let w := prefixWord (bytes c r) i
  let v := prefixWord (bytes c r) (i+1)
  let src := working c r 0 i w
  let middle := (working c r 0 i v).pushScope
  let finish := (working c r 0 (i+1) v).pushScope
  have word := readNextWord c src.pushScope _ i (loaded _ _ _ _ _) size hi rfl rfl rfl
  have a := Inv32Assign.scalarCast n t c src.pushScope middle "#extword" w v .uintCleanup 256 _ rfl
    (word _ (Nat.le_succ _)) (by dsimp [src,middle]; write_clone)
  have iw := lt_trans hi (by decide : 20<R)
  have nextFit : i+1<R := lt_of_le_of_lt (by omega : i+1≤20) (by decide)
  have index := double (ReleaseQuote.binary (ReleaseQuote.readClean (localReads c middle "#extindex" i rfl) iw)
    (literal c middle 1 (by decide)) .add (by intro h; cases h) (by intro h; cases h)
    (Inv40.addWords c.checked i 1 nextFit)) nextFit
  have b := Inv32Assign.scalarCast n t c middle finish "#extindex" i (i+1) .uintCleanup 256 _ rfl
    (index _ (Nat.le_succ _)) (by dsimp [middle,finish]; write_clone)
  apply Inv32Hoist.block _ _ _ _ finish
  have nilStep : Stmt.evalList (n+1) t c finish [] = pure (.normal finish) := by rw [Stmt.evalList]
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ a).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ b).trans nilStep)

theorem loop (n k i : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (remaining : i+k=20)
    (size : (bytes c r).length=65) :
    let src := working c r 0 i (prefixWord (bytes c r) i)
    let finish := working c r 0 20 (prefixWord (bytes c r) 20)
    Stmt.evalWhile (n+3+k) t c src more.value iteration.value = pure (.normal finish) := by
  induction k generalizing i with
  | zero =>
    have eq : i=20 := by omega
    subst i
    dsimp only
    simp only [Nat.add_zero]
    rw [Stmt.evalWhile,loopTest _ _ 20 (by decide) rfl]
    rfl
  | succ k ih =>
    have hi : i<20 := by omega
    let src := working c r 0 i (prefixWord (bytes c r) i)
    let next := working c r 0 (i+1) (prefixWord (bytes c r) (i+1))
    have test := loopTest c src i (lt_trans hi (by decide)) rfl
    rw [if_pos hi] at test
    dsimp only
    rw [show n+3+(k+1)=(n+3+k)+1 by omega,Stmt.evalWhile,test]
    change (do match ← Stmt.eval (n+3+k) t c src iteration.value with
               | .normal rt | .continued rt => Stmt.evalWhile (n+3+k) t c rt more.value iteration.value
               | .broke rt => pure (.normal rt) | result => pure result) = _
    have step := loopStep (n+k+1) t c r i hi size
    rw [show n+k+1+2=n+3+k by omega] at step
    rw [step]; exact ih (i+1) (by omega)
end Inv08.Authority
