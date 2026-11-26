import Inv44Storage
import Inv44Update
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv44
def counted (r : Runtime) (n m : Nat) := ((r.withFrame (frame m)).pushScope.pushScope).declareLocal "count" (.word n)
def indexed (r : Runtime) (n i m : Nat) := (counted r n m).pushScope.declareLocal "index" (.word i)
def working (r : Runtime) (n i m : Nat) := (indexed r n i m).pushScope
def wordLengths (c : Context) (s : State) := ∀ i, i<count s → (s.envAccountCode c (address s i)).length<R
macro "write_oracle" : tactic => `(tactic|
  simp [working,indexed,counted,frame,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,
    Runtime.pushScope,Runtime.withFrame,LocalEnv.declare,LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,
    Frame.assign?,Value.coerceLike?])

theorem codeTest (c : Context) (r : Runtime) (i : Nat) (fields : c.storageFields=model.core.context.storageFields)
    (bound : count r.state<R) (inside : i<count r.state) (ix : r.lookupLocal? "index"=some (.word i)) (codeFit : wordLengths c r.state) :
    condition.value.eval c r=pure (.word (boolWord (hasCode c r.state i)),r) := by
  let bs := r.state.envAccountCode c (address r.state i)
  have size := byteLength c r i fields bound inside ix
  have gt : Source.BinaryOp.apply c.checked .gt (.word bs.length) (.word 0) = .ok (.word (boolWord (!bs.isEmpty))) := by
    change Source.BinaryOp.apply false .gt _ _ = _
    rw [Inv32WideGuards.gtWord bs.length 0 (codeFit i inside) (by decide)]
    cases bs <;> simp [boolWord]
  exact Inv08.ReleaseQuote.binary (Inv08.ReleaseQuote.readClean size (codeFit i inside))
    (Inv08.Authority.literal c r 0 (by decide)) .gt (by intro h;cases h) (by intro h;cases h) gt _ (Nat.le_succ _)

theorem more (c : Context) (r : Runtime) (i n : Nat) (ix : r.lookupLocal? "index"=some (.word i))
    (ct : r.lookupLocal? "count"=some (.word n)) (hi : i<R) (hn : n<R) :
    loopTest.value.eval c r=pure (.word (if i<n then 1 else 0),r) :=
  Inv08.ReleaseQuote.binary (Inv08.ReleaseQuote.readClean (Inv08.localReads c r _ _ ix) hi)
    (Inv08.ReleaseQuote.readClean (Inv08.localReads c r _ _ ct) hn) .lt (by intro h;cases h) (by intro h;cases h)
    (Inv32QuoteExpr.lt _ _ _ hi hn) _ (Nat.le_succ _)

theorem iteration (fuel : Nat) (c : Context) (r : Runtime) (i : Nat) (fields : c.storageFields=model.core.context.storageFields)
    (cap : count r.state≤256) (inside : i<count r.state) (size : wordLengths c r.state) :
    let n := count r.state
    let p := hasCode c r.state
    work.value.eval (fuel+4) model.core.table c (working r n i (mask p i))=pure (.normal (working r n i (mask p (i+1)))) := by
  let n := count r.state
  let p := hasCode c r.state
  let old := mask p i
  let src := working r n i old
  have H : i<256 := inside.trans_le cap
  have ok := codeTest c src.pushScope i fields (lt_of_le_of_lt cap (by decide)) inside rfl size
  have branch := Inv32Blocks.branch (fuel+2) model.core.table c src.pushScope condition.value (Inv03.Bodies.block [setBit]).value .skip (p i) ok
  change work.value.eval (fuel+4) model.core.table c src=pure (.normal (working r n i (mask p (i+1))))
  by_cases active : p i = true
  · have bound : old<R := (fits p i).trans_le (Nat.pow_le_pow_right (by decide) H.le)
    let out := working r n i (old ||| 2^i)
    have w := includeBit fuel c src.pushScope.pushScope out.pushScope.pushScope i old rfl rfl H bound (by dsimp [src,out];write_oracle)
    have leaf := Inv32Blocks.one (fuel+1) model.core.table c src.pushScope out.pushScope.pushScope setBit.value w
    rw [if_pos active] at branch
    have cond : (Stmt.ifElse condition.value (Inv03.Bodies.block [setBit]).value .skip).eval (fuel+3) model.core.table c src.pushScope=pure (.normal out.pushScope) :=
      branch.trans leaf
    have run := Inv32Blocks.one (fuel+3) model.core.table c src out.pushScope _ cond
    simpa only [mask,active,if_true] using run
  · rw [if_neg active] at branch
    have run := Inv32Blocks.one (fuel+3) model.core.table c src src.pushScope _ (branch.trans (by rw [Stmt.eval]))
    simpa only [mask,active,if_false] using run

theorem scan (fuel remaining i : Nat) (c : Context) (r : Runtime) (fields : c.storageFields=model.core.context.storageFields)
    (cap : count r.state≤256) (left : i+remaining=count r.state) (size : wordLengths c r.state) :
    let n := count r.state
    let p := hasCode c r.state
    Stmt.evalFor (fuel+5+remaining) model.core.table c (working r n i (mask p i)) loopTest.value step.value work.value =
      pure (.normal (working r n n (mask p n))) := by
  induction remaining generalizing i with
  | zero =>
    have endAt : i=count r.state := by omega
    subst i
    dsimp only
    simp only [Nat.add_zero]
    have f : count r.state<R := lt_of_le_of_lt cap (by decide)
    rw [Stmt.evalFor,more c _ (count r.state) (count r.state) rfl rfl f f,if_neg (Nat.lt_irrefl _)]
    rfl
  | succ k ih =>
    let n := count r.state
    let p := hasCode c r.state
    let src := working r n i (mask p i)
    let middle := working r n i (mask p (i+1))
    let next := working r n (i+1) (mask p (i+1))
    have inside : i<n := by dsimp [n];omega
    have nf : n<R := lt_of_le_of_lt cap (by decide)
    have test := more c src i n rfl rfl (inside.trans nf) nf
    rw [if_pos inside] at test
    change Stmt.evalFor (fuel+5+(k+1)) model.core.table c src loopTest.value step.value work.value=_
    rw [show fuel+5+(k+1)=(fuel+5+k)+1 by omega, Stmt.evalFor,test]
    change (do match ← work.value.eval (fuel+5+k) model.core.table c src with
               | .normal mid | .continued mid => do
                 match ← step.value.eval (fuel+5+k) model.core.table c mid with
                 | .normal posted => Stmt.evalFor (fuel+5+k) model.core.table c posted loopTest.value step.value work.value
                 | res=>pure res
               | .broke rt=>pure (.normal rt) | res=>pure res)=_
    have act := iteration (fuel+k+1) c r i fields cap inside size
    rw [show fuel+k+1+4=fuel+5+k by omega] at act
    change work.value.eval _ _ _ src=pure (.normal middle) at act
    have inc := increment (fuel+k+4) c middle next i rfl (inside.trans_le cap) (by dsimp [middle,next];write_oracle)
    rw [show fuel+k+4+1=fuel+5+k by omega] at inc
    rw [act];simp only [Inv08.Authority.bindPure,inc]
    exact ih (i+1) (by omega)
end Inv44
