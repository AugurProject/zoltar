import Inv12TryNoReturn
open SolidCore.Solidity.Source
namespace Inv12

def fallsThrough : Nat → Stmt → Bool
  | 0,_ => false
  | k+1,.block stmts => stmts.all (fallsThrough k)
  | k+1,.tryExternalCall _ _ _ _ _ _ _ _ _ body [] => fallsThrough k body
  | _+1,.captureReturn .. | _+1,.assign .. | _+1,.varDecl .. | _+1,.memoryVarDecl .. |
    _+1,.storageAliasPath .. | _+1,.requireStmt .. | _+1,.exprStmt .. |
    _+1,.internalCall .. | _+1,.emitEvent .. | _+1,.skip => true
  | _+1,_ => false

theorem noEarlyExit (k fuel : Nat) (stmt : Stmt) (safe : fallsThrough k stmt=true)
    (t : FunctionTable) (c : Context) (rt : Runtime) (rows : ScriptedResponder) :
    NoReturn rows (Stmt.eval fuel t c rt stmt) := by
  induction k generalizing fuel stmt rt with
  | zero => cases safe
  | succ k ih =>
    cases fuel with
    | zero => intro _ _ E; rw [Stmt.eval] at E; cases E
    | succ n =>
      cases stmt <;> try simp only [fallsThrough] at safe
      all_goals first | contradiction | apply noReturnVar | apply noReturnMemoryVar | apply noReturnAssign |
        apply noReturnRequire | apply noReturnExpression | apply noReturnAlias | apply noReturnCall |
        apply noReturnEvent | apply captureCannotReturn | (rw [Stmt.eval];apply normalNoReturn) |
        (apply blockNoReturn;intro s mem start;exact ih _ _ ((List.all_eq_true.mp safe) _ mem) _) |
        (rename_i catches;cases catches <;> first | contradiction | (apply noReturnTry;intro start;exact ih _ _ safe _))
end Inv12
