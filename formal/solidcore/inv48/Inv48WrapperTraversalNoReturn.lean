import Inv48FundingFallthroughPublic
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.FundingFallthrough
namespace Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Structural induction on evaluator fuel, independent of batch size or transcript. -/
theorem whileNever (t : FunctionTable) (c : Context) (cond : Expr) (body : Stmt)
    (safe : ∀ n rt, NeverReturns (Stmt.eval n t c rt body)) (n : Nat) (r : Runtime) :
    NeverReturns (Stmt.evalWhile n t c r cond body) := by
  induction n generalizing r with
  | zero => intro trace rt vs run; rw [Stmt.evalWhile] at run; cases run
  | succ n ih =>
    rw [Stmt.evalWhile]
    apply bindNever
    rintro (err|⟨value,mid⟩)
    · apply pureNever; intros; simp
    · dsimp only
      split
      · split
        · intro trace rt vs run
          obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ run
          cases v with
          | normal q => exact ih q _ _ _ last
          | continued q => exact ih q _ _ _ last
          | returned q values => cases last; exact safe n mid _ _ _ first
          | _ => cases last
        · apply pureNever; intros; simp
      · apply pureNever; intros; simp

def loopFalls : Nat → Stmt → Bool
  | 0,_ => false
  | k+1,.block ss => ss.all (loopFalls k)
  | k+1,.whileLoop _ body | k+1,.checked body | k+1,.unchecked body => loopFalls k body
  | k+1,.ifElse _ a b => loopFalls k a && loopFalls k b
  | k+1,.tryExternalCall _ _ _ _ _ _ _ _ _ body [] => loopFalls k body
  | _+1,.captureReturn .. | _+1,.assign .. | _+1,.varDecl .. |
    _+1,.memoryVarDecl .. | _+1,.requireStmt .. | _+1,.exprStmt .. |
    _+1,.internalCall .. | _+1,.skip => true
  | _+1,_ => false

theorem loopNeverSound (k : Nat) (stmt : Stmt) (safe : loopFalls k stmt = true)
    (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) : NeverReturns (Stmt.eval fuel t c r stmt) := by
  induction k generalizing stmt fuel c r with
  | zero => cases safe
  | succ k ih =>
    cases fuel with
    | zero => intro trace rt vs run; rw [Stmt.eval] at run; cases run
    | succ n =>
      cases stmt <;> try simp only [loopFalls] at safe
      all_goals first | contradiction | apply varNever | apply memoryNever | apply assignNever |
        apply requireNever | apply exprNever | apply captureNever | apply callNever | skip
      case tryExternalCall kind target data value gas first check returns cleanups body catches =>
        cases catches with
        | nil =>
          simp only [loopFalls] at safe
          exact tryNever n t c r kind target data value gas first check returns cleanups body (fun rt => ih body safe n _ rt)
        | cons a rest =>
          simp only [loopFalls] at safe
          cases safe
      case whileLoop cond body =>
        rw [Stmt.eval]
        exact whileNever t c cond body (fun n rt => ih body safe n _ rt) n r
      case checked body => rw [Stmt.eval]; exact ih body safe n _ r
      case unchecked body => rw [Stmt.eval]; exact ih body safe n _ r
      case ifElse cond yes no =>
        simp only [Bool.and_eq_true] at safe
        rw [Stmt.eval]
        apply bindNever
        rintro (err|⟨value,mid⟩)
        · apply pureNever; intros; simp
        · dsimp only
          split
          · split
            · exact ih yes safe.1 n c mid
            · exact ih no safe.2 n c mid
          · apply pureNever; intros; simp
      case skip => rw [Stmt.eval]; apply pureNever; intros; simp
      case block ss =>
        rw [Stmt.eval]
        intro trace rt vs run
        obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ run
        cases v <;> cases last
        exact listNever n t c ss (fun s mem r => ih s ((List.all_eq_true.mp safe) s mem) n c r) r.pushScope _ _ _ first
end Inv48.WrapperTraversal
