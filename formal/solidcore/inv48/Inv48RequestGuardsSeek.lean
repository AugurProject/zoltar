import Inv48RequestGuardsCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RequestGuards
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

inductive Path where
  | here
  | block (index : Nat) (next : Path)
  | capture (next : Path)
  | call (next : Path)
  deriving Repr

/-- Evaluate preceding statements with the canonical scripted responder. No
runtime, getter result, successful prefix or desired child result is supplied.
Missing rows, insufficient budgets, reverts and path mismatches return none. -/
def seek (path : Path) (fuel budget : Nat) (rows : ScriptedResponder)
    (table : FunctionTable) (c : Context) (r : Runtime) (stmt : Stmt) :
    Option (Cut fuel table c r stmt) :=
  match path with
  | .here => some (here fuel table c r stmt)
  | .block index next =>
    match fuel,stmt with
    | n+1,.block ss => do
      let xs := ss.take index
      match split : ss.drop index with
      | [] => none
      | child::ys => do
        let observed ← Inv48.NestedResponder.observe budget rows (Stmt.evalList n table c r.pushScope xs)
        match completed : observed.outcome with
        | .ok (.normal mid) => do
          let inside ← seek next n budget rows table c mid child
          let run : Inv48.WholeQuote.Reached (Stmt.evalList n table c r.pushScope xs) observed.trace mid := by
            simpa only [completed] using observed.execution
          let cut := blockCut n table c r mid xs child ys observed.trace run inside
          have shape : xs++child::ys = ss := by
            simpa only [xs,split] using List.take_append_drop index ss
          return shape ▸ cut
        | _ => none
    | _,_ => none
  | .capture next =>
    match fuel,stmt with
    | n+1,.captureReturn names body => do
      let inside ← seek next n budget rows table c r body
      pure (captureCut n table c r names body inside)
    | _,_ => none
  | .call next =>
    match fuel,stmt with
    | n+1,.internalCall targets key args => do
      let observed ← Inv48.NestedResponder.observe budget rows (Expr.evalRefArgList c r args).caught
      match completed : observed.outcome with
      | .ok (.ok (values,mid)) =>
        match found : table.lookup? key with
        | none => none
        | some fn =>
          match entered : internalCallEnter? fn values mid with
          | none => none
          | some (inner,saved) => do
            let inside ← seek next n budget rows table {c with checked := true} inner fn.body
            let run : Interaction.Executes (Expr.evalRefArgList c r args).caught observed.trace
                (.ok (.ok (values,mid))) := by
              simpa only [completed] using observed.execution
            pure (callCut n table c r mid inner targets key args values fn saved observed.trace run found entered inside)
      | _ => none
    | _,_ => none

/-- This path stops at the quote hoist after executing the public callback
getter, actual argument declarations, request cleanup, reporting-window getter
and bounty/value guards. The path is checked against the actual AST by seek. -/
def guardsPath : Path :=
  .block 4 (.block 0 (.block 4 (.block 6 (.capture (.call (.block 6 (.block 5 .here)))))))

/-- Stop at the actual quote capture after both real memory allocations and
all three cleaned quote argument declarations. -/
def requestPath : Path :=
  .block 4 (.block 0 (.block 4 (.block 6 (.capture (.call (.block 6 (.block 6 (.block 4 .here))))))))

end Inv48.RequestGuards
