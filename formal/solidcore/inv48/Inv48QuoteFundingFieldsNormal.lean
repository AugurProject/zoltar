import Inv48FundingContinuationCapture
import Inv48FundingFallthroughTraversal
import Inv48WholeQuoteShape
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.FundingFallthrough
namespace Inv48.QuoteFundingFields
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def noReturnShape : Nat → Stmt → Bool
  | 0,_ => false
  | k+1,.block ss => ss.all (noReturnShape k)
  | k+1,.ifElse _ a b => noReturnShape k a && noReturnShape k b
  | _+1,.memoryLocalize .. => true
  | _+1,s => simpleFalls 1 s

theorem localizeNever (n t c r ty name) :
    NeverReturns (Stmt.eval (n+1) t c r (.memoryLocalize ty name)) := by
  rw [Stmt.eval]; dsimp only
  repeat' first | (apply pureNever; intros; simp) | split

theorem noReturnSound (k : Nat) (s : Stmt) (safe : noReturnShape k s = true)
    (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) :
    NeverReturns (Stmt.eval fuel t c r s) := by
  induction k generalizing s fuel r with
  | zero => cases safe
  | succ k ih =>
    by_cases simple : simpleFalls 1 s = true
    · exact neverSound 1 s simple fuel t c r
    · cases fuel with
      | zero => intro tr rt vs run; rw [Stmt.eval] at run; cases run
      | succ n =>
        cases s <;> simp only [noReturnShape, simpleFalls] at safe simple
        all_goals try contradiction
        next ss =>
          rw [Stmt.eval]
          apply scopeNever
          exact listNever n t c ss (fun s mem rt =>
            ih s ((List.all_eq_true.mp safe) s mem) n rt) r.pushScope
        next ty name => exact localizeNever n t c r ty name
        next cond yes no =>
          simp only [Bool.and_eq_true] at safe
          rw [Stmt.eval]; dsimp only
          apply bindNever
          rintro (err|⟨v,rt⟩)
          · apply pureNever; intros; simp
          · dsimp only
            split
            · split
              · exact ih yes safe.1 n rt
              · exact ih no safe.2 n rt
            · apply pureNever; intros; simp

def registeredBody := Inv48.WholeQuote.bodyP.value

theorem registeredNoReturn : noReturnShape 100 registeredBody = true := by native_decide

theorem registeredOrdinary : checked 100 Inv48.Source.model.core.table registeredBody = true := by native_decide

/-- The generated callee can only fall through or revert; no normal-result premise. -/
theorem bodyOut (n : Nat) (c : Context) (r : Runtime) (fn : InternalFunction)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.quoteKey = some fn)
    (tr : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r fn.body) tr (.ok out)) :
    (∃ final, out = .normal final) ∨ (∃ final err, out = .reverted final err) := by
  have shape : fn.body = registeredBody := by
    have h := Inv48.WholeQuote.actualBody
    change Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn at linked
    rw [linked] at h
    exact Option.some.inj h
  rw [shape] at run
  have ordinary := sound 100 registeredBody _ registeredOrdinary n c r tr out run
  have never := noReturnSound 100 registeredBody registeredNoReturn n Inv48.Source.model.core.table c r
  cases out with
  | normal final => exact .inl ⟨final,rfl⟩
  | reverted final err => exact .inr ⟨final,err,rfl⟩
  | returned final vs => exact False.elim (never tr final vs run)
  | _ => contradiction

/-- A successful normal call epilogue excludes the remaining revert case. -/
theorem normalFromFinish (n : Nat) (c : Context) (r : Runtime) (fn : InternalFunction)
    (saved : LocalEnv) (targets : List String) (tr aft : Interaction.Transcript)
    (out : Result) (caller : Runtime)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.quoteKey = some fn)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r fn.body) tr (.ok out))
    (finish : Interaction.Executes (internalCallFinish fn targets saved out) aft (.ok (.normal caller))) :
    ∃ final, out = .normal final := by
  rcases bodyOut n c r fn linked tr out run with good | ⟨final,err,h⟩
  · exact good
  · subst out
    simp only [internalCallFinish] at finish
    cases finish

#print axioms bodyOut
#print axioms normalFromFinish
end Inv48.QuoteFundingFields
