import Inv48CollateralReturnedMinimumTransport
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CollateralReturnedMinimum
open Inv48.CollateralCloneStage Inv48.CollateralMinimum Inv48.Minima
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

/-- Both the returned formula and its checked-add budget come from the original
successful source tail. Replay preserves the original transcript and result. -/
theorem returnedMinimum (s : Joined trace out) (d : BaseDeployment s) (x : Nat)
    (fit : x < Inv32Division.R)
    (X : s.final.lookupLocal? Inv03.Bodies.tmp = some (.word x)) :
    d.base + Inv03.ceilQuot x 100 < Inv32Division.R ∧
    s.sourceValue = .returned (tailState s.tailStart x d.base)
      [.word (d.base+Inv03.ceilQuot x 100)] ∧ s.sourceTail = [] := by
  have operands := tailOperands s d x fit X
  have run := Inv48.CollateralCloneFuel.replayList (Nat.le_add_right s.sourceN 16) _ _ _ _ _ _ s.tailRun
  have budget : d.base+Inv03.ceilQuot x 100 < Inv32Division.R := by
    by_contra large
    obtain ⟨failed,bad⟩ := Inv48.MinimumSuccessWords.collateralTailOverflow s.sourceN
      s.sourceContext s.tailStart x d.base fit d.fit (Nat.le_of_not_gt large)
      s.sourceChecked operands.1 operands.2
    rw [bad] at run
    have eq := (pureResult run).2
    have finish := s.collateralRun
    rw [eq] at finish
    simp only [Result.mapRuntime,internalCallFinish] at finish
    have impossible := (pureResult finish).2
    cases impossible
  have generated := generatedCollateralTail s.sourceN s.sourceContext s.tailStart x d.base
    fit d.fit budget s.sourceChecked operands.1 operands.2
  rw [generated] at run
  have result := pureResult run
  have tail := Inv48.MinimumSuccessWords.collateralTailRecovered s.sourceN s.sourceContext
    s.tailStart (tailState s.tailStart x d.base) x d.base
    [.word (d.base+Inv03.ceilQuot x 100)] s.sourceTail fit d.fit s.sourceChecked
    operands.1 operands.2 (by simpa only [result.2] using
      (Inv48.CollateralCloneFuel.replayList (Nat.le_add_right s.sourceN 16) _ _ _ _ _ _ s.tailRun))
  exact ⟨tail.1,result.2,result.1⟩

/-- Public recovered success, canonical clone/oracle deployment and the actual
immutable snapshot suffice; no formula, intermediate run or fuel lower bound
is an input. The same decoded x reaches the actual collateral return. -/
theorem fromRecovered (fuel : Nat) (c : Context) (r : Runtime)
    (trace : Interaction.Transcript) (out : Result)
    (h : Inv48.MinimumCollateralTrace.Recovered fuel c r trace out) :
    ∃ s : Joined trace out,
      ∀ (d : Deployment s.context s.caller) (b : BaseDeployment s),
        Inv48.CollateralCloneStage.Facts s.toSlice d ∧
        (Inv48.MinimumSuccessWords.CanonicalOracle s.context s.start d.root (bytes d) s.during →
          ∃ response x,
            Inv48.MinimumSuccessWords.OracleEvent s.context s.start d.root (bytes d) s.during response ∧
            response.success = true ∧ x < Inv32Division.R ∧
            Inv48.ExposureComparison.decoded response x ∧
            b.base+Inv03.ceilQuot x 100 < Inv32Division.R ∧
            s.sourceValue = .returned (tailState s.tailStart x b.base)
              [.word (b.base+Inv03.ceilQuot x 100)] ∧ s.sourceTail = []) := by
  obtain ⟨s⟩ := recover fuel c r trace out h
  refine ⟨s,?_⟩
  intro d b
  refine ⟨Inv48.CollateralCloneFuel.facts s.toSlice d,?_⟩
  intro env
  obtain ⟨response,x,rest,event,success,fit,decoded,X⟩ := Inv48.CollateralCloneFuel.closeSlice s.toSlice d env
  have returned := returnedMinimum s b x fit X
  exact ⟨response,x,⟨rest,event⟩,success,fit,decoded,returned⟩
end Inv48.CollateralReturnedMinimum
