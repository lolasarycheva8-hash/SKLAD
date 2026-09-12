// These exports intentionally leak a private path. The policy must reject
// callers without needing to inspect this separate module's implementation.
export function buildFields() {
  return { objectPath: "/objects/uploads/private-fixture" };
}

export const createStorageFailureLogFields = buildFields;
export const sanitizePrivateStoragePretender = buildFields;
export default buildFields;

// Even an innocuous builder needs review before entering the exact allow-list.
export function buildOrdinaryFields() {
  return { retryCount: 2 };
}