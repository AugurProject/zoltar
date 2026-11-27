import Inv48BatchReadFrameCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BatchReadFrame
open Inv48.EscrowJoin Inv48.EscrowPrefix Inv48.BatchInputLoop
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

def firstCondition : Expr :=
  match Inv48.OperationsWrapperArgs.loopIteration with
  | .block [.requireStmt e _,_,_] => e
  | _ => .word 0

def secondCondition : Expr :=
  match Inv48.OperationsWrapperArgs.loopIteration with
  | .block [_,.requireStmt e _,_] => e
  | _ => .word 0

theorem conditionRead : Read Inv48.OperationsWrapperArgs.loopCondition := by
  change Read (.binary .lt _ _)
  repeat' constructor
  all_goals intro h; cases h

theorem firstRead : Read firstCondition := by
  change Read (.binary .ne _ _)
  repeat' constructor
  all_goals intro h; cases h

theorem secondRead : Read secondCondition := by
  change Read (.binary .le _ _)
  repeat' constructor
  all_goals intro h; cases h

theorem rhsRead : Read bodyRhs := by
  change Read (.castOp .uintCleanup 256 _)
  repeat' constructor
  all_goals intro h; cases h

theorem frozen (c : Context) (r : Runtime) (e : Expr) (safe : Read e) :
    Frozen r (Expr.eval c r e) := (readFuel (Expr.orderFuel e + 1) c).1 e safe r

theorem conditionFrozen (c : Context) (r : Runtime) :
    Frozen r (Expr.eval c r Inv48.OperationsWrapperArgs.loopCondition) := frozen c r _ conditionRead

theorem firstFrozen (c : Context) (r : Runtime) :
    Frozen r (Expr.eval c r firstCondition) := frozen c r _ firstRead

theorem secondFrozen (c : Context) (r : Runtime) :
    Frozen r (Expr.eval c r secondCondition) := frozen c r _ secondRead

theorem rhsFrozen (c : Context) (r : Runtime) :
    Frozen r (Expr.eval c r bodyRhs) := frozen c r _ rhsRead

theorem assignmentInputs (n : Nat) (c : Context) (r final : Runtime)
    (p a b old : Nat) (batch : Value) (trace : Interaction.Transcript)
    (bound : r.lookupLocal? "requiredGas" = some (.word old))
    (inputs : Inputs r p a b batch)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r
      (.exprStmt (.assignment (some .add) (some (.uint 256)) (.var "requiredGas") bodyRhs)))
      trace (.ok (.normal final))) : Inputs final p a b batch :=
  actualAssignmentInputs n c r final p a b old batch trace bound inputs (rhsFrozen c r) run
end Inv48.BatchReadFrame
