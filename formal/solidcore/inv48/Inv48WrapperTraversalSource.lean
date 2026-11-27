import Inv48WrapperTraversalCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
namespace Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
structure Plan (t : FunctionTable) (stmt : Stmt) where
  targets : List String
  args : List Expr
  depth : Nat
  build : ∀ n, Blocks t (.internalCall targets Inv48.RequestQuote.requestKey args) (n+depth) stmt
  leaf : ∀ n, (build n).leafFuel = n

def plan : Nat → (t : FunctionTable) → (stmt : Stmt) → Option (Plan t stmt)
  | 0,_,_ => none
  | k+1,t,.internalCall targets key args =>
    if h : key = Inv48.RequestQuote.requestKey then
      some ⟨targets,args,0,fun n => by subst key; exact .here n,fun n => by subst key; rfl⟩
    else none
  | k+1,t,.captureReturn names body => do
    let p ← plan k t body
    return ⟨p.targets,p.args,p.depth+1,fun n => .capture (n+p.depth) names body (p.build n),p.leaf⟩
  | k+1,t,.block ss =>
    let rec seek (xs rest : List Stmt) : Option (Plan t (.block (xs++rest))) :=
      match rest with
      | [] => none
      | child::ys =>
        if h : prefixes t xs = true then
          match plan k t child with
          | some p => some ⟨p.targets,p.args,p.depth+1,fun n => .block (n+p.depth) xs child ys h (p.build n),p.leaf⟩
          | none => by
            have next := seek (xs++[child]) ys
            simpa only [List.append_assoc,List.singleton_append] using next
        else none
    seek [] ss
  | _,_,_ => none

def available := wrappers.all fun name =>
  (Inv48.Source.model.core.findFunctionByName? name).any fun fn =>
    (plan 100 Inv48.Source.model.core.table fn.body).isSome

theorem bothPlans : available = true := by native_decide

theorem wrapperPlan (name : String) (fn : FunctionDef) (member : name ∈ wrappers)
    (registered : Inv48.Source.model.core.findFunctionByName? name = some fn) :
    ∃ p, plan 100 Inv48.Source.model.core.table fn.body = some p := by
  have h := List.all_eq_true.mp bothPlans name member
  rw [registered,Option.any_some] at h
  exact Option.isSome_iff_exists.mp h
end Inv48.WrapperTraversal
