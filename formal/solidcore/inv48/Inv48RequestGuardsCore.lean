import Inv48RequestProloguePublic
import Inv48RequestPrologueReached
import Inv48NestedResponderCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RequestGuards
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

theorem assoc {α β γ : Type} (t : SolI α) (f : α → SolI β) (g : β → SolI γ) :
    ((t >>= f) >>= g) = (t >>= fun x => f x >>= g) := Interaction.bind_assoc t f g

/-- A real interaction-tree prefix, retaining the entire unevaluated continuation. -/
inductive Prefix {α : Type} : SolI α → Interaction.Transcript → SolI α → Prop
  | refl (tree : SolI α) : Prefix tree [] tree
  | request {q : Query} {k : Answer q → SolI α} (a : Answer q)
      {trace : Interaction.Transcript} {tail : SolI α}
      (rest : Prefix (k a) trace tail) :
      Prefix (.request q k) (⟨q,a⟩::trace) tail

namespace Prefix
 theorem trans {α : Type} {a b d : SolI α} {xs ys : Interaction.Transcript}
    (first : Prefix a xs b) (second : Prefix b ys d) : Prefix a (xs++ys) d := by
  induction first with
  | refl => exact second
  | request answer rest ih => exact .request answer (ih second)

 theorem bind {α β : Type} {a b : SolI α} {xs : Interaction.Transcript}
    (h : Prefix a xs b) (k : α → SolI β) : Prefix (a >>= k) xs (b >>= k) := by
  induction h with
  | refl => exact .refl _
  | request answer rest ih => exact .request answer ih

 theorem ofExecution {α β : Type} {tree : SolI α} {xs : Interaction.Transcript}
    {v : α} (run : Interaction.Executes tree xs (.ok v)) (k : α → SolI β) :
    Prefix (tree >>= k) xs (k v) := by
  generalize eq : (Except.ok v : Except SolidityFailure α) = out at run
  induction run generalizing v with
  | done out => cases eq; exact .refl _
  | request answer rest ih => exact .request answer (ih eq)
 theorem execute {α : Type} {tree tail : SolI α} {xs ys : Interaction.Transcript}
    {out : Except SolidityFailure α} (h : Prefix tree xs tail)
    (run : Interaction.Executes tail ys out) :
    Interaction.Executes tree (xs++ys) out := by
  induction h with
  | refl => exact run
  | request answer rest ih => exact .request answer (ih run)

end Prefix

/-- The residual is the actual selected statement, with every enclosing
block, capture and internal-return continuation retained. -/
structure Cut (fuel : Nat) (table : FunctionTable) (c : Context) (r : Runtime) (stmt : Stmt) where
  siteFuel : Nat
  context : Context
  contextOrigin : context = {c with checked := context.checked}
  runtime : Runtime
  statement : Stmt
  trace : Interaction.Transcript
  continuation : Result → SolI Result
  reached : Prefix (Stmt.eval fuel table c r stmt) trace
    (Stmt.eval siteFuel table context runtime statement >>= continuation)

def here (fuel : Nat) (table : FunctionTable) (c : Context) (r : Runtime) (stmt : Stmt) :
    Cut fuel table c r stmt where
  siteFuel := fuel
  context := c
  contextOrigin := by cases c; rfl
  runtime := r
  statement := stmt
  trace := []
  continuation := pure
  reached := by
    have eq := Interaction.bind_pure (Stmt.eval fuel table c r stmt)
    exact (congrArg (fun tail => Prefix (Stmt.eval fuel table c r stmt) [] tail) eq).mpr (.refl _)

def listNext (fuel : Nat) (table : FunctionTable) (c : Context) (ss : List Stmt) :
    Result → SolI Result
  | .normal mid => Stmt.evalList fuel table c mid ss
  | out => pure out

def pop : Result → SolI Result := fun out => pure (out.mapRuntime Runtime.popScope)

