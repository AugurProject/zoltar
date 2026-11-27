import Inv48PreLoopJoinPrefix
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify
open Inv48.WrapperTraversal
namespace Inv48.PreLoopJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Semantic input transport along the very route used to recover the Site.
Every block transport consumes its own actual successful prefix execution. -/
def Tracks {t target fuel stmt} (b : Blocks t target fuel stmt)
    (P Q : Runtime → Prop) : Prop :=
  match b with
  | .here _ => ∀ r, P r → Q r
  | .capture _ _ _ next => Tracks next P Q
  | .block n xs _ _ _ next => ∃ M : Runtime → Prop,
      (∀ c r mid tr, P r →
        Interaction.Executes (Stmt.evalList n t c r.pushScope xs) tr (.ok (.normal mid)) → M mid) ∧
      Tracks next M Q

theorem tracksCast {t target fuel stmt other} (b : Blocks t target fuel stmt)
    (e : stmt = other) (P Q : Runtime → Prop) : Tracks (e ▸ b) P Q ↔ Tracks b P Q := by
  cases e
  rfl

theorem fuelCast {t target fuel stmt other} (b : Blocks t target fuel stmt)
    (e : stmt = other) : (e ▸ b).leafFuel = b.leafFuel := by
  cases e
  rfl

theorem trackedSite (b : Blocks t target fuel stmt) (P Q : Runtime → Prop)
    (transport : Tracks b P Q) (c : Context) (r : Runtime) (initial : P r)
    (k : Result → SolI Result) (trace : Interaction.Transcript) (out : Result)
    (reject : Rejects k out)
    (run : Interaction.Executes (Stmt.eval fuel t c r stmt >>= k) trace (.ok out)) :
    ∃ s : Site (Stmt.eval fuel t c r stmt >>= k) t target trace out,
      s.fuel = b.leafFuel ∧ Rejects s.continuation out ∧ Q s.runtime := by
  induction b generalizing P c r k trace out with
  | here n => exact ⟨⟨n,c,r,k,[],trace,by simp,.refl _,run⟩,rfl,reject,transport r initial⟩
  | capture n names body next ih =>
    rw [Stmt.eval] at run
    change Interaction.Executes ((Stmt.eval n t c r body >>= captureNext names) >>= k) trace (.ok out) at run
    have rej : Rejects (fun v => captureNext names v >>= k) out := by
      intro v bad tr exec
      cases v <;> try contradiction
      all_goals (apply reject _ ?_ tr exec; trivial)
    obtain ⟨s,eq,rej,ready⟩ := ih P transport c r initial
      (fun v => captureNext names v >>= k) trace out rej (by simpa only [assoc] using run)
    exact ⟨{s with reached := by simpa only [Stmt.eval,assoc] using s.reached},eq,rej,ready⟩
  | block n xs child ys safe next ih =>
    obtain ⟨M,step,transport⟩ := transport
    rw [blockSplit,assoc] at run
    obtain ⟨v,before,after,split,first,last⟩ := bindSuccess _ _ _ _ run
    rcases prefixOut t xs safe n c r.pushScope before v first with ⟨mid,rfl⟩ | ⟨mid,err,rfl⟩
    · have rej : Rejects (fun v => (listNext n t c ys v >>= pop) >>= k) out := by
        intro v bad tr exec
        cases v <;> try contradiction
        all_goals (apply reject _ ?_ tr exec; trivial)
      obtain ⟨s,eq,rej,ready⟩ := ih M transport c mid (step c r mid before initial first)
        (fun v => (listNext n t c ys v >>= pop) >>= k) after out rej
        (by simpa only [assoc] using last)
      refine ⟨⟨s.fuel,s.context,s.runtime,s.continuation,before++s.before,s.after,?_,?_,s.suffix⟩,eq,rej,ready⟩
      · exact split.trans ((congrArg (fun tr => before++tr) s.split).trans (List.append_assoc _ _ _).symm)
      · rw [blockSplit,assoc]
        exact (Prefix.ofExecution first _).trans (by simpa only [assoc] using s.reached)
    · exact False.elim (reject (.reverted mid.popScope err) trivial after last)

abbrev Ready (p a b : Nat) (batch : Value) (r : Runtime) :=
  Inv48.BatchInputLoop.Inputs r p a b batch ∧ r.lookupLocal? "requiredGas" = some (.word 0)

