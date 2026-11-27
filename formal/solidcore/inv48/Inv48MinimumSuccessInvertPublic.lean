import Inv48MinimumSuccessInvertCalls
import Inv48MinimumSuccessInvertGuard
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumSuccessInvert
open Inv48.Positive Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def Completed (fuel : Nat) (c : Context) (r : Runtime) (trace : Interaction.Transcript)
    (out : Result) (target : Stmt) : Prop :=
  ∃ s : Inv48.RequestClassify.Site (Stmt.eval fuel Inv48.Source.model.core.table c r Inv48.Public.body)
    Inv48.Source.model.core.table target trace out,
    ∃ final during rest, s.after = during ++ rest ∧
      Interaction.Executes (Stmt.eval s.fuel Inv48.Source.model.core.table s.context s.runtime target)
        during (.ok (.normal final)) ∧
      Interaction.Executes (s.continuation (.normal final)) rest (.ok out)

/-- One actual raw ABI success supplies positivity and both normally completed
minimum helper calls, each reached from that same body and original transcript.
No helper execution/result, BothMinimum.Inputs or Observation is a premise. -/
theorem rawHelpers (n : Nat) (base : Context) (state : State)
    (self sender : Nat) (data : List Byte) (p : Nat)
    (read : ABI.readSelector? data = some 4197127132)
    (selected : Inv48.Source.model.core.findFunctionBySelector? 4197127132 = some Inv48.PositiveABI.entry)
    (decoded : ABI.decodeFunctionArgs? Inv48.PositiveABI.entry (data.drop ABI.selectorBytes) = .ok [.word p])
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext (n+5) Inv48.Source.model.core
      base state self sender 0 data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) (success : out.success = true) :
    let c := ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender 0 data
    let r := start (entryBase c state) p
    0 < p ∧ ∃ result,
      Inv48.RequestDispatch.finish Inv48.Source.model.core Inv48.PositiveABI.entry state result = .ok out ∧
      Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c r Inv48.Public.body) trace (.ok result) ∧
      Completed (n+5) c r trace result firstCall ∧ Completed (n+5) c r trace result secondCall := by
  obtain ⟨frame,result,framed,done,ordinary,exec⟩ := rawBody (n+5) base state self sender data [.word p]
    read selected decoded raw trace out linked run success
  have shape : frame = [("proposedRepPerEthPrice",.word p),("_ret0",.word 0)] := by
    simpa [FunctionDef.initialFrame?,FunctionDef.returnDefaultBindings,
      Inv48.PositiveABI.metadata.2.2.2.1,Inv48.PositiveABI.metadata.2.2.2.2,
      BindingDecl.bindArgs?,BindingDecl.bindArg?,BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue] using framed.symm
  subst frame
  refine ⟨bodyPositive n _ _ p trace result ordinary exec,result,done,exec,?_,?_⟩
  · exact normalHelper _ _ _ (firstRoute (n+1)) _ _ trace result ordinary exec
  · exact normalHelper _ _ _ (secondRoute (n+1)) _ _ trace result ordinary exec
end Inv48.MinimumSuccessInvert
