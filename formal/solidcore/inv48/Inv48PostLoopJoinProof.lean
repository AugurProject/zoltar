import Inv48PostLoopJoinEntry
import Inv48PostLoopJoinTransport
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify
namespace Inv48.PostLoopJoin
open Inv48.OperationsPublicEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- All suffix premises are discharged from one successful actual suffix run.
The initial decoder/guard prefix and the connection from a validation Site to
this suffix remain an explicit integration boundary. -/
theorem suffixEntry (n : Nat) (c : Context) (r final : Runtime)
    (checked : c.checked = true) (p a b : Nat) (batch : Value)
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256)
    (inputs : Inv48.BatchInputLoop.Inputs r p a b batch)
    (fn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.evalList (n+7) Inv48.Source.model.core.table c r suffix)
      tr (.ok (.normal final))) :
    ∃ needed g, needed ≤ g ∧ g < 2^32 ∧ 4000000+g ≤ 10000000 ∧
      ∃ s : Site (Stmt.evalList (n+7) Inv48.Source.model.core.table c r suffix)
        Inv48.Source.model.core.table Inv48.SimpleWrapperArgs.call tr (.normal final),
        s.fuel = n+5 ∧ s.context = c ∧
        Inv48.WrapperArgs.TempValues s.runtime c.sender p a b (4000000+g) ∧
        ∃ result bt ft rest mid,
          s.after = (bt++ft)++rest ∧
          Interaction.Executes (Stmt.eval (n+4) Inv48.Source.model.core.table {c with checked := true}
            (Inv48.GuardArgsFrame.entry s.runtime c.sender p a b (4000000+g)) fn.body)
            bt (.ok result) ∧
          Interaction.Executes (internalCallFinish fn ["_ret__requestPrice_0"] s.runtime.locals result)
            ft (.ok (.normal mid)) ∧
          Interaction.Executes (s.continuation (.normal mid)) rest (.ok (.normal final)) := by
  obtain ⟨needed,supplied,g,t1,t2,t3,tail,split,_,_,le,hg,wide,narrow,limit,reached,ins,exec⟩ :=
    invert n c r final checked p a b batch inputs tr run
  have same := budgetGasAgree c r supplied g checked wide narrow
  subst supplied
  have fit : 4000000+g < 2^32 := limit.trans_lt (by decide)
  obtain ⟨s,fuel,context,runtime,temps,result,bt,ft,rest,mid,sp,body,finish,last⟩ :=
    actualEntry (n+4) c _ final p a b (4000000+g) batch hp ha hb fit ins
      (by simp [staged,callbackStage]) fn registered tail exec
  let lifted : Site (Stmt.evalList (n+7) Inv48.Source.model.core.table c r suffix)
      Inv48.Source.model.core.table Inv48.SimpleWrapperArgs.call tr (.normal final) :=
    { s with
      before := (t1 ++ (t2 ++ t3)) ++ s.before
      split := by
        calc
          tr = (t1 ++ (t2 ++ t3)) ++ tail := by simpa only [List.append_assoc] using split
          _ = (t1 ++ (t2 ++ t3)) ++ (s.before ++ s.after) := congrArg _ s.split
          _ = _ := by simp only [List.append_assoc]
      reached := reached.trans s.reached }
  exact ⟨needed,g,le,hg,limit,lifted,fuel,context,temps,result,bt,ft,rest,mid,sp,body,finish,last⟩
end Inv48.PostLoopJoin
