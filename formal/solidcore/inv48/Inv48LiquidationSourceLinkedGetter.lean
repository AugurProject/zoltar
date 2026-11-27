import Inv48LiquidationGuardLibraryShape
import Inv48LiquidationGuardLibraryCall
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace GuardRecovery
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem successfulGetter (fn : FunctionDef)
    (found : Inv48.Source.model.core.findFunctionByName? "minimumToken1ReportAttoEthForPrice" = some fn)
    (n : Nat) (c : Context) (r : Runtime) (tr : Interaction.Transcript) (out : Result)
    (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c r fn.body) tr (.ok out)) :
    ∃ path : GetterPath n c r tr out,
      ∃ guard : GuardPassage n c path.positive path.guarded path.guardTrace,
        ∃ hoist : HoistPath n c path.positive.pushScope guard.computed guard.prefixTrace,
          ∃ entered : LibraryEntered n c hoist.caller hoist.callFinal hoist.callTrace,
            entered.fn.body = actualLiquidationLibraryBody ∧ ¬ Escapes entered.result ∧
              ∃ frame, entered.fn.initialFrame? entered.values = some frame ∧
                entered.inner = {entered.mid with locals := [frame]} ∧ entered.saved = entered.mid.locals := by
  have shape := checked_body
  rw [found] at shape
  have eq := Option.some.inj shape
  rw [eq] at run
  obtain ⟨path⟩ := getterPath n c r tr out ordinary run
  obtain ⟨guard,hoist,⟨entered⟩⟩ := sameLibraryExecution path
  have lib := checked_library_body
  change (Inv48.Source.model.core.table.lookup? executionLibraryKey).map InternalFunction.body = _ at lib
  rw [entered.found] at lib
  exact ⟨path,guard,hoist,entered,Option.some.inj lib,libraryOrdinary entered,enteredFrame entered⟩
#print axioms successfulGetter
end GuardRecovery
