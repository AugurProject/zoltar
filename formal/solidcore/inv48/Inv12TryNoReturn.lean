import Inv12LocalStatements
import Inv12NoReturnScopes
open SolidCore.Solidity.Source
namespace Inv12
theorem noCatch (bs : List Byte) : TryCatchClause.findMatch? bs [] = none := by
  unfold TryCatchClause.findMatch?
  cases revertClassify bs <;> rfl

theorem noReturnTry (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (kind : LowLevelCallKind) (target data value : Expr) (gas : Option Expr) (first check : Bool)
    (returns : List BindingDecl) (cleanups : List AbiCleanup) (body : Stmt)
    (safe : ∀ rt, NoReturn rows (Stmt.eval n t c rt body)) :
    NoReturn rows (Stmt.eval (n+1) t c r (.tryExternalCall kind target data value gas first check returns cleanups body [])) := by
  rw [Stmt.eval];dsimp only [noCatch]
  repeat' first | apply revertNoReturn | exact scopedNoReturn _ _ _ (safe _) |
    (simp only [noCatch] at *;done) | (split <;> try dsimp only) |
    (apply bindNoReturn;intro x;try dsimp only)
  rename_i impossible
  rw [noCatch] at impossible
  contradiction
end Inv12
