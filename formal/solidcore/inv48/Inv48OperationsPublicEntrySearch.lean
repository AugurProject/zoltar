import Inv48WrapperTraversalSource
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Shapes
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
open Inv48.WrapperTraversal
namespace Inv48.OperationsPublicEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- A checked source route with fallthrough prefixes. -/
structure TargetPlan (t : FunctionTable) (target stmt : Stmt) where
  depth : Nat
  build : ∀ n, Inv48.WrapperTraversal.Blocks t target (n+depth) stmt
  leaf : ∀ n, (build n).leafFuel = n

def findTargetPlan (t : FunctionTable) (pattern : Pattern Stmt) : Nat → (stmt : Stmt) → Option (TargetPlan t pattern.value stmt)
  | 0,_ => none
  | k+1,stmt =>
    if h : pattern.test stmt = true then
      some ⟨0,fun n => by
        have eq := pattern.sound stmt h
        subst stmt
        exact .here n,fun n => by
        have eq := pattern.sound stmt h
        subst stmt
        rfl⟩
    else match stmt with
    | .block ss =>
      let rec seek (xs rest : List Stmt) : Option (TargetPlan t pattern.value (.block (xs++rest))) :=
        match rest with
        | [] => none
        | child::ys =>
          if safe : Inv48.WrapperTraversal.prefixes t xs = true then
            match findTargetPlan t pattern k child with
            | some p => some ⟨p.depth+1,fun n => .block (n+p.depth) xs child ys safe (p.build n),p.leaf⟩
            | none => by
              have next := seek (xs++[child]) ys
              simpa only [List.append_assoc,List.singleton_append] using next
          else none
      seek [] ss
    | _ => none

end Inv48.OperationsPublicEntry
