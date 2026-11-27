import Inv39FullPublicReachable
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.UniversalGenesis
set_option maxRecDepth 10000
set_option maxHeartbeats 0
def sourceFn := TypeCheck.CheckedProgram.constructorFunctionFor? model.program model.decl
def body : Source.Stmt := (Source.Stmt.block
  [Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.block
     [Source.Stmt.block
        [Source.Stmt.block
           [Source.Stmt.block
              [Source.Stmt.memoryVarDecl
                 (Ty.bytesCalldata)
                 "#solidcore_base_arg_eval_0"
                 none,
               Source.Stmt.assign
                 (Source.LValue.var "#solidcore_base_arg_eval_0")
                 (Source.Expr.byteArray [82, 101, 112, 117, 116, 97, 116, 105, 111, 110]),
               Source.Stmt.memoryVarDecl
                 (Ty.bytesCalldata)
                 "name_"
                 (some (Source.Expr.var "#solidcore_base_arg_eval_0")),
               Source.Stmt.memoryVarDecl
                 (Ty.bytesCalldata)
                 "#solidcore_base_arg_eval_1"
                 none,
               Source.Stmt.assign
                 (Source.LValue.var "#solidcore_base_arg_eval_1")
                 (Source.Expr.byteArray [82, 69, 80]),
               Source.Stmt.memoryVarDecl
                 (Ty.bytesCalldata)
                 "symbol_"
                 (some (Source.Expr.var "#solidcore_base_arg_eval_1")),
               Source.Stmt.block
                 [Source.Stmt.block [Source.Stmt.block []]],
               Source.Stmt.block
                 [Source.Stmt.assign
                    (Source.LValue.storage "_name")
                    (Source.Expr.var "name_"),
                  Source.Stmt.assign
                    (Source.LValue.storage "_symbol")
                    (Source.Expr.var "symbol_")]]]]],
   Source.Stmt.skip,
   Source.Stmt.block
     [Source.Stmt.requireStmt
        (Source.Expr.binary
          (Source.BinaryOp.ne)
          (Source.Expr.var "_zoltar")
          (Source.Expr.word 0))
        (some "Zoltar must not be the zero address"),
      Source.Stmt.assign
        (Source.LValue.immutable "zoltar")
        (Source.Expr.var "_zoltar")]])
def bodyMatches : Source.Stmt → Bool
 | (Source.Stmt.block
  [Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.skip,
   Source.Stmt.block
     [Source.Stmt.block
        [Source.Stmt.block
           [Source.Stmt.block
              [Source.Stmt.memoryVarDecl
                 (Ty.bytesCalldata)
                 "#solidcore_base_arg_eval_0"
                 none,
               Source.Stmt.assign
                 (Source.LValue.var "#solidcore_base_arg_eval_0")
                 (Source.Expr.byteArray [82, 101, 112, 117, 116, 97, 116, 105, 111, 110]),
               Source.Stmt.memoryVarDecl
                 (Ty.bytesCalldata)
                 "name_"
                 (some (Source.Expr.var "#solidcore_base_arg_eval_0")),
               Source.Stmt.memoryVarDecl
                 (Ty.bytesCalldata)
                 "#solidcore_base_arg_eval_1"
                 none,
               Source.Stmt.assign
                 (Source.LValue.var "#solidcore_base_arg_eval_1")
                 (Source.Expr.byteArray [82, 69, 80]),
               Source.Stmt.memoryVarDecl
                 (Ty.bytesCalldata)
                 "symbol_"
                 (some (Source.Expr.var "#solidcore_base_arg_eval_1")),
               Source.Stmt.block
                 [Source.Stmt.block [Source.Stmt.block []]],
               Source.Stmt.block
                 [Source.Stmt.assign
                    (Source.LValue.storage "_name")
                    (Source.Expr.var "name_"),
                  Source.Stmt.assign
                    (Source.LValue.storage "_symbol")
                    (Source.Expr.var "symbol_")]]]]],
   Source.Stmt.skip,
   Source.Stmt.block
     [Source.Stmt.requireStmt
        (Source.Expr.binary
          (Source.BinaryOp.ne)
          (Source.Expr.var "_zoltar")
          (Source.Expr.word 0))
        (some "Zoltar must not be the zero address"),
      Source.Stmt.assign
        (Source.LValue.immutable "zoltar")
        (Source.Expr.var "_zoltar")]]) => true
 | _ => false
def metadata (f : FunctionDef) : Bool := match f.params,f.returns,f.payable with
 | [⟨"_zoltar",.address,false⟩],[],false => true
 | _,_,_ => false
theorem certificate : sourceFn.map (fun f => metadata f && bodyMatches f.body)=some true := by native_decide
theorem existsFn : sourceFn.isSome := by
  have h := certificate
  cases eq : sourceFn <;> simp_all
def ctor : FunctionDef := sourceFn.get existsFn
theorem ctorFacts : metadata ctor ∧ bodyMatches ctor.body := by
  have h := certificate
  rw [← Option.some_get existsFn] at h
  simpa only [Option.map_some,Option.some.injEq,Bool.and_eq_true] using h
theorem bodyFromSource : ctor.body=body := by
  have h := ctorFacts.2
  unfold bodyMatches at h
  split at h <;> simp_all [body]
theorem metaFromSource : ctor.params=[⟨"_zoltar",.address,false⟩] ∧ ctor.returns=[] ∧ ctor.payable=false := by
  have h := ctorFacts.1
  unfold metadata at h
  split at h <;> simp_all
#print axioms certificate
end Inv39.UniversalGenesis
