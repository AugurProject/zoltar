import Inv48MinimumSuccessInvertCore
import Inv48ZeroCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumSuccessInvert
open Inv48.Positive Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
/-- The actual generated guard excludes zero in a completed ordinary body run.
No oracle, helper execution or arithmetic budget is needed for this inversion. -/
theorem bodyPositive (n : Nat) (c : Context) (r : Runtime) (p : Nat)
    (trace : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c
      (start r p) Inv48.Public.body) trace (.ok out)) : 0 < p := by
  by_contra bad
  have zero : p = 0 := by omega
  subst p
  have fail := Inv48.Public.zeroExecution n Inv48.Source.model.core.table c r
    [liquidationGuard,.varDecl .uint256 h0 none,simpleCode h0 ret1 key1,
      .varDecl .uint256 h1 none,simpleCode h1 ret2 key2,
      .varDecl .uint256 h2 none,roundCode,
      .varDecl .uint256 h3 none,maxCode,
      .returnValues [(castWord h3).core]]
  change Stmt.eval (n+5) Inv48.Source.model.core.table c (start r 0) Inv48.Public.body = _ at fail
  rw [fail] at run
  cases run
  exact ordinary trivial
end Inv48.MinimumSuccessInvert
namespace Inv48.MinimumSuccessInvert
open Inv48.Positive Inv48.WrapperTraversal
/-- Public ABI success itself excludes price zero, at arbitrary caller/world context.
The decoding hypothesis is the actual ABI decoder equation, not a synthetic observation. -/
theorem rawPositive (n : Nat) (base : Context) (state : State)
    (self sender : Nat) (data : List Byte) (p : Nat)
    (read : ABI.readSelector? data = some 4197127132)
    (selected : Inv48.Source.model.core.findFunctionBySelector? 4197127132 = some Inv48.PositiveABI.entry)
    (decoded : ABI.decodeFunctionArgs? Inv48.PositiveABI.entry (data.drop ABI.selectorBytes) = .ok [.word p])
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext (n+5) Inv48.Source.model.core
      base state self sender 0 data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) (success : out.success = true) : 0 < p := by
  obtain ⟨frame,result,framed,_,ordinary,exec⟩ := rawBody (n+5) base state self sender data [.word p]
    read selected decoded raw trace out linked run success
  have shape : frame = [("proposedRepPerEthPrice",.word p),("_ret0",.word 0)] := by
    simpa [FunctionDef.initialFrame?,FunctionDef.returnDefaultBindings,
      Inv48.PositiveABI.metadata.2.2.2.1,Inv48.PositiveABI.metadata.2.2.2.2,
      BindingDecl.bindArgs?,BindingDecl.bindArg?,BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue] using framed.symm
  subst frame
  exact bodyPositive n _ _ p trace result ordinary exec
end Inv48.MinimumSuccessInvert