/-- The concrete route recovers a validation Site carrying the original inputs
and a scalar zero gas accumulator, through cleanup and the three real guards. -/
theorem boundSite (fn : FunctionDef) (found : Inv48.OperationsWrapperArgs.wrapper = some fn)
    (n : Nat) (p a b : Nat) (batch : Value)
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256)
    (c : Context) (r : Runtime) (initial : Inv48.BatchInputLoop.Inputs r p a b batch)
    (trace : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+2) Inv48.Source.model.core.table c r fn.body) trace (.ok out)) :
    ∃ s : Site (Stmt.eval (n+2) Inv48.Source.model.core.table c r fn.body)
        Inv48.Source.model.core.table Inv48.OperationsWrapperArgs.loopP.value trace out,
      s.fuel = n ∧ Rejects s.continuation out ∧ Ready p a b batch s.runtime := by
  have loop := (Inv48.OperationsWrapperArgs.actualNodes fn found).1
  have safe := Inv48.OperationsPublicEntry.checkedPrefixes
  simp only [Inv48.OperationsPublicEntry.prefixesCheck,found,Option.any_some,Bool.and_eq_true] at safe
  obtain ⟨clean,init⟩ := actualPrefixes fn found
  cases body : fn.body <;> try {simp [Inv48.OperationsWrapperArgs.mainStatements,body] at loop}
  case block outer =>
    cases middle : outer[5]? with
    | none => simp [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at loop
    | some stmt =>
      cases stmt <;> try {simp [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at loop}
      case block inner =>
        simp only [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at loop init
        simp only [Inv48.OperationsPublicEntry.outerStatements,body] at clean
        have outerSafe := safe.1
        have innerSafe := safe.2
        simp only [Inv48.OperationsPublicEntry.outerStatements,body] at outerSafe
        simp only [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at innerSafe
        have outerShape := Inv48.OperationsPublicEntry.splitAt outer 5 (.block inner) middle
        have innerShape := Inv48.OperationsPublicEntry.splitAt inner 4 Inv48.OperationsWrapperArgs.loopP.value loop
        let leaf : Blocks Inv48.Source.model.core.table Inv48.OperationsWrapperArgs.loopP.value n
            Inv48.OperationsWrapperArgs.loopP.value := .here n
        let inside := Blocks.block n (inner.take 4) _ (inner.drop 5) innerSafe leaf
        have innerTrack : Tracks inside (fun r => Inv48.BatchInputLoop.Inputs r p a b batch) (Ready p a b batch) := by
          refine ⟨Ready p a b batch,?_,fun _ h => h⟩
          intro c r mid tr inputs exec
          rw [init] at exec
          have eq := initialRuntime n c r.pushScope mid tr exec
          rw [eq]
          exact readyInputs r.pushScope p a b batch (pushInputs r p a b batch inputs)
        let innerB : Blocks Inv48.Source.model.core.table Inv48.OperationsWrapperArgs.loopP.value (n+1) (.block inner) :=
          (congrArg Stmt.block innerShape).symm ▸ inside
        have innerT : Tracks innerB (fun r => Inv48.BatchInputLoop.Inputs r p a b batch) (Ready p a b batch) := by
          exact (tracksCast inside (congrArg Stmt.block innerShape).symm _ _).mpr innerTrack
        let whole := Blocks.block (n+1) (outer.take 5) (.block inner) (outer.drop 6) outerSafe innerB
        have wholeTrack : Tracks whole (fun r => Inv48.BatchInputLoop.Inputs r p a b batch) (Ready p a b batch) := by
          refine ⟨(fun r => Inv48.BatchInputLoop.Inputs r p a b batch),?_,innerT⟩
          intro c r mid tr inputs exec
          rw [clean,cleanExecution n c r.pushScope p a b batch (pushInputs r p a b batch inputs) hp ha hb] at exec
          cases exec
          exact pushInputs r p a b batch inputs
        have reject : Rejects pure out := by
          intro v bad tr exec
          cases exec
          exact ordinary bad
        have shapedRun : Interaction.Executes (Stmt.eval (n+2) Inv48.Source.model.core.table c r
            (.block (outer.take 5 ++ .block inner :: outer.drop 6)) >>= pure) trace (.ok out) := by
          have unit : (Stmt.eval (n+2) Inv48.Source.model.core.table c r
              (.block (outer.take 5 ++ .block inner :: outer.drop 6)) >>= pure) =
              Stmt.eval (n+2) Inv48.Source.model.core.table c r
              (.block (outer.take 5 ++ .block inner :: outer.drop 6)) := Interaction.bind_pure _
          rw [unit]
          simpa only [body,← outerShape] using run
        have recovered := trackedSite whole _ _ wholeTrack c r initial pure trace out reject shapedRun
        have eqRoot : (Stmt.eval (n+2) Inv48.Source.model.core.table c r
            (.block (outer.take 5 ++ .block inner :: outer.drop 6)) >>= pure) =
            Stmt.eval (n+2) Inv48.Source.model.core.table c r (.block outer) := by
          rw [← outerShape]
          exact Interaction.bind_pure _
        rw [eqRoot] at recovered
        obtain ⟨s,fuel,rej,ready⟩ := recovered
        refine ⟨s,?_,rej,ready⟩
        simpa only [whole,Blocks.leafFuel,innerB,fuelCast,inside,leaf] using fuel
end Inv48.PreLoopJoin
