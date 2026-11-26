import Inv39MarkerSuffixConversion
import Inv39MarkerSuffixEffects
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Init.Marker.ActualSuffix
set_option maxHeartbeats 4000000

theorem advance (n : Nat) (c : Context) (r next : Runtime) (s : Source.Stmt) (ss : List Source.Stmt) (out : Result)
    (step : Stmt.eval n model.core.table c r s=pure (.normal next))
    (run : (Stmt.evalList n model.core.table c r (s::ss)).runWith []=.ok out) :
    (Stmt.evalList n model.core.table c next ss).runWith []=.ok out := by
  rw [Stmt.evalList,step] at run
  exact run

/-- A successful execution of the exact generated suffix derives its footprint.
The premises are input frame/context facts, never an assumed suffix trace or
storage effect. The decimal body and memory bytes are produced by execution. -/
theorem suffix (n : Nat) (c : Context) (marked : Runtime) (result : Result)
    (frames : LocalEnv) (rep : Nat)
    (shape : marked.locals=[]::frames)
    (read : marked.lookupLocal? "repNumber_"=some (.word rep))
    (fields : c.storageFields=model.core.context.storageFields)
    (memory : c.memoryAllocationLimit?=none)
    (run : (Stmt.evalList (n+87) model.core.table c marked value).runWith []=.ok result) :
    Suffix marked.state result.runtime.state := by
  have first := advance (n+87) c marked (empty marked hoist) _ _ result (emptyRun (n+86) c marked hoist) run
  obtain ⟨after,out,next,id,body,decode,same,nextState,nextLocals,cell,conversion⟩ := conversionRun n c marked frames rep shape read memory
  have rest := advance (n+87) c (empty marked hoist) next _ _ result conversion first
  have hoistRead : next.lookupLocal? hoist=some (.memoryRef id) := by
    simp [Runtime.lookupLocal?,nextLocals,LocalEnv.lookup?,Frame.lookup?]
  let numbered := next.declareLocal "number" (.memoryRef id)
  have rest := advance (n+87) c next numbered _ _ result (numberRun (n+86) c next id hoistRead) rest
  have numRead : numbered.lookupLocal? "number"=some (.memoryRef id) := by
    simp [numbered,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,nextLocals,LocalEnv.lookup?,Frame.lookup?]
  have numCell : numbered.loadMemory? id=some (.bytes (Inv45.Decimal.decimal (Shared.norm rep))) := cell
  let named : Runtime := {numbered with state:=numbered.state.storeStorageBytesAt 3 (namePrefix++Inv45.Decimal.decimal (Shared.norm rep))}
  have nameStep := metadataRun (n+86) c numbered namePrefix _ id .name (Or.inl rfl) numRead numCell fields (by decide)
  have rest := advance (n+87) c numbered named _ _ result nameStep rest
  let symbolized : Runtime := {named with state:=named.state.storeStorageBytesAt 4 ([82,69,80]++Inv45.Decimal.decimal (Shared.norm rep))}
  have symbolStep := metadataRun (n+86) c named [82,69,80] _ id .symbol (Or.inr rfl) numRead numCell fields (by decide)
  have rest := advance (n+87) c named symbolized _ _ result symbolStep rest
  have basePath : Suffix marked.state (callee (start marked (Shared.norm rep))).state := Suffix.initial
  have metadataPath := DecimalBound.metadataSuffix (n+84) {c with checked:=true}
    (callee (start marked (Shared.norm rep))) after (Shared.norm rep) (Nat.mod_lt _ (by decide))
    [out] (Inv45.Decimal.decimal (Shared.norm rep)) body ⟨out,rfl,decode⟩ marked.state basePath
  have path : Suffix marked.state symbolized.state := by
    change Suffix marked.state ((next.state.storeStorageBytesAt 3 (namePrefix++Inv45.Decimal.decimal (Shared.norm rep))).storeStorageBytesAt 4 ([82,69,80]++Inv45.Decimal.decimal (Shared.norm rep)))
    rw [nextState]
    exact metadataPath.1
  have all : ∀ s∈tail.drop 3, Frame.StmtPreserves (fun r => Suffix marked.state r.state) model.core.table c s := by
    intro s hs
    simp only [tail,List.drop,List.mem_cons,List.not_mem_nil,or_false] at hs
    rcases hs with rfl|rfl|rfl
    · exact cap marked.state c fields
    · apply event
      intro e he
      simp only [List.mem_cons,List.not_mem_nil,or_false] at he
      subst e
      exact Frame.fieldRead _ _
    · apply event
      intro e he
      simp only [List.mem_cons,List.not_mem_nil,or_false] at he
      rcases he with rfl|rfl|rfl|rfl|rfl
      all_goals first | exact Frame.localRead _ | exact Frame.fieldRead _ _
  exact Frame.selected (Frame.sequence all (n+87) symbolized path) [] result rest
