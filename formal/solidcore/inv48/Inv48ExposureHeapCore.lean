import Inv48CollateralMinimumOracle
import Inv48QuoteTailPreserveCore
open SolidCore.Solidity.Source
namespace Inv48.ExposureHeap
open Inv48.CloneRead Inv48.CloneGetters Inv48.CollateralMinimum
set_option maxRecDepth 65536
set_option maxHeartbeats 5000000
set_option linter.unusedSimpArgs false

/-- A fresh allocation cannot overwrite a strictly earlier allocated cell. -/
theorem allocation_before (r : Runtime) (v : Value) (id : Nat) (earlier : id < r.nextMemory) :
    (r.allocMemory v).1.loadMemory? id = r.loadMemory? id := by
  simp [Runtime.allocMemory,Runtime.loadMemory?,MemoryMap.lookup?,MemoryMap.insertLoop,
    Std.HashMap.getElem?_insert, Nat.ne_of_gt earlier, Nat.ne_of_lt earlier]

def oracleEntry (r : Runtime) := (scalarFrame r).pushScope.pushScope.pushScope
def oracleNext (c : Context) (r : Runtime) (code : List Nat) (u root exposure : Nat)
    (out : EvmCompiler.Simulation.CallResponse) :=
  (Inv48.Minima.wordReply c (oracleStage (oracleEntry r) code u) root
    (Inv12.wireBytes 2603245787 [u]) out).withFrame
      [("__ext0",.word exposure)] |> fun s =>
    {s with locals := [[("__ext0",.word exposure)],
      [(tmp,.word exposure),(universeView,.word u),(tmp,.word u)],[],[],[("_ret0",.word 0)]]}

theorem concrete_written (c : Context) (r : Runtime) (code : List Nat) (u root exposure : Nat)
    (out : EvmCompiler.Simulation.CallResponse) :
    ((Inv48.Minima.wordReply c (oracleStage (oracleEntry r) code u) root
      (Inv12.wireBytes 2603245787 [u]) out).withFrame [("__ext0",.word exposure)]).assignLocal? tmp (.word exposure) =
      some (oracleNext c r code u root exposure out) := by
  simp [oracleNext,oracleStage,universeStage,oracleEntry,scalarFrame,Inv48.Minima.wordReply,
    Inv12.replied,Runtime.recordExternalInteraction,Runtime.withFrame,Runtime.declareLocal,
    Runtime.pushScope,Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,
    LocalEnv.assign?,Frame.assign?,Value.coerceLike?,LocalEnv.declare,tmp,Inv03.Bodies.tmp,Inv32CeilFlags.h0,universeView,
    Inv48.CloneGetters.post,Runtime.allocMemory]

theorem concrete_captured (c : Context) (r : Runtime) (code : List Nat) (u root exposure : Nat)
    (out : EvmCompiler.Simulation.CallResponse) :
    (oracleNext c r code u root exposure out).popScope.lookupLocal? tmp = some (.word exposure) := by
  simp [oracleNext,oracleStage,universeStage,oracleEntry,scalarFrame,Inv48.Minima.wordReply,
    Inv12.replied,Runtime.recordExternalInteraction,Runtime.withFrame,Runtime.declareLocal,
    Runtime.pushScope,Runtime.popScope,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,
    LocalEnv.declare,tmp,Inv03.Bodies.tmp,Inv32CeilFlags.h0,universeView,Inv48.CloneGetters.post,Runtime.allocMemory]
end Inv48.ExposureHeap
