import Inv45TickSuffix
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Scalar
open Bytes
theorem textRun (fuel : Nat) (c : Context) (r : Runtime) (v : Int) (k d n unitId : Nat) (unit : List Nat)
    (V : Signed.inRange v) (K : k<R) (D : d<R) (N : n<R) (pos : 0<n) (len : unit.length<R) (sane : ∀ch∈unit,ch<256)
    (U : Ref r "unit" unitId unit) (unitBound : unitId<r.nextMemory) (scalar : r.lookupLocal? "scalarValue"=some (.int (Signed.word v)))
    (pay : r.lookupLocal? "payout"=some (.word k)) (delta : r.lookupLocal? "diffU"=some (.word d))
    (ticks : r.lookupLocal? "numTicks"=some (.word n)) (cap : c.memoryAllocationLimit?=none) :
    ∃after id, Retains r after ∧ id<after.nextMemory ∧ after.loadMemory? id=some (.bytes (Text.label v unit n (Scale.tag d n k))) ∧
      Stmt.evalList (fuel+100) model.core.table c r (textSteps.map Pattern.value)=pure (.returned after [.memoryRef id]) := by
  let t := model.core.table
  let a := allocate r []
  have blank := Bytes.blank (fuel+99) t c r Format.temp0
  obtain ⟨x,id,read,oldB,cell,format⟩ := Format.fetchFormatted (fuel+2) c a r.nextMemory v
    ((lookupDecl a _ _ _ (by decide)).trans scalar) V cap
  let b := (localsOf x a).declareLocal Format.temp0 (.memoryRef id)
  let label := b.declareLocal "label" (.memoryRef id)
  have aliasExec := Bytes.aliasExec (fuel+99) t c b "label" Format.temp0 id (declarePtr _ _ _)
  have retainB : Retains r b := Bytes.trans (allocated r []) ⟨read.state,read.next,read.memory⟩
  have u : Ref b "unit" unitId unit := ⟨(lookupDecl (localsOf x a) _ _ _ (by decide)).trans U.pointer,(retainB.memory _ unitBound).trans U.cell⟩
  have bsSane : ∀ch∈Text.signed v,ch<256 := by
    intro ch h;unfold Text.signed at h;split at h
    · rcases List.mem_cons.mp h with sign|digit
      · omega
      · have := Text.allowed v.natAbs ch digit;omega
    · have := Text.allowed v.natAbs ch h;omega
  obtain ⟨z,labId,retainZ,zBound,zCell,unitRun⟩ := appendUnit (fuel+98) c b id unitId _ unit cell oldB bsSane sane len u
  let core := localsOf z b
  let s := core.declareLocal "label" (.memoryRef labId)
  have stable : Retains r core := Bytes.trans retainB ⟨retainZ.state,retainZ.next,retainZ.memory⟩
  have outer (key : String) (different : key≠Format.temp0) : core.lookupLocal? key=r.lookupLocal? key :=
    lookupDecl (localsOf x a) _ _ _ different
  have cond := tagRead c s k d n K D N pos
    ((lookupDecl core _ _ _ (by decide)).trans ((outer _ (by decide)).trans pay))
    ((lookupDecl core _ _ _ (by decide)).trans ((outer _ (by decide)).trans delta))
    ((lookupDecl core _ _ _ (by decide)).trans ((outer _ (by decide)).trans ticks))
  let afterUnit := Text.signed v++Text.unitBytes unit
  have labelSane : ∀ch∈afterUnit,ch<256 := by
    intro ch h;rcases List.mem_append.mp h with first|second
    · exact bsSane _ first
    · by_cases empty : unit=[]
      · simp [Text.unitBytes,empty] at second
      · simp only [Text.unitBytes,if_neg empty,List.mem_cons] at second
        rcases second with space|inUnit
        · omega
        · exact sane _ inUnit
  have tagged : ∃endR out,Retains r endR ∧ out<endR.nextMemory ∧
      endR.loadMemory? out=some (.bytes (Text.label v unit n (Scale.tag d n k))) ∧
      Stmt.eval (fuel+100) t c s (Stmt_ifElse tagCond (block tagSteps) Stmt_skip).value=pure (.normal endR) ∧
      endR.lookupLocal? "label"=some (.memoryRef out) := by
    by_cases tag : d<n ∧ k*d%n≠0
    · rw [if_pos tag] at cond
      obtain ⟨w,out,keep,bound,stored,run⟩ := suffixRun (fuel+5) c core labId k n afterUnit zBound zCell labelSane
        ((outer _ (by decide)).trans pay) ((outer _ (by decide)).trans ticks) K N cap
      let dst := (localsOf w core).declareLocal "label" (.memoryRef out)
      have br := Inv32Blocks.branch (fuel+99) t c s _ (block tagSteps).value .skip true (cond _ (by decide))
      refine ⟨dst,out,Bytes.trans stable ⟨keep.state,keep.next,keep.memory⟩,bound,?_,br.trans run,declarePtr _ _ _⟩
      simpa [Text.label,Scale.tag,tag,afterUnit,List.append_assoc] using stored
    · rw [if_neg tag] at cond
      have skip := MulDiv.branchFalse (fuel+99) t c s (block tagSteps) Stmt_skip _ cond
      refine ⟨s,labId,⟨stable.state,stable.next,stable.memory⟩,zBound,?_,skip.trans ?_,declarePtr _ _ _⟩
      · simpa [Text.label,Scale.tag,tag,Text.suffix] using zCell
      · rw [show Stmt_skip.value=Stmt.skip from rfl,Stmt.eval]
  obtain ⟨after,out,keep,bound,stored,tagged,localOut⟩ := tagged
  refine ⟨after,out,keep,bound,stored,?_⟩
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ blank).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ format).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ aliasExec).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ unitRun).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ tagged).trans
  exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ (retRef (fuel+99) t c after "label" out localOut)
end Inv45.Scalar