theorem suffixOfBody (f : FunctionDef) (a b c d : Source.Stmt) (ss : List Source.Stmt)
    (found : model.core.findFunctionByName? "initialize"=some f)
    (body : f.body=Repeat.body (a::repGuard::b::c::d::repStore::ss)) : ss=value := by
  obtain ⟨g,a',b',c',d',found',body'⟩ := source
  have eq : g=f := Option.some.inj (found'.symm.trans found)
  subst g
  have extracted := congrArg (fun s => (Repeat.extract s).bind extractSites) (body.symm.trans body')
  change some (a,b,c,d,ss)=some (a',b',c',d',value) at extracted
  exact congrArg (fun x => x.2.2.2.2) (Option.some.inj extracted)

/-- Direct interface for a prefix worker retaining the generated body identity. -/
theorem fromBody (f : FunctionDef) (a b d e : Source.Stmt) (ss : List Source.Stmt)
    (found : model.core.findFunctionByName? "initialize"=some f)
    (body : f.body=Repeat.body (a::repGuard::b::d::e::repStore::ss))
    (c : Context) (marked : Runtime) (result : Result) (frames : LocalEnv) (rep : Nat)
    (shape : marked.locals=[]::frames)
    (read : marked.lookupLocal? "repNumber_"=some (.word rep))
    (fields : c.storageFields=model.core.context.storageFields)
    (memory : c.memoryAllocationLimit?=none)
    (run : (Stmt.evalList 49995 model.core.table c marked ss).runWith []=.ok result) :
    Suffix marked.state result.runtime.state := by
  rw [suffixOfBody f a b d e ss found body] at run
  exact suffix 49908 c marked result frames rep shape read fields memory run
/-- Prefix-worker interface using the REP lookup before its actual store.
The marked frame and lookup are consequences of that store's execution. -/
theorem afterRepStore (f : FunctionDef) (a b d e : Source.Stmt) (ss : List Source.Stmt)
    (found : model.core.findFunctionByName? "initialize"=some f)
    (body : f.body=Repeat.body (a::repGuard::b::d::e::repStore::ss))
    (c : Context) (store marked : Runtime) (result : Result) (frames : LocalEnv) (rep fuel : Nat)
    (shape : store.locals=[]::frames)
    (read : store.lookupLocal? "repNumber_"=some (.word rep))
    (fields : c.storageFields=model.core.context.storageFields)
    (memory : c.memoryAllocationLimit?=none)
    (storeRun : (Stmt.eval (fuel+1) model.core.table c store repStore).runWith []=.ok (.normal marked))
    (run : (Stmt.evalList 49995 model.core.table c marked ss).runWith []=.ok result) :
    Suffix marked.state result.runtime.state := by
  rw [storeExec c store rep fuel fields read] at storeRun
  have eq : marked={store with state:=store.state.storeSlot 7 (Shared.norm rep)} :=
    (Result.normal.inj (Except.ok.inj storeRun)).symm
  subst marked
  exact fromBody f a b d e ss found body c _ result frames rep shape read fields memory run
end Inv39.Init.Marker.ActualSuffix
