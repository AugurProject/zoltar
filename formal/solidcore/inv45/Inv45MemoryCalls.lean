import Inv45FormatterShape
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Bytes
def localsOf (r src : Runtime) := {r with locals:=src.locals}
theorem blank (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name : String) :
    Stmt.eval (fuel+1) t c r (Format.blank name).value=
      pure (.normal ((allocate r []).declareLocal name (.memoryRef r.nextMemory))) := by
  change Stmt.eval _ _ _ _ (.memoryVarDecl .bytesCalldata name none)=_
  rw [Stmt.eval];dsimp only [Ty.defaultValue]
  have h : r.declareMemoryLocal .bytesCalldata name (.bytes [])=some ((allocate r []).declareLocal name (.memoryRef r.nextMemory)) := by
    simp [Runtime.declareMemoryLocal,Ty.coerceValue?,Runtime.memoryStoredValue,Runtime.allocMemory,allocate]
  have empty : Source.Ty.bytesCalldata.defaultValue=Value.bytes [] := by simp [Source.Ty.defaultValue]
  rw [empty,h]
theorem copyRef (fuel : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (dst src : String) (old id : Nat)
    (D : r.lookupLocal? dst=some (.memoryRef old)) (S : r.lookupLocal? src=some (.memoryRef id))
    (store : r.assignLocalRaw? dst (.memoryRef id)=some next) :
    Stmt.eval (fuel+1) t c r (Inv03.Bodies.assign dst (varP src)).value=pure (.normal next) := by
  change Stmt.eval _ _ _ _ (.assign (.var dst) (.var src))=_
  rw [Stmt.eval];dsimp only [Ty.defaultValue]
  simp only [Runtime.lookupMemoryRef?,D,S,store]
theorem declarePtr (r : Runtime) (name : String) (id : Nat) :
    (r.declareLocal name (.memoryRef id)).lookupLocal? name=some (.memoryRef id) := by
  cases h : r.locals <;> simp [Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,h]
theorem reassignTop (r : Runtime) (name : String) (old id : Nat) :
    (r.declareLocal name (.memoryRef old)).assignLocalRaw? name (.memoryRef id)=some (r.declareLocal name (.memoryRef id)) := by
  cases h : r.locals <;> simp [Runtime.declareLocal,Runtime.assignLocalRaw?,LocalEnv.declare,LocalEnv.assign?,Frame.assign?,h]
theorem captureTop (outer base : Runtime) (name : String) (old : Nat) (bs : List Nat) (v : Value)
    (same : outer.locals=(base.declareLocal name (.memoryRef old)).locals) (data : Decimal.Holds outer bs v) :
    ∃a id, Retains outer a ∧ id<a.nextMemory ∧ a.loadMemory? id=some (.bytes bs) ∧
      internalCallAssign outer [name] [v]=pure (.normal ((localsOf a base).declareLocal name (.memoryRef id))) := by
  have top : outer=(localsOf outer base).declareLocal name (.memoryRef old) := by
    cases outer;cases base;simp_all [localsOf,Runtime.declareLocal]
  have ptr : outer.lookupLocal? name=some (.memoryRef old) := by
    conv => lhs;rw [top]
    exact declarePtr _ _ _
  cases data with
  | @ref id bound cell =>
    refine ⟨outer,id,unchanged _,bound,cell,?_⟩
    have assign : outer.assignLocalRaw? name (.memoryRef id)=some ((localsOf outer base).declareLocal name (.memoryRef id)) := by
      conv => lhs;rw [top]
      exact reassignTop _ _ _ _
    simp [internalCallAssign,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.assignLocal?,ptr,assign]
  | direct =>
    let a := allocate outer bs
    have atop : a=(localsOf a base).declareLocal name (.memoryRef old) := by
      cases outer;cases base;simp_all [a,allocate,localsOf,Runtime.declareLocal]
    have assign : a.assignLocalRaw? name (.memoryRef outer.nextMemory)=some ((localsOf a base).declareLocal name (.memoryRef outer.nextMemory)) := by
      conv => lhs;rw [atop]
      exact reassignTop _ _ _ _
    refine ⟨a,outer.nextMemory,allocated _ _,Nat.lt_succ_self _,load outer _ _,?_⟩
    change (match outer.assignNamedValuesRef? [name] [.bytes bs] with
      | some s=>(pure (.normal s) : SolI Result)
      | none=>pure (.reverted outer RevertData.typeMismatch))=_
    simp only [Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.assignLocal?,ptr,Value.isMemoryObject,
      Runtime.memoryStoredValue,Runtime.allocMemory]
    simp only [if_true]
    change (match (match a.assignLocalRaw? name (.memoryRef outer.nextMemory) with | some s=>some s | none=>none) with
      | some s=>(pure (.normal s) : SolI Result) | none=>pure (.reverted outer RevertData.typeMismatch))=_
    rw [assign]
end Inv45.Bytes
