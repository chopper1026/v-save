export interface SilentDownloadFinishedOrderLike {
  finishedAt?: number;
  updatedAt?: number;
  createdAt?: number;
}

export const getSilentDownloadFinishedOrderValue = (
  task: SilentDownloadFinishedOrderLike,
): number => {
  return task.finishedAt || task.updatedAt || task.createdAt || 0;
};
