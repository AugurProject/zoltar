import Inv48MinimumFullTraceQuote
import Inv48RawPriceMonotoneCore
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.FundingMinimumObserved
open Inv48.Positive Inv48.MinimumSuffixPath Inv48.MinimumSuccessWords
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- A single internal getter body, not a second successful public getter. -/
structure Body (n : Nat) (c : Context) (base : Runtime) (p : Nat)
    (trace : Interaction.Transcript) (out : Result) where
  path : Path n c (start base p) trace out
  collateral : Inv48.MinimumOperandTransport.Collateral path
  rep : Inv48.MinimumRepOperand.Rep path
  rounded : Rounded path
  positive : 0 < p

theorem recoverBody (n : Nat) (c : Context) (base : Runtime) (p : Nat)
    (trace : Interaction.Transcript) (out : Result) (ordinary : ¬ Inv48.WrapperTraversal.Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c
      (start base p) Inv48.Public.body) trace (.ok out)) :
    Nonempty (Body n c base p trace out) := by
  obtain ⟨path⟩ := recover n c _ trace out ordinary run
  obtain ⟨collateral⟩ := Inv48.MinimumOperandTransport.collateral path run
  obtain ⟨rep⟩ := Inv48.MinimumRepOperand.rep path run
  obtain ⟨rounded⟩ := Inv48.MinimumSuffixPath.rounded path ordinary
  exact ⟨⟨path,collateral,rep,rounded,
    Inv48.MinimumSuccessInvert.bodyPositive n c base p trace out ordinary run⟩⟩

/-- Same recovered snapshots and oracle contracts as RawPriceMonotone; numeric
bounds and the exact internal return are conclusions of normal completion. -/
theorem bodyCertificate (s : Body n c base p trace out) (hp : p < Inv32Division.R)
    (dC : Inv48.CollateralCloneStage.Deployment s.collateral.joined.context s.collateral.joined.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment s.collateral.joined)
    (envC : CanonicalOracle s.collateral.joined.context s.collateral.joined.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) s.collateral.joined.during)
    (dR : Inv48.RepReturnedMinimum.Deployment s.rep.joined.context s.rep.joined.caller)
    (envR : CanonicalOracle s.rep.joined.context s.rep.joined.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) s.rep.joined.during) :
    ∃ cr x C rr y R final,
      OracleEvent s.collateral.joined.context s.collateral.joined.start dC.root
        (Inv48.CollateralCloneStage.bytes dC) s.collateral.joined.during cr ∧
      cr.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded cr x ∧
      C = b.base + Inv03.ceilQuot x 100 ∧ C < Inv32Division.R ∧
      OracleEvent s.rep.joined.context s.rep.joined.start dR.root
        (Inv48.RepReturnedMinimum.bytes dR) s.rep.joined.during rr ∧
      rr.success = true ∧ y < Inv32Division.R ∧ Inv48.ExposureComparison.decoded rr y ∧
      R = Inv03.ceilQuot y 100 ∧ R < Inv32Division.R ∧
      Inv03.ceilQuot (R*10^18) p < Inv32Division.R ∧
      R*10^18 ≤ (Inv32Division.R-1)*p ∧
      out = .returned final [.word (max C (Inv03.ceilQuot (R*10^18) p))] ∧
      (∀ amount, max C (Inv03.ceilQuot (R*10^18) p) ≤ amount ↔
        C ≤ amount ∧ R*10^18 ≤ amount*p) := by
  obtain ⟨cr,x,C,ce,cs,xf,xd,cf,Cf,_,_,post,_,_⟩ :=
    Inv48.MinimumOperandTransport.finishCollateral s.path s.collateral hp s.positive dC b envC
  obtain ⟨rr,y,R,re,rs,yf,yd,rf,Rf,_,_,repPost,_,_,_⟩ :=
    Inv48.MinimumRepOperand.finishRep s.path s.rep post dR envR
  obtain ⟨final,qf,_,_,_,value⟩ :=
    Inv48.RoundedMinimumReturn.finish s.path s.rounded repPost hp Cf Rf s.positive
  refine ⟨cr,x,C,rr,y,R,final.popScope.popScope,ce,cs,xf,xd,cf,Cf,re,rs,yf,yd,rf,Rf,qf,
    (rounded_fits_iff R p s.positive).mp qf,?_,?_⟩
  · rw [s.path.originalResult,value]
    rfl
  · exact fun amount => Inv48.sufficient C R p amount s.positive

#print axioms recoverBody
#print axioms bodyCertificate
end Inv48.FundingMinimumObserved