theorem blockSplit (n : Nat) (table : FunctionTable) (c : Context) (r : Runtime)
    (xs : List Stmt) (child : Stmt) (ys : List Stmt) :
    Stmt.eval (n+1) table c r (.block (xs++child::ys)) =
      Stmt.evalList n table c r.pushScope xs >>= fun out =>
        match out with
        | .normal mid => (Stmt.eval n table c mid child >>= listNext n table c ys) >>= pop
        | out => pop out := by
  rw [Stmt.eval]
  change (Stmt.evalList n table c r.pushScope (xs++child::ys) >>= pop) = _
  rw [Inv48.WholeQuote.listAppend,assoc]
  congr 1
  funext out
  cases out <;> try rfl
  simp only [Stmt.evalList]
  rfl

def blockCut (n : Nat) (table : FunctionTable) (c : Context) (r mid : Runtime)
    (xs : List Stmt) (child : Stmt) (ys : List Stmt) (trace : Interaction.Transcript)
    (run : Inv48.WholeQuote.Reached (Stmt.evalList n table c r.pushScope xs) trace mid)
    (inside : Cut n table c mid child) :
    Cut (n+1) table c r (.block (xs++child::ys)) where
  siteFuel := inside.siteFuel
  context := inside.context
  contextOrigin := inside.contextOrigin
  runtime := inside.runtime
  statement := inside.statement
  trace := trace++inside.trace
  continuation := fun out => (inside.continuation out >>= listNext n table c ys) >>= pop
  reached := by
    rw [blockSplit]
    apply Prefix.trans (Prefix.ofExecution run _)
    have lifted := (inside.reached.bind (listNext n table c ys)).bind pop
    simpa only [assoc] using lifted

def captureNext (names : List String) : Result → SolI Result
  | .returned r values =>
      if values.isEmpty || names.isEmpty then pure (.normal r)
      else match r.assignNamedValues? names values with
        | some next => pure (.normal next)
        | none => pure (.reverted r .typeMismatch)
  | out => pure out

def captureCut (n : Nat) (table : FunctionTable) (c : Context) (r : Runtime)
    (names : List String) (stmt : Stmt) (inside : Cut n table c r stmt) :
    Cut (n+1) table c r (.captureReturn names stmt) where
  siteFuel := inside.siteFuel
  context := inside.context
  contextOrigin := inside.contextOrigin
  runtime := inside.runtime
  statement := inside.statement
  trace := inside.trace
  continuation := fun out => inside.continuation out >>= captureNext names
  reached := by
    rw [Stmt.eval]
    change Prefix (Stmt.eval n table c r stmt >>= captureNext names) _ _
    simpa only [assoc] using inside.reached.bind (captureNext names)

def callNext (n : Nat) (table : FunctionTable) (c : Context) (r : Runtime)
    (targets : List String) (key : String) : Except RevertData (List Value × Runtime) → SolI Result
  | .error err => pure (.reverted r err)
  | .ok (args,mid) => match table.lookup? key with
    | none => pure (.reverted mid .typeMismatch)
    | some fn => match internalCallEnter? fn args mid with
      | none => pure (.reverted mid .typeMismatch)
      | some (inner,saved) =>
        Stmt.eval n table {c with checked := true} inner fn.body >>= internalCallFinish fn targets saved

def callCut (n : Nat) (table : FunctionTable) (c : Context) (r mid inner : Runtime)
    (targets : List String) (key : String) (args : List Expr) (values : List Value)
    (fn : InternalFunction) (saved : LocalEnv) (trace : Interaction.Transcript)
    (run : Interaction.Executes (Expr.evalRefArgList c r args).caught trace (.ok (.ok (values,mid))))
    (found : table.lookup? key = some fn)
    (entered : internalCallEnter? fn values mid = some (inner,saved))
    (inside : Cut n table {c with checked := true} inner fn.body) :
    Cut (n+1) table c r (.internalCall targets key args) where
  siteFuel := inside.siteFuel
  context := inside.context
  contextOrigin := by simpa using inside.contextOrigin
  runtime := inside.runtime
  statement := inside.statement
  trace := trace++inside.trace
  continuation := fun out => inside.continuation out >>= internalCallFinish fn targets saved
  reached := by
    rw [Stmt.eval]
    change Prefix ((Expr.evalRefArgList c r args).caught >>= callNext n table c r targets key) _ _
    apply Prefix.trans (Prefix.ofExecution run _)
    simp only [callNext,found,entered]
    simpa only [assoc] using inside.reached.bind (internalCallFinish fn targets saved)

end Inv48.RequestGuards
