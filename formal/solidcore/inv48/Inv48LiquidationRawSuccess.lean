import Inv48MinimumSuccessInvertCore
import Inv48LiquidationSourceLinkedGetter
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.Liquidation
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Recover the added guard and the funding tail from the same successful ABI
call. Neither guard success nor a separately successful helper call is assumed. -/
theorem rawSuccess (n : Nat) (base : Context) (state : State)
    (self sender : Nat) (data : List Byte) (args : List Value)
    (read : ABI.readSelector? data = some 4197127132)
    (selected : Inv48.Source.model.core.findFunctionBySelector? 4197127132 = some Inv48.PositiveABI.entry)
    (decoded : ABI.decodeFunctionArgs? Inv48.PositiveABI.entry (data.drop ABI.selectorBytes) = .ok args)
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext (n+5) Inv48.Source.model.core
      base state self sender 0 data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) (success : out.success = true) :
    ∃ frame result,
      Inv48.PositiveABI.entry.initialFrame? args = some frame ∧
      ∃ path : GuardRecovery.GetterPath n
        (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender 0 data)
        ((Inv48.Positive.entryBase
          (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender 0 data) state).withFrame frame)
        trace result,
        ∃ guard : GuardRecovery.GuardPassage n
            (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender 0 data)
            path.positive path.guarded path.guardTrace,
          ∃ hoist : GuardRecovery.HoistPath n
            (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender 0 data)
            path.positive.pushScope guard.computed guard.prefixTrace,
            Nonempty (GuardRecovery.LibraryEntered n
              (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender 0 data)
              hoist.caller hoist.callFinal hoist.callTrace) := by
  obtain ⟨frame,result,framed,_,ordinary,exec⟩ := Inv48.MinimumSuccessInvert.rawBody
    (n+5) base state self sender data args read selected decoded raw trace out linked run success
  change Interaction.Executes (Stmt.eval (n+5) _ _ _ actualMinimumBody) trace (.ok result) at exec
  obtain ⟨path⟩ := GuardRecovery.getterPath n _ _ trace result ordinary exec
  obtain ⟨guard,hoist,entered⟩ := GuardRecovery.sameLibraryExecution path
  exact ⟨frame,result,framed,path,guard,hoist,entered⟩
#print axioms rawSuccess
end Inv48.Liquidation
