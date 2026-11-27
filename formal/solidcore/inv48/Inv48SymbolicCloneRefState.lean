import Inv48SymbolicCloneStore
open SolidCore.Solidity.Source
namespace Inv48.SymbolicClone
set_option maxRecDepth 65536
set_option maxHeartbeats 40000000
set_option linter.unusedSimpArgs false

def refState (base : Runtime) (code : List Nat) (i acc : Nat) : Runtime :=
  { (base.allocMemory (.bytes code)).1 with
    locals := [("#extword", .word acc), ("#extindex", .word i),
      ("#extcode", .memoryRef base.nextMemory), ("offset", .word 45)] :: base.locals }

@[simp] theorem ref_lookup (base : Runtime) (code : List Nat) (i acc : Nat) (name : String) :
    (refState base code i acc).lookupLocal? name =
      if name = "#extword" then some (.word acc) else
      if name = "#extindex" then some (.word i) else
      if name = "#extcode" then some (.memoryRef base.nextMemory) else
      if name = "offset" then some (.word 45) else base.lookupLocal? name := by
  by_cases a : name = "#extword" <;> by_cases b : name = "#extindex" <;>
    by_cases d : name = "#extcode" <;> by_cases e : name = "offset" <;>
    simp_all [refState, Runtime.lookupLocal?, LocalEnv.lookup?, Frame.lookup?, eq_comm]

@[simp] theorem ref_memory (base : Runtime) (code : List Nat) (i acc : Nat) :
    (refState base code i acc).loadMemory? base.nextMemory = some (.bytes code) := by
  simp [refState, Runtime.allocMemory, Runtime.loadMemory?, MemoryMap.lookup?, MemoryMap.insertLoop]
@[simp] theorem push_memory (r : Runtime) (id : Nat) :
    r.pushScope.loadMemory? id = r.loadMemory? id := rfl
theorem ref_store_word (base : Runtime) (code : List Nat) (i acc v : Nat) :
    (refState base code i acc).assignLocal? "#extword" (.word v) =
      some (refState base code i v) := by
  simp [Runtime.assignLocal?, refState, Runtime.lookupLocal?, LocalEnv.lookup?, Frame.lookup?,
    Value.coerceLike?, LocalEnv.assign?, Frame.assign?, normWord,
    SolidCore.Solidity.Shared.norm, show SolidCore.Solidity.Shared.wordModulus = R from rfl, Bind.bind, Option.bind]

theorem ref_store_index (base : Runtime) (code : List Nat) (i acc v : Nat) :
    (refState base code i acc).assignLocal? "#extindex" (.word v) =
      some (refState base code v acc) := by
  simp [Runtime.assignLocal?, refState, Runtime.lookupLocal?, LocalEnv.lookup?, Frame.lookup?,
    Value.coerceLike?, LocalEnv.assign?, Frame.assign?, normWord,
    SolidCore.Solidity.Shared.norm, show SolidCore.Solidity.Shared.wordModulus = R from rfl, Bind.bind, Option.bind]
theorem ref_store_word_scoped (base : Runtime) (code : List Nat) (i acc v : Nat) :
    (refState base code i acc).pushScope.assignLocal? "#extword" (.word v) =
      some (refState base code i v).pushScope := by
  simp [Runtime.pushScope, Runtime.assignLocal?, refState, Runtime.lookupLocal?, LocalEnv.lookup?, Frame.lookup?,
    Value.coerceLike?, LocalEnv.assign?, Frame.assign?, normWord,
    SolidCore.Solidity.Shared.norm, show SolidCore.Solidity.Shared.wordModulus = R from rfl, Bind.bind, Option.bind]

theorem ref_store_index_scoped (base : Runtime) (code : List Nat) (i acc v : Nat) :
    (refState base code i acc).pushScope.assignLocal? "#extindex" (.word v) =
      some (refState base code v acc).pushScope := by
  simp [Runtime.pushScope, Runtime.assignLocal?, refState, Runtime.lookupLocal?, LocalEnv.lookup?, Frame.lookup?,
    Value.coerceLike?, LocalEnv.assign?, Frame.assign?, normWord,
    SolidCore.Solidity.Shared.norm, show SolidCore.Solidity.Shared.wordModulus = R from rfl, Bind.bind, Option.bind]
end Inv48.SymbolicClone
