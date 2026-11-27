import Inv48PostLoopJoinShape
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
open Inv48.WrapperTraversal
namespace Inv48.PostLoopJoin
open Inv48.OperationsPublicEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def afterSuffix (n : Nat) (c : Context) (ys zs : List Stmt) : Result → SolI Result := fun v =>
  ((listNext n Inv48.Source.model.core.table c ys v >>= pop) >>=
    listNext (n+1) Inv48.Source.model.core.table c zs) >>= pop

theorem enclosingNormal (n : Nat) (c : Context) (r : Runtime) (ys zs : List Stmt) :
    enclosing n c ys zs (.normal r) =
      (Stmt.evalList n Inv48.Source.model.core.table c r suffix >>= afterSuffix n c ys zs) := by
  unfold afterSuffix
  simp only [enclosing,listNext,Inv48.WholeQuote.listAppend,assoc]
  rfl

theorem afterRejects (n : Nat) (c : Context) (ys zs : List Stmt) (out : Result)
    (ordinary : ¬ Escapes out) : Rejects (afterSuffix n c ys zs) out := by
  intro v bad trace exec
  cases v <;> try contradiction
  all_goals change Interaction.Executes (pure _) _ _ at exec
  all_goals cases exec; exact ordinary trivial

/-- Starting at the actual validation Site, all later local executions are
inverted from its one continuation. Only the initial Inputs/scalar-gas facts
are left for the decoder/initial-guard worker. -/
theorem fromValidation {root : SolI Result} {tr : Interaction.Transcript} {out : Result}
    (n : Nat) (c : Context) (ys zs : List Stmt)
    (s : Site root Inv48.Source.model.core.table Inv48.OperationsWrapperArgs.loopP.value tr out)
    (fuel : s.fuel = n+7) (context : s.context = c)
    (continuation : s.continuation = enclosing (n+7) c ys zs)
    (ordinary : ¬ Escapes out) (checked : c.checked = true)
    (p a b gas : Nat) (batch : Value)
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256)
    (inputs : Inv48.BatchInputLoop.Inputs s.runtime p a b batch)
    (scalar : s.runtime.lookupLocal? "requiredGas" = some (.word gas))
    (fn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn) :
    ∃ needed g, needed ≤ g ∧ g < 2^32 ∧ 4000000+g ≤ 10000000 ∧
      ∃ call : Site root Inv48.Source.model.core.table Inv48.SimpleWrapperArgs.call tr out,
        call.fuel = n+5 ∧ call.context = c ∧
        Inv48.WrapperArgs.TempValues call.runtime c.sender p a b (4000000+g) ∧
        ∃ result bt ft rest mid,
          call.after = (bt++ft)++rest ∧
          Interaction.Executes (Stmt.eval (n+4) Inv48.Source.model.core.table {c with checked := true}
            (Inv48.GuardArgsFrame.entry call.runtime c.sender p a b (4000000+g)) fn.body)
            bt (.ok result) ∧
          Interaction.Executes (internalCallFinish fn ["_ret__requestPrice_0"] call.runtime.locals result)
            ft (.ok (.normal mid)) ∧
          Interaction.Executes (call.continuation (.normal mid)) rest (.ok out) := by
  obtain ⟨v,during,after,split,first,last⟩ := bindSuccess _ _ _ _ s.suffix
  have normal : ∃ final, v = .normal final := by
    have falls := safeSound 100 _ validationSafe s.fuel s.context s.runtime during v first
    have rej : Rejects s.continuation out := by
      rw [continuation]
      exact enclosingRejects (n+7) c ys zs out ordinary
    cases v with
    | normal final => exact ⟨final,rfl⟩
    | reverted rt err => exact False.elim (rej (.reverted rt err) trivial after last)
    | _ => contradiction
  obtain ⟨final,rfl⟩ := normal
  have loopRun := first
  rw [fuel,context] at loopRun
  have preserved := Inv48.BatchLoopClosure.validationInputs (n+7) c s.runtime final p a b gas batch
    during inputs scalar loopRun
  rw [continuation,enclosingNormal] at last
  obtain ⟨needed,g,le,hg,limit,call,cf,cc,temps,result,bt,ft,rest,mid,sp,body,finish,tail⟩ :=
    continuationEntry n c final checked p a b batch hp ha hb preserved fn registered
      (afterSuffix (n+7) c ys zs) out (afterRejects _ _ _ _ _ ordinary) after last
  have reach := Prefix.ofExecution first s.continuation
  rw [continuation,enclosingNormal] at reach
  have origin := s.reached
  rw [continuation] at origin
  have initial := origin.trans reach
  let lifted : Site root Inv48.Source.model.core.table Inv48.SimpleWrapperArgs.call tr out :=
    { call with
      before := (s.before ++ during) ++ call.before
      split := by
        calc
          tr = s.before ++ s.after := s.split
          _ = s.before ++ (during ++ after) := congrArg (List.append s.before) split
          _ = s.before ++ (during ++ (call.before ++ call.after)) :=
            congrArg (fun xs => s.before ++ (during ++ xs)) call.split
          _ = _ := by simp only [List.append_assoc]
      reached := initial.trans call.reached }
  exact ⟨needed,g,le,hg,limit,lifted,cf,cc,temps,result,bt,ft,rest,mid,sp,body,finish,tail⟩
end Inv48.PostLoopJoin
