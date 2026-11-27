import Inv12NoReturn
open SolidCore.Solidity.Source
namespace Inv12

macro "no_return" : tactic => `(tactic|
  (rw [Stmt.eval];dsimp only
   repeat' first | apply normalNoReturn | apply revertNoReturn | apply internalFinishNoReturn |
     (apply bindNoReturn; intro x; try dsimp only) | (split <;> try dsimp only)))

theorem noReturnVar (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (ty : Ty) (name : String) (init : Option Expr) : NoReturn rows (Stmt.eval (n+1) t c r (.varDecl ty name init)) := by no_return
theorem noReturnMemoryVar (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (ty : Ty) (name : String) (init : Option Expr) : NoReturn rows (Stmt.eval (n+1) t c r (.memoryVarDecl ty name init)) := by no_return
theorem noReturnAssign (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (left : LValue) (right : Expr) : NoReturn rows (Stmt.eval (n+1) t c r (.assign left right)) := by no_return
theorem noReturnRequire (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (cond : Expr) (msg : Option String) : NoReturn rows (Stmt.eval (n+1) t c r (.requireStmt cond msg)) := by no_return
theorem noReturnExpression (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (e : Expr) : NoReturn rows (Stmt.eval (n+1) t c r (.exprStmt e)) := by no_return
theorem noReturnAlias (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (name field : String) (args : List Expr) : NoReturn rows (Stmt.eval (n+1) t c r (.storageAliasPath name field args)) := by no_return
theorem noReturnEvent (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (name : String) (args : List Expr) : NoReturn rows (Stmt.eval (n+1) t c r (.emitEvent name args)) := by no_return
theorem noReturnCall (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (targets : List String) (fn : String) (args : List Expr) :
    NoReturn rows (Stmt.eval (n+1) t c r (.internalCall targets fn args)) := by no_return

end Inv12
