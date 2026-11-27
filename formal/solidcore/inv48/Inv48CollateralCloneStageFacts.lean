import Inv48CollateralCloneStageRecover
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CollateralCloneStage
open Inv48.CollateralMinimum Inv48.CloneRead Inv48.CloneGetters
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

/-- Original canonical code/config assumptions, at the actual helper caller.
No recovered runtime equality or successful helper execution is assumed. -/
structure Deployment (c : Context) (caller : Runtime) where
  implementation : List Nat
  universeBytes : List Nat
  token : List Nat
  hi : implementation.length = 20
  hu : universeBytes.length = 31
  ht : token.length = 20
  cu : ∀ b ∈ universeBytes, b < 256
  ct : ∀ b ∈ token, b < 256
  selfFit : c.self < Inv48.SymbolicClone.R
  code : caller.state.envAccountCode c c.self = runtimeCode implementation universeBytes token
  root : Nat
  field : ImmutableField
  found : c.immutableField? "securityPool" = some field
  stored : caller.state.immutable? "securityPool" = some (.word root)
  coercion : field.ty.coerceValue? (.word root) = some (.word root)
  rootFit : root < Inv32Division.R
  away : wordEq root c.self = false

def bytes (d : Deployment c caller) := Inv12.wireBytes 2603245787 [decode d.universeBytes]

/-- The precise frame, heap allocation and world facts used at the suspension. -/
structure Facts (s : Slice trace out) (d : Deployment s.context s.caller) : Prop where
  prefixEmpty : s.prefixTrace = []
  sourceLocal : s.start.lookupLocal? universeView = some (.word (decode d.universeBytes))
  locals : s.start.locals = [[(tmp,.word 0),(universeView,.word (decode d.universeBytes)),
    (tmp,.word (decode d.universeBytes))],[],[],[("_ret0",.word 0)]]
  world : s.start.state = s.caller.state
  scratch : s.start.scratch = s.caller.scratch
  nextMemory : s.start.nextMemory = s.caller.nextMemory+1
  nextMemoryByte : s.start.nextMemoryByte = s.caller.nextMemoryByte+128
  memory : s.start.loadMemory? s.caller.nextMemory =
    some (.bytes (runtimeCode d.implementation d.universeBytes d.token))

theorem facts (s : Slice trace out) (d : Deployment s.context s.caller)
    (enough : 46 ≤ s.n) : Facts s d := by
  have entry := s.entry
  have inner : s.inner = scalarFrame s.caller := by
    simpa [internalCallEnter?,InternalFunction.initialFrame?,aggregateFn,
      InternalFunction.returnDefaultBindings,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,
      Ty.defaultValue,scalarFrame] using (congrArg (Option.map Prod.fst) entry).symm
  obtain ⟨n,eq⟩ := Nat.exists_eq_add_of_le' enough
  have run := s.prefixRun
  rw [eq,inner,prefixPure n s.context (scalarFrame s.caller).pushScope.pushScope.pushScope d.implementation d.universeBytes d.token
    d.hi d.hu d.ht d.cu d.ct d.selfFit d.code] at run
  have pureResult {a : Result} {tr : Interaction.Transcript} {b : Result}
      (h : Interaction.Executes (pure a : SolI Result) tr (.ok b)) : tr = [] ∧ b = a := by
    cases h
    exact ⟨rfl,rfl⟩
  obtain ⟨empty,same⟩ := pureResult run
  have start : s.start = oracleStage (scalarFrame s.caller).pushScope.pushScope.pushScope
      (runtimeCode d.implementation d.universeBytes d.token) (decode d.universeBytes) := Result.normal.inj same
  constructor
  · exact empty
  · rw [start]
    simp [oracleStage,universeStage,Inv48.ExposureHeap.oracleEntry,scalarFrame,post,
      Runtime.allocMemory,Runtime.declareLocal,LocalEnv.declare,Runtime.pushScope,
      Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,tmp,Inv03.Bodies.tmp,
      Inv32CeilFlags.h0,universeView]
  · rw [start]
    simp [oracleStage,universeStage,scalarFrame,post,Runtime.allocMemory,
      Runtime.declareLocal,LocalEnv.declare,Runtime.pushScope]
  · rw [start]; rfl
  · rw [start]; rfl
  · rw [start]; rfl
  · rw [start]
    simpa [oracleStage,universeStage,Runtime.declareLocal,Runtime.pushScope,scalarFrame] using
      canonical_memory_bytes s.caller d.implementation d.universeBytes d.token d.hi d.hu d.ht
  · rw [start]
    simp [oracleStage,universeStage,scalarFrame,post,Runtime.allocMemory,
      Runtime.declareLocal,Runtime.pushScope,Runtime.loadMemory?,MemoryMap.lookup?,MemoryMap.insertLoop]

theorem bindings (s : Slice trace out) (d : Deployment s.context s.caller)
    (enough : 46 ≤ s.n) :
    (Inv48.Minima.oracleData 2603245787 universeView).evalWithRuntimeByContext s.context s.start =
      .ok (.bytes (bytes d),s.start) ∧
    (Expr.immutable "securityPool").evalWithRuntimeByContext s.context s.start =
      .ok (.word d.root,s.start) := by
  have f := facts s d enough
  exact ⟨Inv48.Minima.oracleCalldata s.context s.start _ _ _ (by decide)
      (universe_bounds _ d.hu d.cu) f.sourceLocal,
    Inv48.Minima.immutableRead s.context s.start _ d.field d.root d.found
      (by rw [f.world]; exact d.stored) d.coercion⟩
end Inv48.CollateralCloneStage
