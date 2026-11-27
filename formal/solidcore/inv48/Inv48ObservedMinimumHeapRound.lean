import Inv48ObservedMinimumHeapClones
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedMinimumHeap
open Inv48.RoundedMinimumReturn Inv48.Positive Inv48.MinimumSuffixPath Inv48.MinimumRepOperand Inv32Actions Inv32FloorFastPath
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

def seed (post base : Runtime) : Runtime := { post with locals := base.locals }

theorem roundFinish (path : Path n c r trace out) (s : Rounded path)
    (repEq : path.rep = repPost post base p C R)
    (hp : p < Inv32Division.R) (hc : C < Inv32Division.R)
    (hr : R < Inv32Division.R) (positive : 0<p) :
    ∃ final,
      Inv03.ceilQuot (R*10^18) p < Inv32Division.R ∧
      s.callFinal = roundStage (seed post base) p C R 0 (roundedRep R p) ∧
      s.copied = roundStage (seed post base) p C R (roundedRep R p) (roundedRep R p) ∧
      s.final = phase3 (seed post base) p C R ∧
      path.value = .returned final [.word (max C (Inv03.ceilQuot (R*10^18) p))] ∧ (final.memory,final.nextMemory) = (post.memory,post.nextMemory) := by
  obtain ⟨fit,ev⟩ := call path s repEq hp hr positive
  have callerEq : s.caller = roundStage (seed post base) p C R 0 0 := by
    have eq := roundedCaller path s repEq hp hr
    exact eq
  have assigned : internalCallAssign s.caller [roundRet] [.word (roundedRep R p)] =
      pure (.normal (roundStage (seed post base) p C R 0 (roundedRep R p))) := by
    rw [callerEq]
    simp [internalCallAssign,roundStage,phase2,phase1,root,start,h0,h1,h2,a0,a1,a2,a3,roundRet,
      saved,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.assignLocal?,Runtime.assignLocalRaw?,
      Runtime.lookupLocal?,Runtime.withFrame,Runtime.declareLocal,Runtime.pushScope,
      LocalEnv.declare,Frame.lookup?,Frame.assign?,LocalEnv.lookup?,LocalEnv.assign?,Value.coerceLike?]
  have run := Inv48.CollateralCloneFuel.replay (show n+1 ≤ n+33 by omega) _ _ _ _ _ _ s.callRun
  rw [ev] at run
  change Interaction.Executes (internalCallAssign s.caller [roundRet] [.word (roundedRep R p)]) _ _ at run
  rw [assigned] at run
  have callEq := Result.normal.inj (Inv48.CollateralReturnedMinimum.pureResult run).2
  have copy := Inv48.PositiveHoist.lastCopy (n+1) Inv48.Source.model.core.table c
    (roundStage (seed post base) p C R 0 (roundedRep R p))
    (roundStage (seed post base) p C R (roundedRep R p) (roundedRep R p)) h2 roundRet 0 (roundedRep R p)
    (by round_locals) (by round_locals)
    (by simp [roundStage,phase2,phase1,root,start,h0,h1,h2,a0,a1,a2,a3,roundRet,saved,
      Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,Runtime.withFrame,
      Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,Frame.lookup?,Frame.assign?,
      LocalEnv.lookup?,LocalEnv.assign?,Value.coerceLike?])
  have run := s.copyRun
  rw [callEq,copy] at run
  have copyEq := Result.normal.inj (Inv48.CollateralReturnedMinimum.pureResult run).2
  have finalEq : s.final = phase3 (seed post base) p C R := by rw [s.scope,copyEq]; rfl
  have budget := (rounded_fits_iff R p positive).mp fit
  let a : BitVec 256 := BitVec.ofNatLT C hc
  let b : BitVec 256 := BitVec.ofNatLT (roundedRep R p) fit
  have maxCall := Inv48.PositiveMax.call n c (maxStage (seed post base) p C R 0 0) a0 a1 [maxRet] a b rfl rfl
  have maxRun := maxStep n c (seed post base) p C R hc positive budget maxCall
  have zero := Inv32FloorStart.zero (n+21) Inv48.Source.model.core.table c (phase3 (seed post base) p C R) h3
  have fv := result_fits C R p positive hc budget
  have read := evalFormula (castWord h3) c (phase4 (seed post base) p C R) (Inv48.minimum C R p)
    (by decide) (Inv32QuoteExpr.castValue _ _ _ _ fv rfl)
  have ret := returnExpr (n+21) Inv48.Source.model.core.table c (phase4 (seed post base) p C R) (castWord h3).core _ read
  have tail : Stmt.evalList (n+22) Inv48.Source.model.core.table c (phase3 (seed post base) p C R) afterRound =
      pure (.returned (phase4 (seed post base) p C R) [.word (Inv48.minimum C R p)]) :=
    (Inv32FloorStart.seqStep _ _ _ _ _ _ _ zero).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ maxRun).trans
        (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ ret))
  have run := Inv48.CollateralCloneFuel.replayList (show n+3 ≤ n+22 by omega) _ _ _ _ _ _ s.remainingRun
  rw [finalEq,tail] at run
  exact ⟨phase4 (seed post base) p C R,fit,callEq,copyEq,finalEq,
    (Inv48.CollateralReturnedMinimum.pureResult run).2,rfl⟩

#print axioms roundFinish
end Inv48.ObservedMinimumHeap
