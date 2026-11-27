import Inv48RequestGuardsComputed
import Inv48CloneReadMath
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RequestGuards.Concrete
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def code := Inv48.CloneRead.runtimeCode (List.replicate 20 0)
  (List.replicate 31 0) (List.replicate 19 0 ++ [50])
def context : Context := {Inv48.Source.model.core.context with
  self := 100, sender := 1, value := 10^18, accountCodes := [(100,code)], selfDispatch? := none}
def state : State :=
  ((State.empty.storeImmutable "securityPool" (.word 300)).storeImmutable
    "initialReportPriorityFeeAttoEthPerGas" (.word 1)).storeImmutable
    "maxSettlementBaseFeeMultiplierBps" (.word 10000)
def rows : ScriptedResponder := [.call {
  kind := .staticcall, target := 300,
  calldata := wordToBytesBE 4 3365542311 ++ wordToBytesBE 32 0,
  value := 0, success := true, output := wordToBytesBE 32 1}]

def summary : String :=
  match publicQuote 250 100 rows context state 1 1 (10^18) with
  | none => "no computed public quote certificate"
  | some q => s!"reached: gas={q.gas}; old={q.old}; hoisted={q.hoisted}; nextMemory={q.cut.runtime.nextMemory}; trace={q.cut.trace.length}; fuel={q.cut.siteFuel}"
def stats := (publicQuote 250 100 rows context state 1 1 (10^18)).map fun q =>
  (q.gas,q.old,q.hoisted,q.cut.runtime.nextMemory,q.cut.trace.length,q.cut.siteFuel)

theorem computedStats : stats = some (4000000,2,1,3,1,241) := by native_decide

theorem available : (publicQuote 250 100 rows context state 1 1 (10^18)).isSome = true := by
  have h := computedStats
  unfold stats at h
  cases eq : publicQuote 250 100 rows context state 1 1 (10^18) with
  | none => simp only [eq,Option.map_none] at h; contradiction
  | some q => rfl

def quote := (publicQuote 250 100 rows context state 1 1 (10^18)).get available

theorem quoteComputed : publicQuote 250 100 rows context state 1 1 (10^18) = some quote := by
  exact Option.eq_some_of_isSome available

def certificate : ComputedPublicQuote 250 100 rows context state 1 1 (10^18) :=
  ⟨quote,quoteComputed⟩

#check certificate
end Inv48.RequestGuards.Concrete
