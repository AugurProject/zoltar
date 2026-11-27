import Inv48RepReturnedMinimumPublic
import Inv48PositiveArithmetic
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RawMinimumResult
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- The two helper witnesses and the public body share one result and transcript.
The deployment and canonical oracle assumptions retain their recovered indices. -/
structure Observation (fuel : Nat) (c : Context) (state : State) (p : Nat)
    (trace : Interaction.Transcript) (out : ABI.AbiCallResult) where
  positive : 0 < p
  result : Result
  finish : Inv48.RequestDispatch.finish Inv48.Source.model.core Inv48.PositiveABI.entry state result = .ok out
  body : Interaction.Executes (Stmt.eval fuel Inv48.Source.model.core.table c
    (Inv48.Positive.start (Inv48.Positive.entryBase c state) p) Inv48.Public.body) trace (.ok result)
  collateral : Inv48.CollateralReturnedMinimum.Joined trace result
  rep : Inv48.RepReturnedMinimum.Joined trace result
  collateralCertificate : ∀ (d : Inv48.CollateralCloneStage.Deployment collateral.context collateral.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment collateral),
    Inv48.MinimumSuccessWords.CanonicalOracle collateral.context collateral.start d.root
      (Inv48.CollateralCloneStage.bytes d) collateral.during →
    Inv48.CollateralReturnedMinimum.Certificate collateral d b
  repCertificate : ∀ (d : Inv48.RepReturnedMinimum.Deployment rep.context rep.caller),
    Inv48.MinimumSuccessWords.CanonicalOracle rep.context rep.start d.root
      (Inv48.RepReturnedMinimum.bytes d) rep.during →
    Inv48.RepReturnedMinimum.Certificate rep d

theorem fromRaw (n : Nat) (base : Context) (state : State)
    (self sender : Nat) (data : List Source.Byte) (p : Nat)
    (read : ABI.readSelector? data = some 4197127132)
    (selected : Inv48.Source.model.core.findFunctionBySelector? 4197127132 = some Inv48.PositiveABI.entry)
    (decoded : ABI.decodeFunctionArgs? Inv48.PositiveABI.entry (data.drop ABI.selectorBytes) = .ok [.word p])
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext (n+5) Inv48.Source.model.core
      base state self sender 0 data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) (success : out.success = true) :
    Nonempty (Observation (n+5)
      (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender 0 data)
      state p trace out) := by
  obtain ⟨positive,result,finish,body,collateral,rep,first,second⟩ :=
    Inv48.RepReturnedMinimum.fromRaw n base state self sender data p read selected decoded
      raw trace out linked run success
  exact ⟨⟨positive,result,finish,body,collateral,rep,first,second⟩⟩

#print axioms fromRaw
end Inv48.RawMinimumResult
