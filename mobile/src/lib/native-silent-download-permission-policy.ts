interface NativeSilentDownloadRuntimePermissionInput {
  useNativeEngine: boolean;
  previousEnabled: boolean | null;
  nextEnabled: boolean;
}

export const shouldRequestNativeSilentDownloadRuntimePermissions = (
  input: NativeSilentDownloadRuntimePermissionInput,
): boolean => {
  if (!input.useNativeEngine) {
    return false;
  }

  if (!input.nextEnabled) {
    return false;
  }

  return input.previousEnabled !== true;
};
