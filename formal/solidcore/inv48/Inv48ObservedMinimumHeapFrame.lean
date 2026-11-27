import Inv48ObservedMinimumHeapRound
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedMinimumHeap
open Inv48.Positive Inv48.MinimumOperandTransport Inv48.MinimumRepOperand
open Inv48.MinimumSuccessWords Inv48.CollateralReturnedMinimum
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

def heap (r : Runtime) := (r.memory,r.nextMemory)
def cache (r : Runtime) (code : List Nat) := (r.allocMemory (.bytes code)).1

theorem cacheHeap (r t : Runtime) (code : List Nat) (h : heap r = heap t) :
    heap (cache r code) = heap (cache t code) := by
  have m : r.memory = t.memory := congrArg Prod.fst h
  have n : r.nextMemory = t.nextMemory := congrArg Prod.snd h
  simp [heap,cache,Runtime.allocMemory,m,n]

theorem collateralStart (s : Inv48.CollateralCloneStage.Slice trace out)
    (d : Inv48.CollateralCloneStage.Deployment s.context s.caller) :
    heap s.start = heap (cache s.caller (Inv48.CloneRead.runtimeCode d.implementation d.universeBytes d.token)) := by
  have entry := s.entry
  have inner : s.inner = Inv48.CollateralMinimum.scalarFrame s.caller := by
    simpa [internalCallEnter?,InternalFunction.initialFrame?,Inv48.CollateralMinimum.aggregateFn,
      InternalFunction.returnDefaultBindings,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,
      Ty.defaultValue,Inv48.CollateralMinimum.scalarFrame] using (congrArg (Option.map Prod.fst) entry).symm
  have run := Inv48.CollateralCloneFuel.replayList (Nat.le_add_right s.n 46) _ _ _ _ _ _ s.prefixRun
  rw [inner,Inv48.CollateralCloneStage.prefixPure s.n s.context
    (Inv48.CollateralMinimum.scalarFrame s.caller).pushScope.pushScope.pushScope d.implementation d.universeBytes d.token
    d.hi d.hu d.ht d.cu d.ct d.selfFit d.code] at run
  have eq := Result.normal.inj (pureResult run).2
  rw [eq]
  rfl

theorem collateralCaller (s : Inv48.MinimumOperandTransport.Collateral path)
    (shape : path.guarded = saved (root base p) h0 0) :
    heap s.cut.caller = heap base := by
  have run := s.cut.declareRun
  simp only [shape,Stmt.evalList,Inv48.CloneGetters.decl_none] at run
  simp only [Ty.defaultValue,pure_bind,Stmt.evalList] at run
  have eq := Result.normal.inj (pureResult run).2
  rw [eq]
  rfl

theorem repCaller (s : Inv48.MinimumRepOperand.Rep path)
    (shape : path.collateral = collateralPost post base p C) :
    heap s.stage.cut.caller = heap post := by
  have run := s.stage.declareRun
  simp only [shape,Stmt.evalList,Inv48.CloneGetters.decl_none] at run
  simp only [Ty.defaultValue,pure_bind,Stmt.evalList] at run
  have declared := Result.normal.inj (pureResult run).2
  have run := s.stage.cut.declareRun
  simp only [declared,Stmt.evalList,Inv48.CloneGetters.decl_none] at run
  simp only [Ty.defaultValue,pure_bind,Stmt.evalList] at run
  have eq := Result.normal.inj (pureResult run).2
  rw [eq]
  rfl

/-- The observed getter adopts oracle worlds but retains the old heap. Both
code caches are fresh allocations; every intervening caller scope is scalar. -/
theorem bodyHeap (s : Body n c base p trace out) (hp : p<Inv32Division.R)
    (dC : Inv48.CollateralCloneStage.Deployment s.observed.collateral.joined.context s.observed.collateral.joined.caller)
    (b : BaseDeployment s.observed.collateral.joined)
    (envC : CanonicalOracle s.observed.collateral.joined.context s.observed.collateral.joined.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) s.observed.collateral.joined.during)
    (dR : Inv48.RepReturnedMinimum.Deployment s.observed.rep.joined.context s.observed.rep.joined.caller)
    (envR : CanonicalOracle s.observed.rep.joined.context s.observed.rep.joined.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) s.observed.rep.joined.during) :
    ∃ final words, out = .returned final words ∧
      heap final = heap (cache (cache base (Inv48.CloneRead.runtimeCode dC.implementation dC.universeBytes dC.token))
        (Inv48.CloneRead.runtimeCode dR.implementation dR.universeBytes dR.token)) := by
  let o := s.observed
  obtain ⟨cr,x,rest,event,success,xf,xd,X,xm,xn⟩ := collateralRead o.collateral.joined.toSlice dC envC
  have ch := tailOperands o.collateral.joined b x xf X
  have cstart := collateralStart o.collateral.joined.toSlice dC
  have ccaller : heap o.collateral.joined.caller = heap base := by
    rw [o.collateral.joined.callerEq,baseRecovered o.collateral.joined b]
    change heap o.collateral.joined.baseStart = heap base
    exact (Prod.ext s.memory s.nextMemory).trans
      (collateralCaller o.collateral (guarded o.path hp o.positive))
  have cm : heap o.collateral.joined.tailStart = heap (cache base
      (Inv48.CloneRead.runtimeCode dC.implementation dC.universeBytes dC.token)) := by
    calc
      _ = heap o.collateral.joined.final := Prod.ext ch.1 ch.2
      _ = heap o.collateral.joined.start := Prod.ext xm xn
      _ = heap (cache o.collateral.joined.caller _) := cstart
      _ = _ := cacheHeap _ _ _ ccaller
  obtain ⟨_,_,C,_,_,_,_,_,Cf,_,_,cp,_,_⟩ := finishCollateral o.path o.collateral hp o.positive dC b envC
  obtain ⟨rr,y,_,_,yf,_,Y,ym,yn⟩ := repRead o.rep.joined dR envR
  have rstart := Inv48.RepReturnedMinimum.startRecovered o.rep.joined dR
  have rm : heap o.rep.joined.final = heap (cache (cache base
      (Inv48.CloneRead.runtimeCode dC.implementation dC.universeBytes dC.token))
      (Inv48.CloneRead.runtimeCode dR.implementation dR.universeBytes dR.token)) := by
    have rc : heap o.rep.joined.caller = heap (cache base
        (Inv48.CloneRead.runtimeCode dC.implementation dC.universeBytes dC.token)) := by
      rw [s.repCaller]
      exact (repCaller o.rep cp).trans cm
    calc
      _ = heap o.rep.joined.start := Prod.ext ym yn
      _ = heap (cache o.rep.joined.caller _) := by rw [rstart]; rfl
      _ = _ := cacheHeap _ _ _ rc
  obtain ⟨_,_,R,_,_,_,_,_,Rf,_,_,rp,_,_,_⟩ := finishRep o.path o.rep cp dR envR
  obtain ⟨final,_,_,_,_,value,fh⟩ := Inv48.ObservedMinimumHeap.roundFinish o.path o.rounded rp hp Cf Rf o.positive
  refine ⟨final.popScope.popScope,[.word (max C (Inv03.ceilQuot (R*10^18) p))],?_,?_⟩
  · rw [o.path.originalResult,value]; rfl
  · exact fh.trans rm
end Inv48.ObservedMinimumHeap
