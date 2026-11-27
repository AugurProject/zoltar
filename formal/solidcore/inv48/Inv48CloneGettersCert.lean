import Inv48CloneGettersLink
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.CloneGetters
open Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 40000000

theorem checked_getters : checks Inv48.Source.model.core.table = true := by native_decide

theorem library_lookup : Inv48.Source.model.core.table.lookup? cloneKey = some libraryFn := by
  have h := checked_getters
  simp only [checks,Bool.and_eq_true] at h
  exact (Option_some libraryFnPattern).sound _ h.1.1

theorem universe_lookup : Inv48.Source.model.core.table.lookup? universeKey = some universeFn := by
  have h := checked_getters
  simp only [checks,Bool.and_eq_true] at h
  exact (Option_some universeFnPattern).sound _ h.1.2

theorem reputation_lookup : Inv48.Source.model.core.table.lookup? reputationKey = some reputationFn := by
  have h := checked_getters
  simp only [checks,Bool.and_eq_true] at h
  exact (Option_some reputationFnPattern).sound _ h.2
end Inv48.CloneGetters
