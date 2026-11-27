import Inv39DecimalBoundRun
import Inv39DecimalFrame
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv39.DecimalBound
open Inv45 Inv45.Decimal
def fn? := Inv39.model.core.table.lookup? key
theorem present : fn?.isSome := by
  obtain ⟨f,found,_,_,_⟩ := Inv39.Decimal.linked
  change (Inv39.model.core.table.lookup? key).isSome
  rw [found]
  rfl
#check present
def fn := fn?.get present
private theorem tested : body.test fn.body=true := by native_decide
theorem source : fn.body=body.value := body.sound fn.body tested
#check source
theorem prefixRun (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (v : Nat) (V : v<R)
    (after : Runtime) (value : Value)
    (next : Stmt.evalList (n+1) t c (prepared r v).pushScope.pushScope (data.map Pattern.value)=pure (.returned after [value])) :
    Stmt.eval (n+3) t c (entry r v) body.value=pure (.returned after.popScope.popScope [value]) := by
  let s := entry r v
  have set := Inv32FloorFastPath.cleanParamExec (n+1) t c s.pushScope number v V rfl
    (by simp [s,entry,number,Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
  have loc := localize (n+1) t c r v
  have inner := Inv32FloorFastPath.blockReturned (n+1) t c (prepared r v).pushScope after (data.map Pattern.value) [value] next
  apply Inv32FloorFastPath.blockReturned (n+2) t c s after.popScope _
  refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ set).trans ?_;refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ loc).trans ?_
  exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ inner
theorem execution (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (v : Nat) (V : v<R) (cap : c.checkMemoryAllocation (reversed v).length=.ok (reversed v).length) :
    ∃ after out, Bytes.Retains r after ∧ Holds after (decimal v) out ∧
      Stmt.eval (fuel+84) t c (entry r v) fn.body=pure (.returned after [out]) := by
  rw [source]
  by_cases z : v=0
  · subst v
    let a := Bytes.allocate r []
    let src := (prepared r 0).pushScope.pushScope
    have test := MulDiv.eqZero (MulDiv.wordVar c src number 0 (by decide) rfl) (by decide)
    rw [if_pos rfl] at test
    have act : Stmt.eval (fuel+81) t c src (ret (bytesLiteral [48])).value=pure (.returned src [.bytes [48]]) := by
      change Stmt.eval _ _ _ _ (.returnValues [.byteArray [48]])=_
      rw [Stmt.eval];rfl
    have branch := Inv32Blocks.branch (fuel+81) t c src (MulDiv.equalZero (wvar number)).value (ret (bytesLiteral [48])).value
      .skip true (test _ (by decide))
    have ret := Inv32FloorFastPath.stop _ _ _ _ _ _ ((data.map Pattern.value).drop 1) _ (branch.trans act)
    refine ⟨src.popScope.popScope,.bytes [48],?_,?_,prefixRun (fuel+81) _ _ _ _ (by decide) _ _ ret⟩
    · exact ⟨rfl,(Bytes.allocated r []).next,(Bytes.allocated r []).memory⟩
    · exact Holds.direct
  · obtain ⟨m,keep,mem,execute⟩ := positiveData fuel t c r v V (Nat.pos_of_ne_zero z) cap
    let a := Bytes.allocate r []
    let dst := withMemory (Bytes.allocate a (List.replicate (reversed v).length 0)) m
    let s := slots dst r.nextMemory a.nextMemory 0 0
    refine ⟨s.popScope.popScope,.memoryRef a.nextMemory,⟨keep.state,keep.next,keep.memory⟩,.ref (by exact Nat.lt_succ_self _) mem,?_⟩
    exact prefixRun (fuel+81) _ _ _ _ V _ _ execute
end Inv39.DecimalBound
